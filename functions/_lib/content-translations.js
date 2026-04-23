import { HttpError } from './http.js';

const SUPPORTED_LOCALES = new Set([
  'english',
  'simplified_chinese',
  'traditional_chinese',
  'japanese',
  'korean',
  'spanish',
  'french',
  'brazilian_portuguese',
  'italian',
  'german',
]);

const TRANSLATION_ENGINE = 'azure-openai-v1';

const LOCALE_LABELS = {
  english: 'English',
  simplified_chinese: 'Simplified Chinese',
  traditional_chinese: 'Traditional Chinese',
  japanese: 'Japanese',
  korean: 'Korean',
  spanish: 'Spanish',
  french: 'French',
  brazilian_portuguese: 'Brazilian Portuguese',
  italian: 'Italian',
  german: 'German',
};

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeOptions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(option => normalizeText(option))
    .filter(Boolean);
}

export function normalizeContentLocale(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return SUPPORTED_LOCALES.has(normalized) ? normalized : 'english';
}

function getAzureOpenAiConfig(env) {
  const endpoint = normalizeText(env?.AZURE_OPENAI_ENDPOINT || env?.AZURE_ENDPOINT);
  const apiKey = normalizeText(env?.AZURE_OPENAI_API_KEY || env?.AZURE_API_KEY);
  const deployment = normalizeText(env?.AZURE_OPENAI_DEPLOYMENT) || 'gpt-5-chat-global-01';
  const apiVersion = normalizeText(env?.AZURE_OPENAI_API_VERSION) || '2025-01-01-preview';

  if (!endpoint || !apiKey) {
    throw new HttpError(503, 'Azure OpenAI is not configured', 'azure_openai_missing_config');
  }

  return {
    endpoint: endpoint.replace(/\/+$/, ''),
    apiKey,
    deployment,
    apiVersion,
  };
}

function extractJsonObject(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    throw new Error('Empty model response');
  }

  try {
    return JSON.parse(normalized);
  } catch {
  }

  const match = normalized.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('Model response did not contain a JSON object');
  }

  return JSON.parse(match[0]);
}

async function callAzureOpenAiJson(env, messages, maxCompletionTokens = 2600) {
  const config = getAzureOpenAiConfig(env);
  const url = `${config.endpoint}/openai/deployments/${config.deployment}/chat/completions?api-version=${config.apiVersion}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': config.apiKey,
    },
    body: JSON.stringify({
      messages,
      temperature: 0.1,
      max_completion_tokens: maxCompletionTokens,
      response_format: { type: 'json_object' },
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Azure OpenAI returned ${response.status}: ${text.slice(0, 300)}`);
  }

  const payload = JSON.parse(text);
  const content = payload?.choices?.[0]?.message?.content || '';
  return extractJsonObject(content);
}

