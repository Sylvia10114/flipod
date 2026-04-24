import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type {
  AppSettings,
  AuthBootstrapResponse,
  Bookmark,
  CalibrationSignals,
  CalibrationState,
  GeneratedPracticeState,
  LikeEvent,
  LocalizedClipContent,
  PracticeMap,
  PracticeTabState,
  Profile,
  ReviewState,
  VocabEntry,
} from './types';
import { DEFAULT_NATIVE_LANGUAGE } from './types';
import { getDevicePreferredNativeLanguage } from './content-localization';

const DEVICE_ID_KEY = 'flipodDeviceId';
const AUTH_TOKEN_KEY = 'flipodAuthToken';
const GUEST_MODE_KEY = 'flipodGuestMode';
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
const CONTENT_TRANSLATIONS_KEY = 'flipodContentTranslations';
const GENERATED_PRACTICE_KEY = 'flipodGeneratedPracticeState';
const PRACTICE_TAB_STATE_KEY = 'flipodPracticeTabState';

export const DEFAULT_SETTINGS: AppSettings = {
  dominantHand: 'right',
  playbackRate: 1,
  subtitleSize: 'md',
  homeMode: 'practice',
  practiceIntroSeen: false,
  bookmarkPracticeHintSeen: false,
  firstUseBridgeSeen: false,
  feedCoachListenSeen: false,
  feedCoachWordSeen: false,
  feedCoachNavSeen: false,
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

export function createDefaultPracticeTabState(): PracticeTabState {
  return {
    ui_state: {
      current_tab: 'practice',
      last_active_at: new Date().toISOString(),
    },
    practice_feed_keys: [],
    practice_feed_signature: null,
    session: null,
    completed_clips: [],
    vocab_inbox: {
      entries: [],
      week_window_start: new Date().toISOString(),
    },
    attribution_aggregate: {
      unknown: 0,
      unclear: 0,
      meaning: 0,
    },
    listen_cursor: 0,
    practice_cursor: 0,
  };
}

function normalizePracticeReason(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'unknown') return 'unknown';
  if (normalized === 'unclear') return 'unclear';
  if (normalized === 'meaning') return 'meaning';
  if (
    normalized === 'linking'
    || normalized === 'weak'
    || normalized === 'speed'
    || normalized === 'accent'
  ) {
    return 'unclear';
  }
  if (normalized === 'other') {
    return 'meaning';
  }
  return null;
}

