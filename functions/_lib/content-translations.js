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

const GOOGLE_LANGUAGE_CODES = {
  english: 'en',
  simplified_chinese: 'zh-CN',
  traditional_chinese: 'zh-TW',
  japanese: 'ja',
  korean: 'ko',
  spanish: 'es',
  french: 'fr',
  brazilian_portuguese: 'pt-BR',
  italian: 'it',
  german: 'de',
};

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function normalizeContentLocale(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return SUPPORTED_LOCALES.has(normalized) ? normalized : 'english';
}

async function translateText(text, sourceLanguage, targetLanguage) {
  const normalized = normalizeText(text);
  if (!normalized) return '';
  if (sourceLanguage === targetLanguage) return normalized;

  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', sourceLanguage);
  url.searchParams.set('tl', targetLanguage);
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', normalized);

  const response = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'flipod-content-translations/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Translation provider returned ${response.status}`);
  }

  const payload = await response.json();
  const segments = Array.isArray(payload?.[0]) ? payload[0] : [];
  return segments.map(item => item?.[0] || '').join('').trim();
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
    return JSON.parse(row.payload);
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

async function translateLine(line, locale) {
  if (locale === 'english') {
    return normalizeText(line?.en);
  }

  if (locale === 'simplified_chinese') {
    return normalizeText(line?.zh) || await translateText(line?.en, 'en', GOOGLE_LANGUAGE_CODES[locale]);
  }

  if (locale === 'traditional_chinese') {
    const legacyZh = normalizeText(line?.zh);
    if (legacyZh) {
      return translateText(legacyZh, 'zh-CN', GOOGLE_LANGUAGE_CODES[locale]);
    }
    return translateText(line?.en, 'en', GOOGLE_LANGUAGE_CODES[locale]);
  }

  return translateText(line?.en, 'en', GOOGLE_LANGUAGE_CODES[locale]);
}

async function translateExplanation(question, locale) {
  if (locale === 'simplified_chinese') {
    return normalizeText(question?.explanation_zh)
      || await translateText(buildEnglishExplanationFallback(question), 'en', GOOGLE_LANGUAGE_CODES[locale]);
  }

  if (locale === 'traditional_chinese') {
    const legacyZh = normalizeText(question?.explanation_zh);
    if (legacyZh) {
      return translateText(legacyZh, 'zh-CN', GOOGLE_LANGUAGE_CODES[locale]);
    }
    return translateText(buildEnglishExplanationFallback(question), 'en', GOOGLE_LANGUAGE_CODES[locale]);
  }

  if (locale === 'english') {
    const legacyZh = normalizeText(question?.explanation_zh);
    if (legacyZh) {
      return translateText(legacyZh, 'zh-CN', GOOGLE_LANGUAGE_CODES[locale]);
    }
    return buildEnglishExplanationFallback(question);
  }

  const legacyZh = normalizeText(question?.explanation_zh);
  if (legacyZh) {
    return translateText(legacyZh, 'zh-CN', GOOGLE_LANGUAGE_CODES[locale]);
  }
  return translateText(buildEnglishExplanationFallback(question), 'en', GOOGLE_LANGUAGE_CODES[locale]);
}

async function buildTranslationPayload(locale, item) {
  const lines = [];
  for (const line of item.lines || []) {
    try {
      lines.push({
        translation: await translateLine(line, locale),
      });
    } catch {
      lines.push({
        translation: locale === 'english'
          ? normalizeText(line?.en)
          : locale === 'simplified_chinese'
            ? normalizeText(line?.zh)
            : '',
      });
    }
  }

  const questions = [];
  for (const question of item.questions || []) {
    try {
      questions.push({
        explanation: await translateExplanation(question, locale),
      });
    } catch {
      questions.push({
        explanation: locale === 'simplified_chinese'
          ? normalizeText(question?.explanation_zh)
          : locale === 'english'
            ? buildEnglishExplanationFallback(question)
            : '',
      });
    }
  }

  const hasUsefulLineTranslation = lines.some(line => normalizeText(line.translation).length > 0);

  return {
    locale,
    contentKey: item.contentKey,
    contentHash: item.contentHash,
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

  const payload = await buildTranslationPayload(locale, item);
  await saveCachedTranslation(env, contentKey, locale, contentHash, payload);
  return payload;
}
