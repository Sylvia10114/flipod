import type {
  Clip,
  ClipManifestEntry,
  Level,
  LikeEvent,
  RankRequest,
  RankedFeedItem,
  Topic,
} from './types';
import { ensureClipContentIdentity } from './content-localization';

const VALID_TOPICS: Topic[] = [
  'science',
  'business',
  'psychology',
  'story',
  'history',
  'culture',
  'tech',
  'society',
];

const TOPIC_ALIASES: Record<string, Topic> = {
  storytelling: 'story',
  technology: 'tech',
  social: 'society',
  'pop culture': 'culture',
};

const LEGACY_DIFFICULTY_SCORES: Record<string, number> = {
  easy: 30,
  medium: 55,
  hard: 80,
  'a1-a2': 25,
  b1: 45,
  'b1+': 52,
  b2: 65,
  'c1-c2': 82,
};

const WORD_LEVEL_SCORES: Record<string, number> = {
  A1: 10,
  A2: 22,
  B1: 40,
  B2: 62,
  C1: 80,
  C2: 92,
};

const LEVEL_TARGET_CENTERS: Record<Level, number> = {
  'A1-A2': 25,
  B1: 45,
  B2: 65,
  'C1-C2': 82,
};

const STARTER_PATTERN: Array<'primary' | 'adjacent' | 'probe'> = [
  'primary',
  'primary',
  'adjacent',
  'primary',
  'primary',
  'probe',
  'primary',
  'adjacent',
  'primary',
  'primary',
];

const TOPIC_ADJACENCY: Record<Topic, Topic[]> = {
  science: ['tech'],
  business: ['psychology'],
  psychology: ['business'],
  story: ['history'],
  history: ['story', 'culture', 'society'],
  culture: ['story', 'history'],
  tech: ['science'],
  society: ['history'],
};

type FeedBucket = 'primary' | 'adjacent' | 'probe' | 'other';

type RankedCandidate = ClipManifestEntry & {
  bucket: FeedBucket;
  rankScore: number;
  likeBoost: number;
  skipPenalty: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function allocateClipId(preferredId: number | undefined, index: number, clipCount: number, usedIds: Set<number>) {
  if (Number.isInteger(preferredId) && !usedIds.has(preferredId as number)) {
    const nextId = preferredId as number;
    usedIds.add(nextId);
    return nextId;
  }

  let fallbackId = clipCount + index;
  while (usedIds.has(fallbackId)) {
    fallbackId += 1;
  }
  usedIds.add(fallbackId);
  return fallbackId;
}

export function normalizeTopic(value?: string | null): Topic {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();

  if ((VALID_TOPICS as string[]).includes(normalized)) {
    return normalized as Topic;
  }

  if (TOPIC_ALIASES[normalized]) {
    return TOPIC_ALIASES[normalized];
  }

  return 'story';
}

function getDurationSeconds(clip: Clip) {
  if (typeof clip.duration === 'number' && Number.isFinite(clip.duration)) {
    return Number(clip.duration.toFixed(1));
  }

  const lastLine = clip.lines?.[clip.lines.length - 1];
  const end = typeof lastLine?.end === 'number' && Number.isFinite(lastLine.end) ? lastLine.end : 0;
  return Number(end.toFixed(1));
}

function difficultyFromLegacy(value?: string | null) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return LEGACY_DIFFICULTY_SCORES[normalized] ?? null;
}

function deriveDifficultyScore(clip: Clip, durationSeconds: number) {
  const levelScores: number[] = [];
  let totalWords = 0;

  for (const line of clip.lines || []) {
    const words = line.words || [];
    totalWords += words.length;
    for (const word of words) {
      const cefr = String(word.cefr || '')
        .trim()
        .toUpperCase();
      if (WORD_LEVEL_SCORES[cefr]) {
        levelScores.push(WORD_LEVEL_SCORES[cefr]);
      }
    }
  }

  if (!levelScores.length) {
    return 55;
  }

  const avgLevel = levelScores.reduce((sum, value) => sum + value, 0) / levelScores.length;
  const avgSentenceWords = totalWords / Math.max(clip.lines?.length || 0, 1);
  const wordsPerMinute = durationSeconds > 0 ? (totalWords / durationSeconds) * 60 : 150;

  const sentenceBonus = clamp((avgSentenceWords - 12) * 0.9, -6, 8);
  const paceBonus = clamp((wordsPerMinute - 150) * 0.1, -8, 10);

  return clamp(Math.round(avgLevel + sentenceBonus + paceBonus), 0, 100);
}

export function getSourceLabel(source: Clip['source']) {
  if (typeof source === 'string') return source || 'Unknown Source';
  return source?.podcast || source?.episode || 'Unknown Source';
}

