import demoData from './demo-data.json';
import type { Clip } from './types';

export const demoClips: Clip[] = Array.isArray(demoData?.clips) ? (demoData.clips as Clip[]) : [];
