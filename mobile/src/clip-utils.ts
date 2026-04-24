import type { AVPlaybackSource } from 'expo-av';
import { getBundledClipAudioAsset } from './audio-assets';
import { CONTENT_BASE_URL } from './services/api';
import type { Bookmark, Clip, ClipDifficulty, Level } from './types';

export function getSourceLabel(source: Clip['source']) {
  if (typeof source === 'string') return source;
  return source?.podcast || source?.episode || 'Unknown Source';
}

export function getSourceMeta(source: Clip['source']) {
  if (typeof source === 'string') {
    return {
      podcast: source,
      episode: '',
      timestamp: '',
      tier: '',
    };
  }

  return {
    podcast: source?.podcast || '',
    episode: source?.episode || '',
    timestamp: [source?.timestamp_start, source?.timestamp_end].filter(Boolean).join(' - '),
    tier: source?.tier || '',
  };
}

export function resolveClipAudioUrl(clip: Clip) {
  const raw = clip.cdnAudio || clip.audio || '';
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${CONTENT_BASE_URL}/${normalizeContentPath(raw)}`;
}

export function resolveClipAudioSource(clip: Clip): AVPlaybackSource | null {
  const raw = clip.audio || '';
  if (raw) {
    const bundled = getBundledClipAudioAsset(raw);
    if (bundled) return bundled;
  }

  const url = resolveClipAudioUrl(clip);
  if (!url) return null;
  return { uri: url };
}

export function resolveDataUrl() {
  return `${CONTENT_BASE_URL}/data.json`;
}

function normalizeContentPath(raw: string) {
  return raw
    .replace(/^\//, '')
    .replace(/^\.?\//, '');
}

export function findLineAtTime(clip: Clip, time: number) {
  if (!clip.lines?.length) return -1;
  const lineIndex = clip.lines.findIndex(line => time >= line.start && time < line.end);
  if (lineIndex >= 0) return lineIndex;

  const lastLine = clip.lines[clip.lines.length - 1];
  if (time >= lastLine.start) {
    return clip.lines.length - 1;
  }

  return -1;
}

export function formatTime(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function getClipDurationSeconds(clip: Clip) {
  if (typeof clip.duration === 'number' && Number.isFinite(clip.duration)) {
    return clip.duration;
  }
  if (!clip.lines?.length) return 0;
  return clip.lines[clip.lines.length - 1].end;
}

export function buildClipKey(clip: Clip, index?: number) {
  if (clip.cdnAudio || clip.audio) {
    return clip.cdnAudio || clip.audio || '';
  }

  return `${index ?? 0}:${clip.title}:${getSourceLabel(clip.source)}`;
}

export function findPrevSentenceStart(clip: Clip, time: number) {
  if (!clip.lines?.length) return 0;
  let currentLine = findLineAtTime(clip, time);
  if (currentLine < 0) currentLine = 0;

  if (time - clip.lines[currentLine].start > 1) {
    return clip.lines[currentLine].start;
  }

  if (currentLine > 0) {
    return clip.lines[currentLine - 1].start;
  }

  return 0;
}

export function findNextSentenceStart(clip: Clip, time: number) {
  if (!clip.lines?.length) return 0;
  const currentLine = findLineAtTime(clip, time);
  if (currentLine < 0) return time;
  if (currentLine + 1 < clip.lines.length) {
    return clip.lines[currentLine + 1].start;
  }
  return clip.lines[currentLine].end;
}

export function getSentenceInfo(clip: Clip, time: number) {
  const currentIndex = findLineAtTime(clip, time);
  return {
    current: Math.max(1, currentIndex + 1),
    total: clip.lines?.length || 0,
  };
}

export function getSentenceMarkers(clip: Clip) {
  const duration = getClipDurationSeconds(clip) || 1;
  return (clip.lines || []).map(line => Math.max(0, Math.min(1, line.start / duration)));
}

export function getSentenceRange(clip: Clip, lineIndex: number) {
  const line = clip.lines?.[lineIndex];
  const duration = getClipDurationSeconds(clip) || 1;
  if (!line) return null;
  return {
    start: Math.max(0, Math.min(1, line.start / duration)),
    end: Math.max(0, Math.min(1, line.end / duration)),
  };
}

export function findClipIndexByKey(clips: Clip[], clipKey: string) {
  return clips.findIndex((clip, index) => {
    return buildClipKey(clip, index) === clipKey;
  });
}

export function toBookmark(clip: Clip, index: number): Bookmark {
  return {
    clipKey: buildClipKey(clip, index),
    title: clip.title,
    source: getSourceLabel(clip.source),
    tag: clip.tag || 'featured',
  };
}

export function getDifficultyWeight(difficulty?: ClipDifficulty) {
  const normalized = (difficulty || 'medium').toLowerCase();
  if (normalized === 'easy' || normalized === 'a1-a2') return 0.3;
  if (normalized === 'medium' || normalized === 'b1') return 0.6;
  if (normalized === 'b1+') return 0.7;
  if (normalized === 'b2') return 0.85;
  if (normalized === 'hard' || normalized === 'c1-c2') return 1;
  return 0.6;
}

export function getLevelWeight(level?: Level | string | null) {
  if (level === null || typeof level === 'undefined') return 2;
  const normalized = String(level).toUpperCase().trim();
  if (!normalized) return 0;
  if (normalized === 'A1-A2' || normalized === 'A1' || normalized === 'A2') return 1;
  if (normalized === 'B1') return 2;
  if (normalized === 'B2') return 3;
  if (normalized === 'C1-C2' || normalized === 'C1' || normalized === 'C2') return 4;
  return 2;
}

export function sortClipsForFeed(clips: Clip[], listenedClipKeys: string[]) {
  const listenedSet = new Set(listenedClipKeys);
  return clips
    .map((clip, index) => ({ clip, index }))
    .sort((a, b) => {
      const aListened = listenedSet.has(buildClipKey(a.clip, a.index));
      const bListened = listenedSet.has(buildClipKey(b.clip, b.index));
      if (aListened !== bListened) return aListened ? 1 : -1;

      const aOverlap = typeof a.clip.overlap_score === 'number' ? a.clip.overlap_score : 0.5;
      const bOverlap = typeof b.clip.overlap_score === 'number' ? b.clip.overlap_score : 0.5;
      const aScore = aOverlap * 0.6 + getDifficultyWeight(a.clip.difficulty) * 0.4;
      const bScore = bOverlap * 0.6 + getDifficultyWeight(b.clip.difficulty) * 0.4;

      if (bScore !== aScore) return bScore - aScore;
      return a.index - b.index;
    })
    .map(item => item.clip);
}

export function getWordTimestamp(entry: { timestamp?: number; createdAt?: string; updatedAt?: string }) {
  if (typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp)) return entry.timestamp;
  const fromDate = entry.createdAt || entry.updatedAt;
  const parsed = fromDate ? Date.parse(fromDate) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}