export function normalizeClip(clip: Clip, index: number): Clip {
  const contentNormalized = ensureClipContentIdentity(clip, index);
  const topic = normalizeTopic((clip.topic as string | undefined) ?? clip.tag);
  const duration = getDurationSeconds(contentNormalized);
  const difficultyScore = typeof contentNormalized.difficulty_score === 'number' && Number.isFinite(contentNormalized.difficulty_score)
    ? clamp(Math.round(contentNormalized.difficulty_score), 0, 100)
    : difficultyFromLegacy(contentNormalized.difficulty) ?? deriveDifficultyScore(contentNormalized, duration);

  return {
    ...contentNormalized,
    id: Number.isInteger(contentNormalized.id) ? contentNormalized.id : undefined,
    topic,
    tag: topic,
    duration,
    difficulty_score: difficultyScore,
  };
}

export function normalizeClips(clips: Clip[]) {
  const usedIds = new Set<number>();
  const clipCount = clips.length;

  return clips.map((clip, index) => {
    const normalized = normalizeClip(clip, index);
    return {
      ...normalized,
      id: allocateClipId(
        Number.isInteger(normalized.id) ? (normalized.id as number) : undefined,
        index,
        clipCount,
        usedIds
      ),
    };
  });
}

export function buildClipManifest(clips: Clip[]): ClipManifestEntry[] {
  return normalizeClips(clips).map(normalized => {
    const topic = normalizeTopic(normalized.topic as string);
    const duration = typeof normalized.duration === 'number' ? normalized.duration : 0;
    const difficultyScore = typeof normalized.difficulty_score === 'number' ? normalized.difficulty_score : 55;
    const source = getSourceLabel(normalized.source);
    return {
      id: normalized.id as number,
      topic,
      source,
      duration,
      difficulty_score: difficultyScore,
    };
  });
}

function getTargetCenter(level: Level) {
  return LEVEL_TARGET_CENTERS[level] ?? LEVEL_TARGET_CENTERS.B1;
}

function getAdjacentTopics(interests: Topic[]) {
  const adjacent = new Set<Topic>();
  for (const interest of interests) {
    for (const topic of TOPIC_ADJACENCY[interest] || []) {
      if (!interests.includes(topic)) {
        adjacent.add(topic);
      }
    }
  }
  return adjacent;
}

function getPattern(maxItems: number) {
  if (maxItems <= STARTER_PATTERN.length) {
    return STARTER_PATTERN.slice(0, maxItems);
  }

  const pattern = [...STARTER_PATTERN];
  while (pattern.length < maxItems) {
    pattern.push('primary');
  }
  return pattern;
}

function sortCandidates(
  clips: ClipManifestEntry[],
  targetCenter: number,
  likedTopics: Set<Topic>,
  skippedClipIds: Set<number>
) {
  return [...clips].sort((a, b) => {
    const aBase = Math.abs(a.difficulty_score - targetCenter);
    const bBase = Math.abs(b.difficulty_score - targetCenter);
    const aLikeBoost = likedTopics.has(a.topic) ? 4 : 0;
    const bLikeBoost = likedTopics.has(b.topic) ? 4 : 0;
    const aSkipPenalty = skippedClipIds.has(a.id) ? 18 : 0;
    const bSkipPenalty = skippedClipIds.has(b.id) ? 18 : 0;

    const aScore = aBase - aLikeBoost + aSkipPenalty;
    const bScore = bBase - bLikeBoost + bSkipPenalty;

    if (aScore !== bScore) return aScore - bScore;
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return a.id - b.id;
  });
}

function buildReason(
  clip: ClipManifestEntry,
  level: Level,
  bucket: FeedBucket,
  interests: Set<Topic>,
  adjacentTopics: Set<Topic>
) {
  if (bucket === 'probe') {
    return `这条难度最贴近你当前的 ${level} 区间，先用来校准后面的推荐。`;
  }

  if (interests.has(clip.topic)) {
    return `先从你选过的 ${clip.topic} 开始，难度也更贴近 ${level}。`;
  }

  if (adjacentTopics.has(clip.topic)) {
    return `插一条相邻的 ${clip.topic}，换个方向但不跳太远。`;
  }

  return `先给你一条难度可控的新方向，避免 feed 太单一。`;
}

function isAllowedCandidate(
  candidate: ClipManifestEntry,
  result: ClipManifestEntry[],
  usedSources: Set<string>,
  level: Level
) {
  const last = result[result.length - 1];
  const secondLast = result[result.length - 2];

  if (last && last.source === candidate.source) {
    return false;
  }

  if (last && secondLast && last.topic === candidate.topic && secondLast.topic === candidate.topic) {
    return false;
  }

  if ((level === 'A1-A2' || level === 'B1') && result.length < 3) {
    const ceiling = getTargetCenter(level) + 15;
    if (candidate.difficulty_score > ceiling) {
      return false;
    }
  }

  if (result.length === 2 && usedSources.size < 2 && usedSources.has(candidate.source)) {
    return false;
  }

  return true;
}

