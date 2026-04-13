import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type {
  AppSettings,
  AuthBootstrapResponse,
  Bookmark,
  CalibrationSignals,
  CalibrationState,
  LikeEvent,
  PracticeMap,
  Profile,
  ReviewState,
  VocabEntry,
} from './types';

const DEVICE_ID_KEY = 'flipodDeviceId';
const AUTH_TOKEN_KEY = 'flipodAuthToken';
const PROFILE_KEY = 'flipodProfile';
const SETTINGS_KEY = 'flipodSettings';
const PRACTICE_KEY = 'flipodPractice';
const KNOWN_WORDS_KEY = 'flipodKnownWords';
const BOOKMARKS_KEY = 'flipodBookmarks';
const VOCAB_KEY = 'flipodVocab';
const LIKED_CLIPS_KEY = 'flipodLikedClips';
const LIKE_EVENTS_KEY = 'flipodLikes';
const LISTENED_CLIPS_KEY = 'flipodListenedClips';
const REVIEW_STATE_KEY = 'flipodReview';
const LEVEL_SIGNALS_KEY = 'flipodLevelSignals';
const LEVEL_CALIBRATION_KEY = 'flipodLevelCalibration';

export const DEFAULT_SETTINGS: AppSettings = {
  dominantHand: 'right',
  playbackRate: 1,
  practiceIntroSeen: false,
  bookmarkPracticeHintSeen: false,
};

export const DEFAULT_CALIBRATION_SIGNALS: CalibrationSignals = {
  wordsLookedUp: 0,
  wordsByLevel: {},
  clipsPlayed: 0,
  avgWordsPerClip: 0,
  practiceHardRate: 0,
  practiceSessions: 0,
};

function createId() {
  return `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function getOrCreateDeviceId() {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const next = createId();
  await AsyncStorage.setItem(DEVICE_ID_KEY, next);
  return next;
}

export async function loadAuthToken() {
  return SecureStore.getItemAsync(AUTH_TOKEN_KEY);
}

export async function saveAuthToken(token: string) {
  await SecureStore.setItemAsync(AUTH_TOKEN_KEY, token);
}

export async function clearAuthToken() {
  await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
}

export async function loadProfile(): Promise<Profile | null> {
  const raw = await AsyncStorage.getItem(PROFILE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as Profile;
  } catch {
    return null;
  }
}

export async function saveProfile(profile: Profile) {
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export async function loadSettings(): Promise<AppSettings> {
  const raw = await AsyncStorage.getItem(SETTINGS_KEY);
  if (!raw) return DEFAULT_SETTINGS;

  try {
    return {
      ...DEFAULT_SETTINGS,
      ...(JSON.parse(raw) as Partial<AppSettings>),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: AppSettings) {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function loadPracticeData(): Promise<PracticeMap> {
  const raw = await AsyncStorage.getItem(PRACTICE_KEY);
  if (!raw) return {};

  try {
    return JSON.parse(raw) as PracticeMap;
  } catch {
    return {};
  }
}

export async function savePracticeData(practiceData: PracticeMap) {
  await AsyncStorage.setItem(PRACTICE_KEY, JSON.stringify(practiceData));
}

export async function loadKnownWords(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(KNOWN_WORDS_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

export async function saveKnownWords(words: string[]) {
  await AsyncStorage.setItem(KNOWN_WORDS_KEY, JSON.stringify(words));
}

export async function loadBookmarks(): Promise<Bookmark[]> {
  const raw = await AsyncStorage.getItem(BOOKMARKS_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Bookmark[]) : [];
  } catch {
    return [];
  }
}

export async function saveBookmarks(bookmarks: Bookmark[]) {
  await AsyncStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
}

export async function loadVocab(): Promise<VocabEntry[]> {
  const raw = await AsyncStorage.getItem(VOCAB_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as VocabEntry[]) : [];
  } catch {
    return [];
  }
}

export async function saveVocab(vocab: VocabEntry[]) {
  await AsyncStorage.setItem(VOCAB_KEY, JSON.stringify(vocab));
}

export async function loadLikedClips(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(LIKED_CLIPS_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

export async function saveLikedClips(likedClips: string[]) {
  await AsyncStorage.setItem(LIKED_CLIPS_KEY, JSON.stringify(likedClips));
}

export async function loadLikeEvents(): Promise<LikeEvent[]> {
  const raw = await AsyncStorage.getItem(LIKE_EVENTS_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LikeEvent[]) : [];
  } catch {
    return [];
  }
}

export async function saveLikeEvents(events: LikeEvent[]) {
  await AsyncStorage.setItem(LIKE_EVENTS_KEY, JSON.stringify(events));
}

export async function loadListenedClips(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(LISTENED_CLIPS_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

export async function saveListenedClips(clipKeys: string[]) {
  await AsyncStorage.setItem(LISTENED_CLIPS_KEY, JSON.stringify(clipKeys));
}

export async function loadReviewState(): Promise<ReviewState> {
  const raw = await AsyncStorage.getItem(REVIEW_STATE_KEY);
  if (!raw) return {};

  try {
    return JSON.parse(raw) as ReviewState;
  } catch {
    return {};
  }
}

export async function saveReviewState(reviewState: ReviewState) {
  await AsyncStorage.setItem(REVIEW_STATE_KEY, JSON.stringify(reviewState));
}

export async function loadCalibrationSignals(): Promise<CalibrationSignals> {
  const raw = await AsyncStorage.getItem(LEVEL_SIGNALS_KEY);
  if (!raw) return DEFAULT_CALIBRATION_SIGNALS;

  try {
    const parsed = JSON.parse(raw) as Partial<CalibrationSignals>;
    return {
      ...DEFAULT_CALIBRATION_SIGNALS,
      ...parsed,
      wordsByLevel: {
        ...DEFAULT_CALIBRATION_SIGNALS.wordsByLevel,
        ...(parsed.wordsByLevel || {}),
      },
    };
  } catch {
    return DEFAULT_CALIBRATION_SIGNALS;
  }
}

export async function saveCalibrationSignals(signals: CalibrationSignals) {
  await AsyncStorage.setItem(LEVEL_SIGNALS_KEY, JSON.stringify(signals));
}

export async function loadCalibrationState(): Promise<CalibrationState> {
  const raw = await AsyncStorage.getItem(LEVEL_CALIBRATION_KEY);
  if (!raw) return {};

  try {
    return JSON.parse(raw) as CalibrationState;
  } catch {
    return {};
  }
}

export async function saveCalibrationState(state: CalibrationState) {
  await AsyncStorage.setItem(LEVEL_CALIBRATION_KEY, JSON.stringify(state));
}

export async function clearAccountState() {
  await AsyncStorage.multiRemove([
    PROFILE_KEY,
    PRACTICE_KEY,
    KNOWN_WORDS_KEY,
    BOOKMARKS_KEY,
    VOCAB_KEY,
    LIKED_CLIPS_KEY,
    LIKE_EVENTS_KEY,
    LISTENED_CLIPS_KEY,
    REVIEW_STATE_KEY,
    LEVEL_SIGNALS_KEY,
    LEVEL_CALIBRATION_KEY,
  ]);
}

export async function saveAuthBootstrapSnapshot(snapshot: AuthBootstrapResponse) {
  await Promise.all([
    saveProfile(snapshot.profile),
    saveBookmarks(snapshot.bookmarks),
    saveVocab(snapshot.vocab),
    savePracticeData(snapshot.practiceData),
    saveKnownWords(snapshot.knownWords),
    saveLikedClips(snapshot.likedClipKeys),
    saveLikeEvents(snapshot.likeEvents),
  ]);
}
