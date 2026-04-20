import type {
  GeneratedPractice,
  GeneratedPracticeState,
  Level,
  LocalizedClipContent,
  NativeLanguage,
  VocabEntry,
} from './types';

export const PRACTICE_UNLOCK_COUNT = 5;
export const PRACTICE_REFRESH_DELTA = 3;
export const PRACTICE_BATCH_SIZE = 2;
export const PRACTICE_MAX_PENDING = 6;
export const PRACTICE_PROMPT_VERSION = 'v3.1.0';

const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

function normalizeText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stableHash(input: string) {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(index);
  }
  return `hp${(hash >>> 0).toString(16)}`;
}

function normalizeWord(value: string) {
  return String(value || '').trim().toLowerCase();
}

function clampPracticeCefr(level: string | null | undefined) {
  const normalized = String(level || '').toUpperCase().trim();
  if (normalized === 'A1' || normalized === 'A2' || normalized === 'A1-A2') return 'A2';
  if (normalized === 'B1') return 'B1';
  if (normalized === 'B2') return 'B2';
  if (normalized === 'C1' || normalized === 'C2' || normalized === 'C1-C2') return 'C1';
  return 'B1';
}

export function normalizeUserPracticeCefr(level: Level | string | null | undefined) {
  return clampPracticeCefr(level);
}

export function createDefaultGeneratedPracticeState(): GeneratedPracticeState {
  return {
    lastGeneratedAt: 0,
    lastVocabCountAtGeneration: 0,
    pendingPractices: [],
    completedPractices: [],
    generationVersion: PRACTICE_PROMPT_VERSION,
    generating: false,
    lastGenerationError: null,
  };
}

export function normalizeGeneratedPracticeState(
  state: Partial<GeneratedPracticeState> | null | undefined
): GeneratedPracticeState {
  const base = createDefaultGeneratedPracticeState();
  if (!state || typeof state !== 'object') return base;
  return {
    lastGeneratedAt: Number(state.lastGeneratedAt || 0),
    lastVocabCountAtGeneration: Number(state.lastVocabCountAtGeneration || 0),
    pendingPractices: Array.isArray(state.pendingPractices) ? state.pendingPractices : [],
    completedPractices: Array.isArray(state.completedPractices) ? state.completedPractices : [],
    generationVersion: state.generationVersion || PRACTICE_PROMPT_VERSION,
    generating: Boolean(state.generating),
    lastGenerationError: state.lastGenerationError || null,
  };
}

export function buildGeneratedPracticeContentKey(practice: GeneratedPractice) {
  if (practice.contentKey) return practice.contentKey;
  return `practice:${practice.id}`;
}

export function buildGeneratedPracticeContentHash(practice: GeneratedPractice) {
  if (practice.contentHash) return practice.contentHash;
  return stableHash(
    JSON.stringify({
      id: practice.id,
      title: normalizeText(practice.title),
      lines: (practice.lines || []).map(line => ({
        en: normalizeText(line.en),
        zh: normalizeText(line.zh),
      })),
      mcq: practice.mcq
        ? {
            q: normalizeText(practice.mcq.q),
            options: (practice.mcq.options || []).map(option => normalizeText(option)),
            correct: practice.mcq.correct,
            explanation: normalizeText(practice.mcq.explanation),
          }
        : null,
    })
  );
}

export function ensureGeneratedPracticeIdentity(practice: GeneratedPractice): GeneratedPractice {
  return {
    ...practice,
    contentKey: buildGeneratedPracticeContentKey(practice),
    contentHash: buildGeneratedPracticeContentHash(practice),
  };
}

export function buildGeneratedPracticeTranslationRequestItem(practice: GeneratedPractice) {
  const normalized = ensureGeneratedPracticeIdentity(practice);
  return {
    contentKey: normalized.contentKey || buildGeneratedPracticeContentKey(normalized),
    contentHash: normalized.contentHash || buildGeneratedPracticeContentHash(normalized),
    title: normalized.title,
    lines: (normalized.lines || []).map(line => ({
      en: line.en,
      zh: line.zh,
    })),
    questions: normalized.mcq
      ? [
          {
            question: normalized.mcq.q,
            options: normalized.mcq.options || [],
            answer: String(normalized.mcq.correct),
            explanation_zh: normalized.mcq.explanation || '',
          },
        ]
      : [],
  };
}