function selectNextCandidate(
  pools: Record<FeedBucket, ClipManifestEntry[]>,
  desiredBucket: FeedBucket,
  result: ClipManifestEntry[],
  usedIds: Set<number>,
  usedSources: Set<string>,
  level: Level
) {
  const fallbackOrder: FeedBucket[] = ['primary', 'adjacent', 'probe', 'other'];
  const queue = [desiredBucket, ...fallbackOrder.filter(bucket => bucket !== desiredBucket)];

  for (const bucket of queue) {
    for (const candidate of pools[bucket]) {
      if (usedIds.has(candidate.id)) continue;
      if (!isAllowedCandidate(candidate, result, usedSources, level)) continue;
      return { candidate, bucket };
    }
  }

  for (const bucket of queue) {
    for (const candidate of pools[bucket]) {
      if (usedIds.has(candidate.id)) continue;
      return { candidate, bucket };
    }
  }

  return null;
}

function addIfMissing(items: number[], value: number | null | undefined) {
  if (typeof value !== 'number') return items;
  if (!items.includes(value)) {
    items.push(value);
  }
  return items;
}

export function deriveLikedTopics(events: LikeEvent[], maxTopics = 3) {
  const counts = new Map<Topic, number>();

  for (const event of events.slice(-20)) {
    const normalized = normalizeTopic(event.tag);
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTopics)
    .map(([topic]) => topic);
}

export function collectClipIdsByKeys(clips: Clip[], clipKeys: string[], getClipKey: (clip: Clip, index: number) => string) {
  const ids: number[] = [];
  const keySet = new Set(clipKeys);

  clips.forEach((clip, index) => {
    if (!keySet.has(getClipKey(clip, index))) return;
    addIfMissing(ids, clip.id);
  });

  return ids;
}

export function buildLocalStarterFeedFallback(manifest: ClipManifestEntry[], request: RankRequest): RankedFeedItem[] {
  const maxItems = Math.max(1, request.maxItems || 10);
  const level = request.level || 'B1';
  const targetCenter = getTargetCenter(level);
  const interests = request.interests
    .map(item => normalizeTopic(item))
    .slice(0, 3);
  const interestSet = new Set<Topic>(interests);
  const adjacentTopics = getAdjacentTopics(interests);
  const listenedIds = new Set(request.listenedClipIds || []);
  const skippedIds = new Set(request.skippedClipIds || []);
  const likedTopics = new Set((request.likedTopics || []).map(item => normalizeTopic(item)));

  const available = manifest.filter(clip => !listenedIds.has(clip.id));
  const primary = sortCandidates(
    available.filter(clip => interestSet.has(clip.topic)),
    targetCenter,
    likedTopics,
    skippedIds
  );
  const adjacent = sortCandidates(
    available.filter(clip => !interestSet.has(clip.topic) && adjacentTopics.has(clip.topic)),
    targetCenter,
    likedTopics,
    skippedIds
  );
  const probe = sortCandidates(available, targetCenter, likedTopics, skippedIds);
  const other = sortCandidates(
    available.filter(clip => !interestSet.has(clip.topic) && !adjacentTopics.has(clip.topic)),
    targetCenter,
    likedTopics,
    skippedIds
  );

  const pools: Record<FeedBucket, ClipManifestEntry[]> = {
    primary,
    adjacent,
    probe,
    other,
  };

  const result: ClipManifestEntry[] = [];
  const reasons = new Map<number, string>();
  const usedIds = new Set<number>();
  const usedSources = new Set<string>();

  for (const bucket of getPattern(maxItems)) {
    const next = selectNextCandidate(pools, bucket, result, usedIds, usedSources, level);
    if (!next) break;

    result.push(next.candidate);
    usedIds.add(next.candidate.id);
    usedSources.add(next.candidate.source);
    reasons.set(
      next.candidate.id,
      buildReason(next.candidate, level, next.bucket, interestSet, adjacentTopics)
    );
  }

  return result.map(item => ({
    id: item.id,
    reason: reasons.get(item.id) || `这条内容的难度更贴近你当前的 ${level}。`,
  }));
}

export function applyRankedFeedOrder(clips: Clip[], feed: RankedFeedItem[]) {
  const byId = new Map<number, Clip>();
  clips.forEach(clip => {
    if (typeof clip.id === 'number') {
      byId.set(clip.id, clip);
    }
  });

  return feed
    .map(item => {
      const clip = byId.get(item.id);
      if (!clip) return null;
      return {
        ...clip,
        _aiReason: item.reason,
      };
    })
    .filter(Boolean) as Clip[];
}
