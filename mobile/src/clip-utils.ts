import type { AVPlaybackSource } from 'expo-av';
import { CONTENT_BASE_URL } from './services/api';
import type { Bookmark, Clip, ClipDifficulty, Level } from './types';

type ClipSourceObject = Exclude<Clip['source'], string>;

type ClipWindow = {
  startSec: number;
  endSec: number;
  durationSec: number;
};

function normalizeAudioRef(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) {
    return normalizeKeyUrl(trimmed);
  }
  return normalizeContentPath(trimmed).toLowerCase();
}

function getSourceObject(clip: Clip): ClipSourceObject | null {
  return typeof clip.source === 'object' && clip.source ? clip.source : null;
}

function normalizeContentPath(raw: string) {
  return raw.replace(/^\//, '');
}

function normalizeKeyUrl(value: string) {
  if (!value) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return value.split('?')[0].replace(/\/+$/, '').toLowerCase();
  }
}

function roundKeyNumber(value: number) {
  return String(Math.round(value * 100) / 100);
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach(value => {
    if (!value) return;
    if (seen.has(value)) return;
    seen.add(value);
    result.push(value);
  });
  return result;
}

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

export function getClipSourceExternalUrl(clip: Clip) {
  const source = getSourceObject(clip);
  const episodeUrl = typeof source?.episode_url === 'string' ? source.episode_url.trim() : '';
  if (/^https?:\/\//i.test(episodeUrl)) {
    return episodeUrl.replace(/^http:\/\//i, 'https://');
  }

  const feedUrl = typeof source?.feed_url === 'string' ? source.feed_url.trim() : '';
  if (/^https?:\/\//i.test(feedUrl) && !/\.rss($|\?)/i.test(feedUrl)) {
    return feedUrl.replace(/^http:\/\//i, 'https://');
  }
  return '';
}

export function getClipWindow(clip: Clip): ClipWindow {
  const directAudio = normalizeAudioRef(clip.cdnAudio || clip.audio || '');
  const sourceAudio = normalizeAudioRef(getSourceObject(clip)?.audio_url || '');
  const usesDirectClipAudio = Boolean(directAudio) && (!sourceAudio || directAudio !== sourceAudio);

  const durationFromField = typeof clip.duration === 'number' && Number.isFinite(clip.duration)
    ? clip.duration
    : undefined;
  const durationFromLines = clip.lines?.length
    ? clip.lines[clip.lines.length - 1].end
    : 0;
  const durationSec = Number(((durationFromField ?? durationFromLines) || 0).toFixed(2));

  if (usesDirectClipAudio) {
    return {
      startSec: 0,
      endSec: durationSec,
      durationSec,
    };
  }

  const explicitStart = Number(clip.clip_start_sec);
  const explicitEnd = Number(clip.clip_end_sec);
  if (Number.isFinite(explicitStart) && Number.isFinite(explicitEnd) && explicitEnd > explicitStart) {
    return {
      startSec: explicitStart,
      endSec: explicitEnd,
      durationSec: Number((explicitEnd - explicitStart).toFixed(2)),
    };
  }
  return {
    startSec: 0,
    endSec: durationSec,
    durationSec,
  };
}

export function getClipAudioStartSeconds(clip: Clip) {
  return getClipWindow(clip).startSec;
}

export function getClipAudioEndSeconds(clip: Clip) {
  return getClipWindow(clip).endSec;
}

export function clipRelativeToSourceSeconds(clip: Clip, relativeSeconds: number) {
  return getClipAudioStartSeconds(clip) + Math.max(0, relativeSeconds);
}

export function sourceToClipRelativeSeconds(clip: Clip, sourceSeconds: number) {
  return Math.max(0, sourceSeconds - getClipAudioStartSeconds(clip));
}

export function getClipAudioUrl(clip: Clip) {
  const direct = clip.cdnAudio || clip.audio || '';
  if (direct) {
    if (/^https?:\/\//i.test(direct)) return direct;
    return `${CONTENT_BASE_URL}/${normalizeContentPath(direct)}`;
  }

  const source = getSourceObject(clip);
  const raw = source?.audio_url || '';
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${CONTENT_BASE_URL}/${normalizeContentPath(raw)}`;
}

export function resolveClipAudioUrl(clip: Clip) {
  return getClipAudioUrl(clip);
}

export function resolveClipAudioSource(clip: Clip): AVPlaybackSource | null {
  const url = getClipAudioUrl(clip);
  if (!url) return null;
  return { uri: url };
}

export function resolveDataUrls() {
  return [
    `${CONTENT_BASE_URL}/new_clips.json`,
    `${CONTENT_BASE_URL}/data.json`,
  ];
}

export function resolveDataUrl() {
  return resolveDataUrls()[0];
}

function buildEpisodeWindowKey(clip: Clip) {
  const source = getSourceObject(clip);
  if (!source?.episode_url || !source.timestamp_start || !source.timestamp_end) return '';
  return [
    'episode',
    normalizeKeyUrl(source.episode_url),
    source.timestamp_start.trim(),
    source.timestamp_end.trim(),
    clip.title.trim().toLowerCase(),
  ].join('|');
}

function buildAudioWindowKey(clip: Clip) {
  const source = getSourceObject(clip);
  const audioUrl = source?.audio_url;
  if (!audioUrl) return '';
  const window = getClipWindow(clip);
  return [
    'audio',
    normalizeKeyUrl(audioUrl),
    roundKeyNumber(window.startSec),
    roundKeyNumber(window.endSec),
  ].join('|');
}

function buildFallbackKey(clip: Clip, index?: number) {
  return `${index ?? 0}:${clip.title}:${getSourceLabel(clip.source)}`;
}

export function getClipKeyAliases(clip: Clip, index?: number) {
  return uniqueStrings([
    buildAudioWindowKey(clip),
    buildEpisodeWindowKey(clip),
    clip.cdnAudio || '',
    clip.audio || '',
    buildFallbackKey(clip, index),
  ]);
}

export function buildClipKey(clip: Clip, index?: number) {
  const aliases = getClipKeyAliases(clip, index);
  return aliases[0] || buildFallbackKey(clip, index);
}

export function clipMatchesKey(clip: Clip, clipKey: string, index?: number) {
  return getClipKeyAliases(clip, index).includes(clipKey);
}

export function canonicalizeClipKey(clips: Clip[], clipKey: string) {
  if (!clipKey) return clipKey;
  const matchIndex = clips.findIndex((clip, index) => clipMatchesKey(clip, clipKey, index));
  if (matchIndex < 0) return clipKey;
  return buildClipKey(clips[matchIndex], matchIndex);
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
  return getClipWindow(clip).durationSec;
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
  return clips.findIndex((clip, index) => clipMatchesKey(clip, clipKey, index));
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