export function normalizePracticeTabState(
  state: Partial<PracticeTabState> | null | undefined
): PracticeTabState {
  const base = createDefaultPracticeTabState();
  if (!state || typeof state !== 'object') return base;
  const currentTab = state.ui_state?.current_tab === 'just_listen' ? 'just_listen' : 'practice';
  const normalizedCompletedClips = Array.isArray(state.completed_clips)
    ? state.completed_clips.map(item => ({
        ...item,
        reasons: Array.isArray(item?.reasons)
          ? item.reasons
              .map(normalizePracticeReason)
              .filter((reason): reason is NonNullable<ReturnType<typeof normalizePracticeReason>> => Boolean(reason))
          : [],
      }))
    : [];
  const rawAggregate = (state.attribution_aggregate && typeof state.attribution_aggregate === 'object')
    ? state.attribution_aggregate
    : {};
  const normalizedAggregate = {
    ...base.attribution_aggregate,
  };
  Object.entries(rawAggregate).forEach(([rawReason, rawCount]) => {
    const reason = normalizePracticeReason(rawReason);
    if (!reason) return;
    normalizedAggregate[reason] = (normalizedAggregate[reason] || 0) + Math.max(0, Number(rawCount || 0));
  });
  return {
    ui_state: {
      current_tab: currentTab,
      last_active_at: state.ui_state?.last_active_at || base.ui_state.last_active_at,
    },
    practice_feed_keys: Array.isArray(state.practice_feed_keys)
      ? state.practice_feed_keys.map(value => String(value)).filter(Boolean)
      : [],
    practice_feed_signature: typeof state.practice_feed_signature === 'string'
      ? state.practice_feed_signature
      : null,
    session: state.session && typeof state.session === 'object'
      ? {
          active_clip_key: String(state.session.active_clip_key || ''),
          current_stage: 0,
          current_clip_index: Math.max(0, Number(state.session.current_clip_index || 0)),
          started_at: String(state.session.started_at || new Date().toISOString()),
        }
      : null,
    completed_clips: normalizedCompletedClips,
    vocab_inbox: {
      entries: Array.isArray(state.vocab_inbox?.entries) ? state.vocab_inbox.entries : [],
      week_window_start: state.vocab_inbox?.week_window_start || base.vocab_inbox.week_window_start,
    },
    attribution_aggregate: normalizedAggregate,
    listen_cursor: Math.max(0, Number(state.listen_cursor || 0)),
    practice_cursor: Math.max(0, Number(state.practice_cursor || 0)),
  };
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

export async function loadGuestMode() {
  const raw = await AsyncStorage.getItem(GUEST_MODE_KEY);
  return raw === '1';
}

export async function saveGuestMode(enabled: boolean) {
  if (enabled) {
    await AsyncStorage.setItem(GUEST_MODE_KEY, '1');
    return;
  }
  await AsyncStorage.removeItem(GUEST_MODE_KEY);
}

export async function clearGuestMode() {
  await AsyncStorage.removeItem(GUEST_MODE_KEY);
}

export async function loadProfile(): Promise<Profile | null> {
  const raw = await AsyncStorage.getItem(PROFILE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<Profile>;
    return {
      level: parsed.level ?? null,
      interests: Array.isArray(parsed.interests) ? parsed.interests : [],
      nativeLanguage: parsed.nativeLanguage ?? getDevicePreferredNativeLanguage(),
      theme: parsed.theme === 'light' ? 'light' : 'dark',
      onboardingDone: Boolean(parsed.onboardingDone),
    };
  } catch {
    return null;
  }
}

export async function saveProfile(profile: Profile) {
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify({
    ...profile,
    nativeLanguage: profile.nativeLanguage || DEFAULT_NATIVE_LANGUAGE,
  }));
}

export async function loadSettings(): Promise<AppSettings> {
  const raw = await AsyncStorage.getItem(SETTINGS_KEY);
  if (!raw) return DEFAULT_SETTINGS;

  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings> & { homeMode?: string };
    const normalizedHomeMode = parsed.homeMode === 'just_listen'
      ? 'just_listen'
      : parsed.homeMode === 'practice'
        ? 'practice'
        : 'practice';
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      homeMode: normalizedHomeMode,
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

export async function loadGeneratedPracticeState(): Promise<GeneratedPracticeState | null> {
  const raw = await AsyncStorage.getItem(GENERATED_PRACTICE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as GeneratedPracticeState) : null;
  } catch {
    return null;
  }
}

export async function saveGeneratedPracticeState(state: GeneratedPracticeState) {
  await AsyncStorage.setItem(GENERATED_PRACTICE_KEY, JSON.stringify(state));
}

export async function loadPracticeTabState(): Promise<PracticeTabState | null> {
  const raw = await AsyncStorage.getItem(PRACTICE_TAB_STATE_KEY);
  if (!raw) return null;

  try {
    return normalizePracticeTabState(JSON.parse(raw) as Partial<PracticeTabState>);
  } catch {
    return null;
  }
}

export async function savePracticeTabState(state: PracticeTabState) {
  await AsyncStorage.setItem(PRACTICE_TAB_STATE_KEY, JSON.stringify(state));
}

export async function loadContentTranslations(): Promise<Record<string, LocalizedClipContent>> {
  const raw = await AsyncStorage.getItem(CONTENT_TRANSLATIONS_KEY);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, LocalizedClipContent>) : {};
  } catch {
    return {};
  }
}

export async function saveContentTranslations(payload: Record<string, LocalizedClipContent>) {
  await AsyncStorage.setItem(CONTENT_TRANSLATIONS_KEY, JSON.stringify(payload));
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
    PRACTICE_TAB_STATE_KEY,
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
