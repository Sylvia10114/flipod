export type Level = 'A1-A2' | 'B1' | 'B2' | 'C1-C2';

export type ClipLineWord = {
  word: string;
  start: number;
  end: number;
  cefr?: string;
};

export type ClipLine = {
  en: string;
  zh: string;
  start: number;
  end: number;
  words?: ClipLineWord[];
};

export type Clip = {
  title: string;
  source: { podcast?: string; episode?: string } | string;
  tag?: string;
  audio?: string;
  cdnAudio?: string;
  lines: ClipLine[];
  _aiReason?: string;
};

export type Profile = {
  level: Level | null;
  interests: string[];
  theme: 'dark' | 'light';
  onboardingDone: boolean;
};

export type DominantHand = 'left' | 'right';

export type AppSettings = {
  dominantHand: DominantHand;
  playbackRate: number;
  practiceIntroSeen: boolean;
  bookmarkPracticeHintSeen: boolean;
};

export type SessionResponse = {
  user: {
    id: string;
    deviceId: string;
  };
  profile: Profile & {
    updatedAt: string | null;
  };
};

export type RankedFeedItem = {
  id: number;
  reason: string;
};

export type RankResponse = {
  feed: RankedFeedItem[];
  clip_count: number;
};

export type Bookmark = {
  id?: string;
  clipKey: string;
  title: string;
  source: string;
  tag: string;
  createdAt?: string;
};

export type VocabEntry = {
  id?: string;
  word: string;
  cefr?: string;
  phonetic?: string;
  context?: string;
  contextZh?: string;
  clipKey?: string;
  clipTitle?: string;
  sourceType?: 'feed' | 'practice';
  practiced?: boolean;
  known?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type PracticeRecord = {
  done: boolean;
  words: number;
  hard: number;
  ts: number;
};

export type PracticeMap = Record<string, PracticeRecord>;
