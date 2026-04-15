import demoData from './demo-data.json';
import { normalizeClips } from './feed-ranking';
import type { Clip } from './types';

export const demoClips: Clip[] = Array.isArray(demoData?.clips)
  ? normalizeClips(demoData.clips as Clip[])
  : [];
