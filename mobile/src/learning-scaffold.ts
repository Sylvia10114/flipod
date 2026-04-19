import { getLevelWeight } from './clip-utils';
import type { ChallengeWord, Clip, ClipLine, ClipLineWord, Level } from './types';

const MIN_WORD_LENGTH = 4;

function normalizeToken(value: string) {
  return value.replace(/^[^a-zA-Z]+|[^a-zA-Z'-]+$/g, '').toLowerCase();
}

function getWordLevelWeight(cefr?: string) {
  const normalized = (cefr || '').toUpperCase().trim();
  if (normalized === 'A1') return 1;
  if (normalized === 'A2') return 2;
  if (normalized === 'B1') return 3;
  if (normalized === 'B2') return 4;
  if (normalized === 'C1') return 5;
  if (normalized === 'C2') return 6;
  return 0;
}

export function deriveChallengeWords(
  clip: Clip,
  level: Level | string | null,
  knownWords: string[] = [],
  maxWords = 3
): ChallengeWord[] {
  const knownSet = new Set(knownWords.map(item => normalizeToken(item)));
  const targetLevel = Math.min(getLevelWeight(level) + 2, 6);
  const lineCount = clip.lines?.length || 0;
  const seen = new Set<string>();

  const candidates: Array<ChallengeWord & { score: number }> = [];

  (clip.lines || []).forEach((line, lineIndex) => {
    (line.words || []).forEach(word => {
      const normalized = normalizeToken(word.word);
      if (!normalized) return;
      if (normalized.length < MIN_WORD_LENGTH) return;
      if (knownSet.has(normalized)) return;
      if (seen.has(normalized)) return;

      const cefr = (word.cefr || '').toUpperCase().trim();
      if (!cefr || cefr === 'PN' || cefr === 'A1') return;

      const cefrWeight = getWordLevelWeight(cefr);
      if (!cefrWeight) return;

      const levelDistance = Math.abs(cefrWeight - targetLevel);
      const earlyLineBonus = lineCount > 0 ? Math.max(0, 3 - lineIndex) : 0;
      const score = (10 - levelDistance * 2) + earlyLineBonus;

      seen.add(normalized);
      candidates.push({
        word: word.word,
        cefr: word.cefr,
        lineIndex,
        score,
      });
    });
  });

  return candidates
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.lineIndex !== b.lineIndex) return a.lineIndex - b.lineIndex;
      return a.word.localeCompare(b.word);
    })
    .slice(0, maxWords)
    .map(({ word, cefr, lineIndex }) => ({ word, cefr, lineIndex }));
}

export function buildFadeSegments(line: ClipLine, challengeWords: ChallengeWord[], fadeLevel: 0 | 1 | 2) {
  const words = (line.words || []).filter(word => normalizeToken(word.word));
  if (!words.length) {
    return [
      {
        key: `${line.start}-fallback`,
        text: line.en,
        visible: fadeLevel === 0,
        emphasis: false,
      },
    ];
  }

  const challengeSet = new Set(challengeWords.map(item => normalizeToken(item.word)));

  return words.map((word, index) => {
    const normalized = normalizeToken(word.word);
    const isChallenge = challengeSet.has(normalized);
    const isVisible = fadeLevel === 0 || (fadeLevel === 1 && isChallenge);
    return {
      key: `${line.start}-${index}-${normalized}`,
      text: word.word,
      visible: isVisible,
      emphasis: isChallenge,
    };
  });
}

export function collectChallengeLineIndices(words: ChallengeWord[]) {
  return [...new Set(words.map(item => item.lineIndex))];
}
