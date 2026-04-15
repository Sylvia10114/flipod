const VALID_TOPICS = new Set([
  'science',
  'business',
  'psychology',
  'story',
  'history',
  'culture',
  'tech',
  'society',
]);

const TOPIC_ALIASES = {
  storytelling: 'story',
  technology: 'tech',
  social: 'society',
  'pop culture': 'culture',
};

const LEVEL_TARGET_CENTERS = {
  'A1-A2': 25,
  B1: 45,
  B2: 65,
  'C1-C2': 82,
};

const STARTER_PATTERN = [
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

const TOPIC_ADJACENCY = {
  science: ['tech'],
  business: ['psychology'],
  psychology: ['business'],
  story: ['history'],
  history: ['story', 'culture', 'society'],
  culture: ['story', 'history'],
  tech: ['science'],
  society: ['history'],
};

function normalizeTopic(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (VALID_TOPICS.has(normalized)) return normalized;
  if (TOPIC_ALIASES[normalized]) return TOPIC_ALIASES[normalized];
  return 'story';
}

function getPattern(maxItems) {
  if (maxItems <= STARTER_PATTERN.length) {
    return STARTER_PATTERN.slice(0, maxItems);
  }

  const pattern = [...STARTER_PATTERN];
  while (pattern.length < maxItems) {
    pattern.push('primary');
  }
  return pattern;
}

function getTargetCenter(level) {
  return LEVEL_TARGET_CENTERS[level] ?? LEVEL_TARGET_CENTERS.B1;
}

function getAdjacentTopics(interests) {
  const adjacent = new Set();
  for (const interest of interests) {
    for (const topic of TOPIC_ADJACENCY[interest] || []) {
      if (!interests.includes(topic)) {
        adjacent.add(topic);
      }
    }
  }
  return adjacent;
}

function sortCandidates(clips, targetCenter, likedTopics, skippedClipIds) {
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
    if (a.source !== b.source) return String(a.source).localeCompare(String(b.source));
    return a.id - b.id;
  });
}

function isAllowedCandidate(candidate, result, usedSources, level) {
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

function selectNextCandidate(pools, desiredBucket, result, usedIds, usedSources, level) {
  const fallbackOrder = ['primary', 'adjacent', 'probe', 'other'];
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

function buildReason(clip, level, bucket, interests, adjacentTopics) {
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

export function buildStarterFeed(manifestClips, payload = {}) {
  const maxItems = Math.max(1, Number(payload.maxItems) || 10);
  const level = payload.level || 'B1';
  const targetCenter = getTargetCenter(level);
  const interests = (Array.isArray(payload.interests) ? payload.interests : [])
    .map(normalizeTopic)
    .slice(0, 3);
  const interestSet = new Set(interests);
  const adjacentTopics = getAdjacentTopics(interests);
  const listenedClipIds = new Set(
    (Array.isArray(payload.listenedClipIds) ? payload.listenedClipIds : [])
      .map(value => Number(value))
      .filter(Number.isInteger)
  );
  const skippedClipIds = new Set(
    (Array.isArray(payload.skippedClipIds) ? payload.skippedClipIds : [])
      .map(value => Number(value))
      .filter(Number.isInteger)
  );
  const likedTopics = new Set(
    (Array.isArray(payload.likedTopics) ? payload.likedTopics : []).map(normalizeTopic)
  );

  const available = manifestClips
    .map(clip => ({
      id: Number(clip.id),
      topic: normalizeTopic(clip.topic),
      source: String(clip.source || 'Unknown Source'),
      duration: Number(clip.duration || 0),
      difficulty_score: Number(clip.difficulty_score || 55),
    }))
    .filter(clip => Number.isInteger(clip.id) && !listenedClipIds.has(clip.id));

  const pools = {
    primary: sortCandidates(
      available.filter(clip => interestSet.has(clip.topic)),
      targetCenter,
      likedTopics,
      skippedClipIds
    ),
    adjacent: sortCandidates(
      available.filter(clip => !interestSet.has(clip.topic) && adjacentTopics.has(clip.topic)),
      targetCenter,
      likedTopics,
      skippedClipIds
    ),
    probe: sortCandidates(available, targetCenter, likedTopics, skippedClipIds),
    other: sortCandidates(
      available.filter(clip => !interestSet.has(clip.topic) && !adjacentTopics.has(clip.topic)),
      targetCenter,
      likedTopics,
      skippedClipIds
    ),
  };

  const result = [];
  const usedIds = new Set();
  const usedSources = new Set();
  const reasons = new Map();

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

  return result.map(clip => ({
    id: clip.id,
    reason: reasons.get(clip.id) || `这条内容的难度更贴近你当前的 ${level}。`,
  }));
}