async function ensureContentTranslationSchema(env) {
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS content_translations (
         content_key TEXT NOT NULL,
         locale TEXT NOT NULL,
         content_hash TEXT NOT NULL,
         payload TEXT NOT NULL,
         created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         PRIMARY KEY (content_key, locale, content_hash)
       )`
    ),
    env.DB.prepare(
      'CREATE INDEX IF NOT EXISTS idx_content_translations_locale_updated_at ON content_translations(locale, updated_at)'
    ),
  ]);
}

async function getCachedTranslation(env, contentKey, locale, contentHash) {
  const row = await env.DB.prepare(
    `SELECT payload
     FROM content_translations
     WHERE content_key = ? AND locale = ? AND content_hash = ?`
  ).bind(contentKey, locale, contentHash).first();

  if (!row?.payload) return null;

  try {
    const parsed = JSON.parse(row.payload);
    const validLines = Array.isArray(parsed?.lines)
      && parsed.lines.every(line => typeof line?.translation === 'string');
    const validQuestions = Array.isArray(parsed?.questions)
      && parsed.questions.every(question => (
        typeof question?.question === 'string'
        && Array.isArray(question?.options)
        && typeof question?.explanation === 'string'
      ));
    return parsed?.engine === TRANSLATION_ENGINE
      && typeof parsed?.title === 'string'
      && validLines
      && validQuestions
      ? parsed
      : null;
  } catch {
    return null;
  }
}

async function saveCachedTranslation(env, contentKey, locale, contentHash, payload) {
  await env.DB.prepare(
    `INSERT INTO content_translations (content_key, locale, content_hash, payload, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(content_key, locale, content_hash)
     DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP`
  ).bind(contentKey, locale, contentHash, JSON.stringify(payload)).run();
}

function buildEnglishExplanationFallback(question) {
  const answer = normalizeText(question?.answer);
  const prompt = normalizeText(question?.question);
  if (!answer && !prompt) return '';
  if (!answer) return prompt;
  if (!prompt) return `Correct answer: ${answer}.`;
  return `${prompt} Correct answer: ${answer}.`;
}

async function translateWithLlm(env, locale, item) {
  const targetLanguage = LOCALE_LABELS[locale] || locale;
  const messages = [
    {
      role: 'system',
      content: [
        'You localize short podcast-learning content for a mobile language app.',
        `Translate into ${targetLanguage}.`,
        'Return strict JSON with exactly one string field "title" and exactly two arrays: "lines" and "questions".',
        'The title should be a short learner-facing localized title for the clip.',
        'Each lines item must be an object: {"translation":"..."}',
        'Each questions item must be an object: {"question":"...","options":["..."],"explanation":"..."}',
        'Preserve array lengths and order.',
        'Preserve the number and order of answer options for each question.',
        'Do not add markdown, comments, or extra keys.',
        'Use natural learner-facing phrasing, concise and clear.',
        'For traditional Chinese, use traditional characters.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify({
        targetLocale: locale,
        targetLanguage,
        title: normalizeText(item?.title),
        lines: (item.lines || []).map(line => ({
          english: normalizeText(line?.en),
          legacy_simplified_chinese: normalizeText(line?.zh),
        })),
        questions: (item.questions || []).map(question => ({
          english_question: normalizeText(question?.question),
          english_options: normalizeOptions(question?.options),
          english_fallback_explanation: buildEnglishExplanationFallback(question),
          legacy_simplified_chinese_explanation: normalizeText(question?.explanation_zh),
        })),
        outputSchema: {
          title: 'string',
          lines: [{ translation: 'string' }],
          questions: [{ question: 'string', options: ['string'], explanation: 'string' }],
        },
      }),
    },
  ];

  const result = await callAzureOpenAiJson(env, messages);
  const lineResults = Array.isArray(result?.lines) ? result.lines : [];
  const questionResults = Array.isArray(result?.questions) ? result.questions : [];

  return {
    title: normalizeText(result?.title),
    lines: (item.lines || []).map((line, index) => ({
      translation: normalizeText(lineResults[index]?.translation),
    })),
    questions: (item.questions || []).map((question, index) => ({
      question: normalizeText(questionResults[index]?.question),
      options: normalizeOptions(questionResults[index]?.options),
      explanation: normalizeText(questionResults[index]?.explanation),
    })),
  };
}

async function buildTranslationPayload(env, locale, item) {
  if (locale === 'english') {
    return {
      engine: TRANSLATION_ENGINE,
      locale,
      contentKey: item.contentKey,
      contentHash: item.contentHash,
      title: normalizeText(item?.title),
      lines: (item.lines || []).map(line => ({
        translation: normalizeText(line?.en),
      })),
      questions: (item.questions || []).map(question => ({
        question: normalizeText(question?.question),
        options: normalizeOptions(question?.options),
        explanation: buildEnglishExplanationFallback(question),
      })),
      generatedAt: new Date().toISOString(),
      unavailable: false,
    };
  }

  if (locale === 'simplified_chinese') {
    let title = normalizeText(item?.title);
    let translated = null;
    try {
      translated = await translateWithLlm(env, locale, item);
      title = normalizeText(translated?.title) || title;
    } catch (error) {
      console.error('[content-translations] llm translation failed', {
        locale,
        contentKey: item?.contentKey,
        message: error?.message || String(error),
      });
    }

    return {
      engine: TRANSLATION_ENGINE,
      locale,
      contentKey: item.contentKey,
      contentHash: item.contentHash,
      title,
      lines: (item.lines || []).map((line, index) => ({
        translation: normalizeText(line?.zh) || normalizeText(translated?.lines?.[index]?.translation),
      })),
      questions: (item.questions || []).map((question, index) => {
        const translatedQuestion = translated?.questions?.[index];
        const translatedOptions = normalizeOptions(translatedQuestion?.options);
        const sourceOptions = normalizeOptions(question?.options);
        return {
          question: normalizeText(translatedQuestion?.question) || normalizeText(question?.question),
          options: translatedOptions.length === sourceOptions.length && translatedOptions.length > 0
            ? translatedOptions
            : sourceOptions,
          explanation: normalizeText(translatedQuestion?.explanation) || normalizeText(question?.explanation_zh),
        };
      }),
      generatedAt: new Date().toISOString(),
      unavailable: false,
    };
  }

  let title = normalizeText(item?.title);
  let lines = [];
  let questions = [];

  try {
    const translated = await translateWithLlm(env, locale, item);
    const translatedTitle = normalizeText(translated.title);
    lines = translated.lines;
    questions = (item.questions || []).map((question, index) => {
      const translatedQuestion = translated.questions[index];
      const translatedOptions = normalizeOptions(translatedQuestion?.options);
      const sourceOptions = normalizeOptions(question?.options);
      return {
        question: normalizeText(translatedQuestion?.question) || normalizeText(question?.question),
        options: translatedOptions.length === sourceOptions.length && translatedOptions.length > 0
          ? translatedOptions
          : sourceOptions,
        explanation: normalizeText(translatedQuestion?.explanation),
      };
    });
    title = translatedTitle || normalizeText(item?.title);
  } catch (error) {
    console.error('[content-translations] llm translation failed', {
      locale,
      contentKey: item?.contentKey,
      message: error?.message || String(error),
    });
    title = normalizeText(item?.title);
    lines = (item.lines || []).map(line => ({
      translation: locale === 'traditional_chinese'
        ? normalizeText(line?.zh)
        : '',
    }));
    questions = (item.questions || []).map(question => ({
      question: normalizeText(question?.question),
      options: normalizeOptions(question?.options),
      explanation: locale === 'traditional_chinese'
        ? normalizeText(question?.explanation_zh)
        : '',
    }));
  }

  const hasUsefulLineTranslation = lines.some(line => normalizeText(line.translation).length > 0);

  return {
    engine: TRANSLATION_ENGINE,
    locale,
    contentKey: item.contentKey,
    contentHash: item.contentHash,
    title,
    lines,
    questions,
    generatedAt: new Date().toISOString(),
    unavailable: !hasUsefulLineTranslation,
  };
}

export async function getOrCreateContentTranslation(env, locale, item) {
  await ensureContentTranslationSchema(env);

  const contentKey = normalizeText(item?.contentKey);
  const contentHash = normalizeText(item?.contentHash);
  if (!contentKey || !contentHash) {
    throw new HttpError(400, 'contentKey and contentHash are required', 'content_identity_required');
  }

  const cached = await getCachedTranslation(env, contentKey, locale, contentHash);
  if (cached) {
    return cached;
  }

  const payload = await buildTranslationPayload(env, locale, item);
  await saveCachedTranslation(env, contentKey, locale, contentHash, payload);
  return payload;
}