export function buildLocalizedGeneratedPractice(
  practice: GeneratedPractice,
  locale: NativeLanguage,
  overlay: LocalizedClipContent | null | undefined,
  unavailableMessage = ''
): GeneratedPractice {
  const normalized = ensureGeneratedPracticeIdentity(practice);
  const lines = (normalized.lines || []).map((line, index) => {
    let translation = overlay?.lines?.[index]?.translation || '';
    if (!translation) {
      if (locale === 'english') {
        translation = line.en;
      } else if (locale === 'simplified_chinese' || locale === 'traditional_chinese') {
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

  const mcq = normalized.mcq
    ? {
        ...normalized.mcq,
        explanation:
          overlay?.questions?.[0]?.explanation
          || (
            locale === 'simplified_chinese' || locale === 'traditional_chinese'
              ? normalized.mcq.explanation
              : unavailableMessage
          ),
      }
    : null;

  return {
    ...normalized,
    title: normalizeText(overlay?.title) || normalized.title,
    lines,
    mcq,
  };
}

export function shouldRefreshGeneratedPracticeTitle(
  practice: GeneratedPractice,
  locale: NativeLanguage,
  overlay: LocalizedClipContent | null | undefined
) {
  const overlayTitle = normalizeText(overlay?.title);
  const sourceTitle = normalizeText(practice.title);
  if (!overlayTitle) return true;
  if (locale === 'english' || locale === 'simplified_chinese' || locale === 'traditional_chinese') {
    return false;
  }
  return /[\u3400-\u9fff]/.test(sourceTitle) && overlayTitle === sourceTitle;
}

function cefrIndex(level: string | undefined) {
  const normalized = String(level || '').toUpperCase().trim();
  const index = CEFR_ORDER.indexOf(normalized as (typeof CEFR_ORDER)[number]);
  return index >= 0 ? index : CEFR_ORDER.indexOf('B1');
}

export function nextPracticeCandidates(vocab: VocabEntry[], state: GeneratedPracticeState) {
  const recent = new Set(
    (state.completedPractices || [])
      .slice(-3)
      .flatMap(item => item.target_words || [])
      .map(normalizeWord)
  );
  const pending = new Set(
    (state.pendingPractices || [])
      .flatMap(item => item.target_words || [])
      .map(normalizeWord)
  );

  const filtered = vocab.filter(item => {
    const key = normalizeWord(item.word);
    return key && !recent.has(key) && !pending.has(key);
  });
  if (filtered.length >= 3) return filtered;

  const withoutPending = vocab.filter(item => {
    const key = normalizeWord(item.word);
    return key && !pending.has(key);
  });
  return withoutPending.length >= 3 ? withoutPending : vocab.slice();
}

export function scorePracticeVocabCandidates(
  vocab: VocabEntry[],
  state: GeneratedPracticeState,
  interests: string[],
  userCefr: string
) {
  const pool = nextPracticeCandidates(vocab, state);
  const lowerInterests = (interests || []).map(item => normalizeWord(item));
  const userIdx = cefrIndex(userCefr);

  return pool
    .map(item => {
      const key = normalizeWord(item.word);
      if (!key) return null;

      const savedAt =
        item.timestamp
        || Date.parse(item.updatedAt || '')
        || Date.parse(item.createdAt || '')
        || Date.now();
      const ageDays = (Date.now() - savedAt) / 86400000;
      const freshness = Math.max(0.3, 1 - (ageDays / 14));
      const freshScore = 60 * freshness;

      const tagLower = normalizeWord(item.tag || '');
      const tagMatch = tagLower && lowerInterests.includes(tagLower);
      const interestScore = tagMatch ? 30 : 0;
      const interestBonus = tagMatch ? 100 : 0;

      const diff = Math.abs(cefrIndex(item.cefr) - userIdx);
      const levelScore = diff === 0 ? 10 : diff === 1 ? 8 : diff === 2 ? 3 : 0;

      return {
        item,
        score: freshScore + interestScore + levelScore + interestBonus,
      };
    })
    .filter(Boolean)
    .sort((left, right) => (right?.score || 0) - (left?.score || 0)) as Array<{
      item: VocabEntry;
      score: number;
    }>;
}

export function chooseWordsForPractice(
  pool: VocabEntry[],
  interests: string[]
) {
  if (pool.length < 3) return null;
  const lowerInterests = (interests || []).map(item => normalizeWord(item));
  const byInterest = pool.filter(item => {
    const tag = normalizeWord(item.tag || '');
    return tag && lowerInterests.includes(tag);
  });
  const picked = (byInterest.length >= 3 ? byInterest : pool).slice(0, 3);
  return picked.length === 3 ? picked : null;
}

export function planGeneratedPracticeBatch(
  vocab: VocabEntry[],
  state: GeneratedPracticeState,
  interests: string[],
  userLevel: Level | string | null,
  requestedCount = PRACTICE_BATCH_SIZE
) {
  const userCefr = normalizeUserPracticeCefr(userLevel);
  const available = Math.min(requestedCount, PRACTICE_MAX_PENDING - (state.pendingPractices || []).length);
  if (available <= 0) return [];

  const scored = scorePracticeVocabCandidates(vocab, state, interests, userCefr);
  if (scored.length < 3) return [];
  let pool = scored.map(item => item.item);
  const batches: VocabEntry[][] = [];

  for (let index = 0; index < available; index += 1) {
    const words = chooseWordsForPractice(pool, interests);
    if (!words) break;
    batches.push(words);
    const used = new Set(words.map(item => normalizeWord(item.word)));
    pool = pool.filter(item => !used.has(normalizeWord(item.word)));
  }

  return batches;
}

export function withGeneratedPracticesAppended(
  state: GeneratedPracticeState,
  practices: GeneratedPractice[],
  vocabCount: number
): GeneratedPracticeState {
  return {
    ...state,
    pendingPractices: [...(state.pendingPractices || []), ...practices].slice(0, PRACTICE_MAX_PENDING),
    lastGeneratedAt: Date.now(),
    lastVocabCountAtGeneration: vocabCount,
    generationVersion:
      practices.find(item => item.generationVersion)?.generationVersion
      || state.generationVersion
      || PRACTICE_PROMPT_VERSION,
    generating: false,
    lastGenerationError: null,
  };
}

export function completeGeneratedPractice(
  state: GeneratedPracticeState,
  practiceId: string
): GeneratedPracticeState {
  const practice = (state.pendingPractices || []).find(item => item.id === practiceId);
  if (!practice) return state;
  const completedPractice = {
    ...practice,
    completedAt: Date.now(),
  };

  return {
    ...state,
    pendingPractices: (state.pendingPractices || []).filter(item => item.id !== practiceId),
    completedPractices: [...(state.completedPractices || []), completedPractice].slice(-24),
  };
}

export function buildGeneratedPracticeReason(words: VocabEntry[]) {
  const labels = words.map(item => item.word).slice(0, 3);
  return labels.join(' / ');
}
