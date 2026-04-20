import { errorResponse, HttpError, json, noContent, readJson } from '../../_lib/http.js';

const PROMPT_VERSION = 'v3.1.0';
const MAX_RETRIES = 2;
const ALLOWED_CATEGORIES = ['business', 'psychology', 'science', 'tech', 'culture', 'general'];
const CEFR_RANKS = { A1: 0, A2: 1, B1: 2, B2: 3, C1: 4, C2: 5 };

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeUserCefr(value) {
  const normalized = String(value || '').toUpperCase().trim();
  if (normalized === 'A1' || normalized === 'A2' || normalized === 'A1-A2') return 'A2';
  if (normalized === 'B1') return 'B1';
  if (normalized === 'B2') return 'B2';
  if (normalized === 'C1' || normalized === 'C2' || normalized === 'C1-C2') return 'C1';
  return 'B1';
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

async function callAzureOpenAiJson(env, messages, maxCompletionTokens = 3200) {
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
      temperature: 0.7,
      max_completion_tokens: maxCompletionTokens,
      response_format: { type: 'json_object' },
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Azure OpenAI returned ${response.status}: ${text.slice(0, 300)}`);
  }

  const payload = JSON.parse(text);
  return {
    content: payload?.choices?.[0]?.message?.content || '',
    usage: payload?.usage || null,
  };
}

function buildPracticePrompt({ words, interests, userCefr, retryHint }) {
  const wordList = words.map(item => item.word).join(', ');
  const retrySuffix = retryHint
    ? `\n\nPrevious attempt failed validation: ${retryHint}. Fix these specific issues.`
    : '';

  return `You are generating a short English listening practice passage for a CEFR ${userCefr} learner.
Target vocabulary: ${wordList}
Learner interests: ${(interests || []).join(', ') || 'general'}

Passage requirements:
1. Natural spoken-English mini passage, 80-150 words, 6-8 sentences.
2. Use every target word naturally, and each target word must appear exactly once.
3. The passage should feel like a short podcast/storytelling narration, not textbook prose.
4. Keep non-target vocabulary mostly within CEFR ${userCefr} or easier.
5. Provide line-by-line Simplified Chinese translations aligned to each sentence.
6. Provide one short Chinese gist.
7. Create ONE English multiple-choice comprehension question about the main point.
8. Provide EXACTLY 4 English options and a correct index 0-3.
9. Provide a short Chinese explanation for why the correct answer is right.
10. Classify the passage into EXACTLY ONE category: ${ALLOWED_CATEGORIES.join(', ')}.
11. Return target_word_contexts for each target word with sentence_index, definition_zh, cefr, ipa.
12. Return vocab_in_text for extra advanced words in the passage (excluding target words), with word, cefr, zh, ipa, sentence_index.
13. Also return topic_en as a short English learner-facing title.

Return strict JSON only. Schema:
{
  "title": "<optional localized title>",
  "topic_en": "<short English title>",
  "category": "<business|psychology|science|tech|culture|general>",
  "lines": [{ "en": "...", "zh": "..." }],
  "gist_zh": "<Chinese gist>",
  "mcq": {
    "q": "<English question>",
    "options": ["<A>", "<B>", "<C>", "<D>"],
    "correct": 0,
    "explanation": "<Chinese explanation>"
  },
  "target_word_contexts": [
    { "word": "<en>", "sentence_index": 0, "definition_zh": "<zh>", "cefr": "<A1-C2>", "ipa": "<ipa>" }
  ],
  "vocab_in_text": [
    { "word": "<en>", "cefr": "<A1-C2>", "zh": "<zh>", "ipa": "<ipa>", "sentence_index": 0 }
  ]
}${retrySuffix}`;
}

function countWordOccurrences(text, word) {
  const normalized = normalizeText(text).toLowerCase();
  const target = normalizeText(word).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!target) return 0;
  const matches = normalized.match(new RegExp(`\\b${target}\\b`, 'g'));
  return matches ? matches.length : 0;
}

function validatePractice(json, expected) {
  const errors = [];

  if (!json || typeof json !== 'object') {
    return { ok: false, errors: ['root_not_object'] };
  }

  if (!Array.isArray(json.lines)) {
    errors.push('lines_missing');
  } else {
    const wordCount = json.lines
      .map(line => normalizeText(line?.en))
      .join(' ')
      .split(/\s+/)
      .filter(Boolean)
      .length;
    if (wordCount < 80 || wordCount > 170) {
      errors.push(`word_count_${wordCount}`);
    }
    if (json.lines.length < 6 || json.lines.length > 8) {
      errors.push(`line_count_${json.lines.length}`);
    }
    json.lines.forEach((line, index) => {
      if (!normalizeText(line?.en) || !normalizeText(line?.zh)) {
        errors.push(`line_${index}_missing_content`);
      }
    });
  }

  const fullText = Array.isArray(json.lines)
    ? json.lines.map(line => normalizeText(line?.en)).join(' ')
    : '';

  for (const word of expected.target_words || []) {
    const count = countWordOccurrences(fullText, word);
    if (count !== 1) {
      errors.push(`target_word_${word}_count_${count}`);
    }
  }

  if (!normalizeText(json.topic_en)) {
    errors.push('topic_en_missing');
  }
  if (!normalizeText(json.gist_zh)) {
    errors.push('gist_missing');
  }
  if (!ALLOWED_CATEGORIES.includes(json.category)) {
    errors.push(`invalid_category_${json.category}`);
  }

  if (!json.mcq || typeof json.mcq !== 'object') {
    errors.push('mcq_missing');
  } else {
    if (!normalizeText(json.mcq.q)) errors.push('mcq_question_missing');
    if (!Array.isArray(json.mcq.options) || json.mcq.options.length !== 4) {
      errors.push('mcq_options_invalid');
    }
    if (!Number.isInteger(json.mcq.correct) || json.mcq.correct < 0 || json.mcq.correct > 3) {
      errors.push('mcq_correct_invalid');
    }
    if (!normalizeText(json.mcq.explanation)) {
      errors.push('mcq_explanation_missing');
    }
  }

  if (!Array.isArray(json.target_word_contexts) || json.target_word_contexts.length < expected.target_words.length) {
    errors.push('target_word_contexts_missing');
  }

  return { ok: errors.length === 0, errors };
}

function buildPracticeFromLlm(json, expected) {
  const lines = (json.lines || []).map((line, index) => {
    const sentence = normalizeText(line?.en);
    const translation = normalizeText(line?.zh);
    const wordCount = sentence.split(/\s+/).filter(Boolean).length;
    const duration = Math.max(3.6, Math.min(7.2, wordCount * 0.52));
    const start = index === 0 ? 0 : 0;
    return {
      en: sentence,
      zh: translation,
      start,
      end: duration,
      target_words: expected.target_words.filter(word => countWordOccurrences(sentence, word) > 0),
    };
  });

  let cursor = 0;
  const timedLines = lines.map(line => {
    const duration = line.end;
    const start = Number(cursor.toFixed(1));
    const end = Number((cursor + duration).toFixed(1));
    cursor = end;
    return {
      ...line,
      start,
      end,
    };
  });

  return {
    id: `gp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: normalizeText(json.topic_en) || normalizeText(json.title) || 'Guided practice',
    tag: ALLOWED_CATEGORIES.includes(json.category) ? json.category : 'general',
    category: ALLOWED_CATEGORIES.includes(json.category) ? json.category : 'general',
    cefr: expected.user_cefr,
    topicKey: ALLOWED_CATEGORIES.includes(json.category) ? json.category : 'general',
    target_words: expected.target_words.slice(),
    text: timedLines.map(line => line.en).join(' '),
    gist_zh: normalizeText(json.gist_zh),
    lines: timedLines,
    vocabulary: (json.target_word_contexts || []).map(item => ({
      word: normalizeText(item.word),
      definition_zh: normalizeText(item.definition_zh),
      cefr: normalizeText(item.cefr).toUpperCase(),
      ipa: normalizeText(item.ipa),
    })),
    target_word_contexts: (json.target_word_contexts || []).map(item => ({
      word: normalizeText(item.word),
      sentence_index: Number.isInteger(item.sentence_index) ? item.sentence_index : null,
      definition_zh: normalizeText(item.definition_zh),
      cefr: normalizeText(item.cefr).toUpperCase(),
      ipa: normalizeText(item.ipa),
    })),
    vocab_in_text: Array.isArray(json.vocab_in_text)
      ? json.vocab_in_text.map(item => ({
          word: normalizeText(item.word),
          cefr: normalizeText(item.cefr).toUpperCase(),
          zh: normalizeText(item.zh),
          ipa: normalizeText(item.ipa),
          sentence_index: Number.isInteger(item.sentence_index) ? item.sentence_index : null,
        }))
      : [],
    mcq: json.mcq
      ? {
          q: normalizeText(json.mcq.q),
          options: Array.isArray(json.mcq.options) ? json.mcq.options.map(option => normalizeText(option)).slice(0, 4) : [],
          correct: Number.isInteger(json.mcq.correct) ? json.mcq.correct : 0,
          explanation: normalizeText(json.mcq.explanation),
        }
      : null,
    generatedAt: Date.now(),
    generatedBy: 'llm',
    generationVersion: PROMPT_VERSION,
  };
}

