import { CONTENT_BASE_URL } from './services/api';
import type { Bookmark, Clip } from './types';

export function getSourceLabel(source: Clip['source']) {
  if (typeof source === 'string') return source;
  return source?.podcast || source?.episode || 'Unknown Source';
}

export function resolveClipAudioUrl(clip: Clip) {
  const raw = clip.cdnAudio || clip.audio || '';
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${CONTENT_BASE_URL}/${normalizeContentPath(raw)}`;
}

export function resolveDataUrl() {
  return `${CONTENT_BASE_URL}/data.json`;
}

function normalizeContentPath(raw: string) {
  return raw
    .replace(/^\//, '')
    .replace(/^clips\//, '');
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
