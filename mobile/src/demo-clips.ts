import bundledData from '../../data.json';
import demoData from './demo-data.json';
import { normalizeClips } from './feed-ranking';
import type { Clip } from './types';

export const bundledClips: Clip[] = Array.isArray(bundledData?.clips)
  ? normalizeClips(bundledData.clips as Clip[])
  : [];

export const demoClips: Clip[] = Array.isArray(demoData?.clips)
  ? normalizeClips(demoData.clips as Clip[])
  : [];

export const bundledFallbackClips: Clip[] = bundledClips.length > 0 ? bundledClips : demoClips;
export const bundledFallbackSource = bundledClips.length > 0 ? 'bundled-full' : 'bundled-demo';
