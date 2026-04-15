const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT_DIR, 'data.json');
const MANIFEST_FILE = path.join(ROOT_DIR, 'clip-manifest.json');
const FUNCTIONS_MANIFEST_FILE = path.join(ROOT_DIR, 'functions', '_lib', 'clip-manifest.js');

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

const LEGACY_DIFFICULTY_SCORES = {
  easy: 30,
  medium: 55,
  hard: 80,
  'a1-a2': 25,
  b1: 45,
  'b1+': 52,
  b2: 65,
  'c1-c2': 82,
};

const WORD_LEVEL_SCORES = {
  A1: 10,
  A2: 22,
  B1: 40,
  B2: 62,
  C1: 80,
  C2: 92,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function allocateClipId(preferredId, index, clipCount, usedIds) {
  if (Number.isInteger(preferredId) && !usedIds.has(preferredId)) {
    usedIds.add(preferredId);
    return preferredId;
  }

  let fallbackId = clipCount + index;
  while (usedIds.has(fallbackId)) {
    fallbackId += 1;
  }
  usedIds.add(fallbackId);
  return fallbackId;
}

function normalizeTopic(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();

  if (!normalized) return 'story';
  if (VALID_TOPICS.has(normalized)) return normalized;
  if (TOPIC_ALIASES[normalized]) return TOPIC_ALIASES[normalized];
  return 'story';
}

function getDurationSeconds(clip) {
  if (typeof clip?.duration === 'number' && Number.isFinite(clip.duration)) {
    return Number(clip.duration.toFixed(1));
  }

  const lines = Array.isArray(clip?.lines) ? clip.lines : [];
  const lastLine = lines[lines.length - 1];
  const end = typeof lastLine?.end === 'number' && Number.isFinite(lastLine.end) ? lastLine.end : 0;
  return Number(end.toFixed(1));
}

function getSourceLabel(source) {
  if (typeof source === 'string') return source || 'Unknown Source';
  if (source && typeof source === 'object') {
    return source.podcast || source.episode || 'Unknown Source';
  }
  return 'Unknown Source';
}

function difficultyFromLegacy(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return LEGACY_DIFFICULTY_SCORES[normalized] ?? null;
}

function deriveDifficultyScore(clip, durationSeconds) {
  const lines = Array.isArray(clip?.lines) ? clip.lines : [];
  const levelScores = [];
  let totalWords = 0;

  for (const line of lines) {
    const words = Array.isArray(line?.words) ? line.words : [];
    totalWords += words.length;
    for (const word of words) {
      const cefr = String(word?.cefr || '')
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
  const avgSentenceWords = totalWords / Math.max(lines.length, 1);
  const wordsPerMinute = durationSeconds > 0 ? (totalWords / durationSeconds) * 60 : 150;

  const sentenceBonus = clamp((avgSentenceWords - 12) * 0.9, -6, 8);
  const paceBonus = clamp((wordsPerMinute - 150) * 0.1, -8, 10);

  return clamp(Math.round(avgLevel + sentenceBonus + paceBonus), 0, 100);
}

function getDifficultyScore(clip, durationSeconds) {
  if (typeof clip?.difficulty_score === 'number' && Number.isFinite(clip.difficulty_score)) {
    return clamp(Math.round(clip.difficulty_score), 0, 100);
  }

  const legacyScore = difficultyFromLegacy(clip?.difficulty);
  if (legacyScore !== null) {
    return legacyScore;
  }

  return deriveDifficultyScore(clip, durationSeconds);
}

function buildManifestClip(clip, index) {
  const duration = getDurationSeconds(clip);
  return {
    id: Number.isInteger(clip?.id) ? clip.id : undefined,
    topic: normalizeTopic(clip?.topic ?? clip?.tag),
    source: getSourceLabel(clip?.source),
    duration,
    difficulty_score: getDifficultyScore(clip, duration),
  };
}

function main() {
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  const data = JSON.parse(raw);
  const clips = Array.isArray(data?.clips) ? data.clips : [];
  const generatedAt = new Date().toISOString();
  const usedIds = new Set();
  const clipCount = clips.length;
  const manifest = {
    version: 1,
    generatedAt,
    clips: clips.map((clip, index) => {
      const entry = buildManifestClip(clip, index);
      return {
        ...entry,
        id: allocateClipId(entry.id, index, clipCount, usedIds),
      };
    }),
  };

  fs.writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const moduleContents = `export const CLIP_MANIFEST = ${JSON.stringify(manifest, null, 2)};\n\nexport const CLIP_MANIFEST_CLIPS = CLIP_MANIFEST.clips;\n`;
  fs.writeFileSync(FUNCTIONS_MANIFEST_FILE, moduleContents, 'utf8');

  console.log(`Wrote ${manifest.clips.length} manifest clips to ${path.relative(ROOT_DIR, MANIFEST_FILE)}`);
}

main();