async function generatePracticeWithValidation(env, payload) {
  let retryHint = null;
  let lastErrors = [];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const prompt = buildPracticePrompt({
      words: payload.target_word_objs,
      interests: payload.interests,
      userCefr: payload.user_cefr,
      retryHint,
    });
    const response = await callAzureOpenAiJson(env, [
      {
        role: 'system',
        content: 'You generate concise JSON for a mobile listening-practice system. Return strict JSON only.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ]);

    const parsed = extractJsonObject(response.content);
    const validation = validatePractice(parsed, payload);
    if (validation.ok) {
      return {
        practice: buildPracticeFromLlm(parsed, payload),
        meta: {
          promptVersion: PROMPT_VERSION,
          usage: response.usage,
          attempts: attempt + 1,
        },
      };
    }

    lastErrors = validation.errors;
    retryHint = validation.errors.slice(0, 3).join('; ');
  }

  throw new HttpError(422, `Practice generation failed validation: ${lastErrors.join(', ')}`, 'practice_validation_failed');
}

export async function onRequestOptions() {
  return noContent();
}

export async function onRequestPost(context) {
  try {
    const body = await readJson(context.request);
    const targetWordObjs = Array.isArray(body?.target_words)
      ? body.target_words
          .map(item => ({
            word: normalizeText(item?.word || item),
            cefr: normalizeText(item?.cefr).toUpperCase() || 'B1',
            tag: normalizeText(item?.tag).toLowerCase(),
            definition_zh: normalizeText(item?.definition_zh),
          }))
          .filter(item => item.word)
      : [];

    if (targetWordObjs.length < 3) {
      throw new HttpError(400, 'At least 3 target words are required', 'practice_target_words_required');
    }

    const payload = {
      target_words: targetWordObjs.map(item => item.word),
      target_word_objs: targetWordObjs,
      interests: Array.isArray(body?.interests) ? body.interests.map(item => normalizeText(item).toLowerCase()).filter(Boolean) : [],
      user_cefr: normalizeUserCefr(body?.user_cefr),
    };

    const result = await generatePracticeWithValidation(context.env, payload);
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
