import type { Clip, LocalizedClipContent, NativeLanguage } from './types';
import { DEFAULT_NATIVE_LANGUAGE } from './types';

export type ContentTranslationRequestItem = {
  contentKey: string;
  contentHash: string;
  title: string;
  lines: Array<{
    en: string;
    zh?: string;
  }>;
  questions: Array<{
    question: string;
    options: string[];
    answer: string;
    explanation_zh?: string;
  }>;
};

export type ContentTranslationResponse = {
  translations: Record<string, LocalizedClipContent>;
};

const DEVICE_LOCALE_ALIASES: Array<{ match: RegExp; language: NativeLanguage }> = [
  { match: /^en\b/i, language: 'english' },
  { match: /^zh-(hant|hk|mo|tw)\b/i, language: 'traditional_chinese' },
  { match: /^zh\b/i, language: 'simplified_chinese' },
  { match: /^ja\b/i, language: 'japanese' },
  { match: /^ko\b/i, language: 'korean' },
  { match: /^es\b/i, language: 'spanish' },
  { match: /^fr\b/i, language: 'french' },
  { match: /^pt(-br)?\b/i, language: 'brazilian_portuguese' },
  { match: /^it\b/i, language: 'italian' },
  { match: /^de\b/i, language: 'german' },
];

function normalizeText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stableHash(input: string) {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(index);
  }
  return `h${(hash >>> 0).toString(16)}`;
}

function getClipSourceParts(clip: Clip) {
  if (typeof clip.source === 'string') {
    return {
      podcast: clip.source,
      episode: '',
      audioUrl: '',
    };
  }

  return {
    podcast: clip.source?.podcast || '',
    episode: clip.source?.episode || '',
    audioUrl: clip.source?.audio_url || clip.audio || clip.cdnAudio || '',
  };
}

export function getDevicePreferredNativeLanguage(): NativeLanguage {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale || '';
  const normalized = locale.toLowerCase();

  for (const candidate of DEVICE_LOCALE_ALIASES) {
    if (candidate.match.test(normalized)) {
      return candidate.language;
    }
  }

  return DEFAULT_NATIVE_LANGUAGE;
}

export function normalizeNativeLanguage(value: unknown): NativeLanguage {
  if (typeof value !== 'string') return DEFAULT_NATIVE_LANGUAGE;
  const normalized = value.trim().toLowerCase();
  return (
    DEVICE_LOCALE_ALIASES.find(candidate => candidate.language === normalized)?.language
    || ([
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
    ] as NativeLanguage[]).find(item => item === normalized)
    || DEFAULT_NATIVE_LANGUAGE
  );
}

export function deriveClipContentKey(clip: Clip, index = 0) {
  if (clip.contentKey) return clip.contentKey;

  const source = getClipSourceParts(clip);
  const explicitId = Number.isInteger(clip.id) ? `clip:${clip.id}` : '';
  if (explicitId) return explicitId;

  return [
    'clip',
    source.audioUrl || source.podcast || 'unknown',
    source.episode || '',
    normalizeText(clip.title),
    String(index),
  ].join('|');
}

export function deriveClipContentHash(clip: Clip) {
  if (clip.contentHash) return clip.contentHash;

  const payload = JSON.stringify({
    title: normalizeText(clip.title),
    topic: normalizeText(String(clip.topic || clip.tag || '')),
    lines: (clip.lines || []).map(line => ({
      en: normalizeText(line.en),
      zh: normalizeText(line.zh),
      start: line.start,
      end: line.end,
    })),
    questions: (clip.questions || []).map(question => ({
      question: normalizeText(question.question),
      options: (question.options || []).map(option => normalizeText(option)),
      answer: normalizeText(question.answer),
      explanation_zh: normalizeText(question.explanation_zh),
    })),
  });

  return stableHash(payload);
}

export function ensureClipContentIdentity(clip: Clip, index = 0): Clip {
  return {
    ...clip,
    contentKey: deriveClipContentKey(clip, index),
    contentHash: deriveClipContentHash(clip),
  };
}

export function buildContentTranslationCacheKey(contentKey: string, locale: NativeLanguage, contentHash: string) {
  return `${contentKey}:${locale}:${contentHash}`;
}

export function buildContentTranslationRequestItem(clip: Clip, index = 0): ContentTranslationRequestItem {
  const normalized = ensureClipContentIdentity(clip, index);
  return {
    contentKey: normalized.contentKey || deriveClipContentKey(normalized, index),
    contentHash: normalized.contentHash || deriveClipContentHash(normalized),
    title: normalized.title,
    lines: (normalized.lines || []).map(line => ({
      en: line.en,
      zh: line.zh,
    })),
    questions: (normalized.questions || []).map(question => ({
      question: question.question,
      options: question.options || [],
      answer: question.answer,
      explanation_zh: question.explanation_zh || '',
    })),
  };
}

export function shouldRequestRemoteTranslations(nativeLanguage: NativeLanguage) {
  return nativeLanguage !== 'simplified_chinese';
}

export function buildLocalizedClip(
  clip: Clip,
  locale: NativeLanguage,
  overlay: LocalizedClipContent | null | undefined,
  unavailableMessage = ''
): Clip {
  const normalized = ensureClipContentIdentity(clip);
  const lines = (normalized.lines || []).map((line, index) => {
    let translation = overlay?.lines?.[index]?.translation || '';

    if (!translation) {
      if (locale === 'english') {
        translation = line.en;
      } else if (locale === 'simplified_chinese') {
        translation = line.zh || '';
      } else if (locale === 'traditional_chinese') {
        translation = line.zh || unavailableMessage;
      } else {
        translation = unavailableMessage;
      }
    }

    return {
      ...line,
      zh: translation,
    };
  });

  const questions = (normalized.questions || []).map((question, index) => ({
    ...question,
    explanation_zh: overlay?.questions?.[index]?.explanation
      || (locale === 'simplified_chinese'
        ? question.explanation_zh || ''
        : locale === 'traditional_chinese'
          ? question.explanation_zh || unavailableMessage
          : unavailableMessage),
  }));

  return {
    ...normalized,
    lines,
    questions,
  };
}
