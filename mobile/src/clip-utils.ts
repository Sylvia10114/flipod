import { API_BASE_URL } from './services/api';
import type { Bookmark, Clip } from './types';

export function getSourceLabel(source: Clip['source']) {
  if (typeof source === 'string') return source;
  return source?.podcast || source?.episode || 'Unknown Source';
}

export function resolveClipAudioUrl(clip: Clip) {
  const raw = clip.cdnAudio || clip.audio || '';
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${API_BASE_URL}/${raw.replace(/^\//, '')}`;
}

export function findLineAtTime(clip: Clip, time: number) {
  if (!clip.lines?.length) return -1;
  return clip.lines.findIndex(line => time >= line.start && time <= line.end);
}

export function formatTime(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function buildClipKey(clip: Clip, index: number) {
  return `${index}:${clip.title}:${getSourceLabel(clip.source)}`;
}

export function toBookmark(clip: Clip, index: number): Bookmark {
  return {
    clipKey: buildClipKey(clip, index),
    title: clip.title,
    source: getSourceLabel(clip.source),
    tag: clip.tag || 'featured',
  };
}
