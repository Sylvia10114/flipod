export type Level = 'A1-A2' | 'B1' | 'B2' | 'C1-C2';
export type NativeLanguage =
  | 'english'
  | 'simplified_chinese'
  | 'traditional_chinese'
  | 'japanese'
  | 'korean'
  | 'spanish'
  | 'french'
  | 'brazilian_portuguese'
  | 'italian'
  | 'german';

export const DEFAULT_NATIVE_LANGUAGE: NativeLanguage = 'english';
export type Topic =
  | 'science'
  | 'business'
  | 'psychology'
  | 'story'
  | 'history'
  | 'culture'
  | 'tech'
  | 'society';
export type ClipDifficulty = 'easy' | 'medium' | 'hard' | 'A1-A2' | 'B1' | 'B1+' | 'B2' | 'C1-C2' | string;

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

export type ClipQuestion = {
  question: string;
  options: string[];
  answer: string;
  explanation_zh?: string;
  stage?: number;
};

export type ClipPrimingWord = {
  word: string;
  zh?: string;
  cefr?: string;
  ipa?: string;
};

export type ClipPriming = {
  words: ClipPrimingWord[];
  version?: string;
  generatedAt?: number;
};

export type LocalizedClipLine = {
  translation: string;
};

export type LocalizedClipQuestion = {
  question?: string;
  options?: string[];
  explanation: string;
};

export type LocalizedClipContent = {
  locale: NativeLanguage;
  contentKey: string;
  contentHash: string;
  title?: string;
  lines: LocalizedClipLine[];
  questions: LocalizedClipQuestion[];
  generatedAt?: string | null;
  unavailable?: boolean;
};

export type Clip = {
  id?: number;
  topic?: Topic | string;
  title: string;
  contentKey?: string;
  contentHash?: string;
  source: {
    podcast?: string;
    episode?: string;
    audio_url?: string;
    episode_url?: string;
    feed_url?: string;
    timestamp_start?: string;
    timestamp_end?: string;
    pub_date?: string;
    tier?: string;
  } | string;
  tag?: string;
  audio?: string;
  cdnAudio?: string;
  duration?: number;
  clip_start_sec?: number;
  clip_end_sec?: number;
  difficulty_score?: number;
  difficulty?: ClipDifficulty;
  overlap_score?: number;
  info_takeaway?: string;
  questions?: ClipQuestion[];
  collocations?: string[];
  lines: ClipLine[];
  priming?: ClipPriming | null;
  _aiReason?: string;
};

export type Profile = {
  level: Level | null;
  interests: string[];
  nativeLanguage: NativeLanguage;
  theme: 'dark' | 'light';
  onboardingDone: boolean;
};

export type AuthProvider = 'phone' | 'apple';

export type AuthUser = {
  id: string;
};

export type LinkedIdentity = {
  provider: AuthProvider;
  providerUserId: string;
  displayValue: string;
  lastUsedAt?: string | null;
};

export type AuthSession = {
  token: string;
  expiresAt: string;
};

export type DominantHand = 'left' | 'right';
export type SubtitleSize = 'sm' | 'md' | 'lg';
export type PlaybackPhase = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
export type HomeMode = 'practice' | 'just_listen';

export type ChallengeWord = {
  word: string;
  cefr?: string;
  lineIndex: number;
  translation?: string;
  translationLocale?: NativeLanguage;
};

export type AppSettings = {
  dominantHand: DominantHand;
  playbackRate: number;
  subtitleSize: SubtitleSize;
  homeMode: HomeMode;
  practiceIntroSeen: boolean;
  bookmarkPracticeHintSeen: boolean;
  firstUseBridgeSeen: boolean;
  feedCoachListenSeen: boolean;
  feedCoachWordSeen: boolean;
  feedCoachNavSeen: boolean;
};

export type PracticeTabReason =
  | 'unknown'
  | 'linking'
  | 'weak'
  | 'speed'
  | 'accent'
  | 'other';

export type PracticeTabVocabPick = {
  word: string;
  sentenceIndex: number;
};

export type PracticeTabQuizResult = {
  qIdx: number;
  picked: number;
  correct: boolean;
};

export type PracticeTabCompletedClip = {
  clipKey: string;
  title: string;
  tag?: string;
  completedAt: number;
  tabEnteredFrom: 'practice';
  reasons: PracticeTabReason[];
  vocabPicked: PracticeTabVocabPick[];
  quizResults: {
    stage0?: PracticeTabQuizResult[];
    stage1?: PracticeTabQuizResult[];
    stage2?: PracticeTabQuizResult[];
    stage3?: PracticeTabQuizResult[];
  };
  durationSec: number;
};

export type PracticeTabVocabInboxEntry = {
  word: string;
  clipKey: string;
  sentenceIndex: number;
  addedAt: number;
};

export type PracticeTabState = {
  ui_state: {
    current_tab: HomeMode;
    last_active_at: string;
  };
  practice_feed_keys: string[];
  practice_feed_signature: string | null;
  session: {
    active_clip_key: string;
    current_stage: number;
    current_clip_index: number;
    started_at: string;
  } | null;
  completed_clips: PracticeTabCompletedClip[];
  vocab_inbox: {
    entries: PracticeTabVocabInboxEntry[];
    week_window_start: string;
  };
  attribution_aggregate: Record<PracticeTabReason, number>;
  listen_cursor: number;
  practice_cursor: number;
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

export type AuthInitResponse = {
  user: AuthUser;
  session: AuthSession;
  linkedIdentities: LinkedIdentity[];
};

export type AuthBootstrapResponse = {
  user: AuthUser;
  session: { expiresAt: string } | null;
  linkedIdentities: LinkedIdentity[];
  profile: Profile & {
    updatedAt?: string | null;
  };
  bookmarks: Bookmark[];
  vocab: VocabEntry[];
  practiceData: PracticeMap;
  knownWords: string[];
  likedClipKeys: string[];
  likeEvents: LikeEvent[];
};

export type RankedFeedItem = {
  id: number;
  reason: string;
};

export type RankMode = 'starter' | 'rerank';

export type RankRequest = {
  mode: RankMode;
  level: Level;
  interests: string[];
  listenedClipIds: number[];
  skippedClipIds: number[];
  likedTopics: string[];
  wordsLookedUp: number;
  maxItems?: number;
};

export type RankResponse = {
  feed: RankedFeedItem[];
  clip_count?: number;
  algorithm?: string;
  generatedAt?: string;
};

export type ClipManifestEntry = {
  id: number;
  topic: Topic;
  source: string;
  duration: number;
  difficulty_score: number;
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
  definitionZh?: string;
  context?: string;
  contextZh?: string;
  contentKey?: string;
  lineIndex?: number;
  clipKey?: string;
  clipTitle?: string;
  tag?: string;
  sourceType?: 'feed' | 'practice';
  practiced?: boolean;
  known?: boolean;
  timestamp?: number;
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

export type LikeEvent = {
  tag: string;
  timestamp: number;
};

export type ReviewRecord = {
  nextReview: number;
  interval: number;
};

export type ReviewState = Record<string, ReviewRecord>;

export type CalibrationSignals = {
  wordsLookedUp: number;
  wordsByLevel: Record<string, number>;
  clipsPlayed: number;
  avgWordsPerClip: number;
  practiceHardRate: number;
  practiceSessions: number;
};

export type GeneratedPracticeTargetWordContext = {
  word: string;
  sentence_index: number | null;
  definition_zh: string;
  cefr: string;
  ipa: string;
};

export type GeneratedPracticeVocab = {
  word: string;
  cefr: string;
  zh: string;
  ipa: string;
  sentence_index: number | null;
};

export type GeneratedPracticeLine = {
  en: string;
  zh: string;
  start: number;
  end: number;
  target_words?: string[];
};

export type GeneratedPracticeMcq = {
  q: string;
  options: string[];
  correct: number;
  explanation: string;
};

export type GeneratedPractice = {
  id: string;
  title: string;
  tag: string;
  category: string;
  cefr: string;
  topicKey?: string;
  target_words: string[];
  text: string;
  gist_zh?: string;
  lines: GeneratedPracticeLine[];
  vocabulary: Array<{
    word: string;
    definition_zh: string;
    cefr: string;
    ipa: string;
  }>;
  target_word_contexts: GeneratedPracticeTargetWordContext[];
  vocab_in_text: GeneratedPracticeVocab[];
  mcq: GeneratedPracticeMcq | null;
  generatedAt: number;
  generatedBy: string;
  generationVersion: string;
  contentKey?: string;
  contentHash?: string;
  reason?: string;
  completedAt?: number;
};

export type GeneratedPracticeError = {
  msg: string;
  ts: number;
};

export type GeneratedPracticeState = {
  lastGeneratedAt: number;
  lastVocabCountAtGeneration: number;
  pendingPractices: GeneratedPractice[];
  completedPractices: GeneratedPractice[];
  generationVersion: string | number;
  generating: boolean;
  lastGenerationError: GeneratedPracticeError | null;
};

export type CalibrationState = {
  suggestedUp?: boolean;
  suggestedDown?: boolean;
};

export type CalibrationDirection = 'up' | 'down';

export type CalibrationSuggestion = {
  direction: CalibrationDirection;
  fromLevel: Level;
  toLevel: Level;
  message: string;
};
