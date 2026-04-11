import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppSettings, Bookmark, PracticeMap, Profile, VocabEntry } from './types';

const DEVICE_ID_KEY = 'flipodDeviceId';
const PROFILE_KEY = 'flipodProfile';
const SETTINGS_KEY = 'flipodSettings';
const PRACTICE_KEY = 'flipodPractice';
const KNOWN_WORDS_KEY = 'flipodKnownWords';
const BOOKMARKS_KEY = 'flipodBookmarks';
const VOCAB_KEY = 'flipodVocab';
const LIKED_CLIPS_KEY = 'flipodLikedClips';
const LIKE_EVENTS_KEY = 'flipodLikes';

export type LikeEvent = {
  tag: string;
  timestamp: number;
};

export const DEFAULT_SETTINGS: AppSettings = {
  dominantHand: 'right',
  playbackRate: 1,
  practiceIntroSeen: false,
  bookmarkPracticeHintSeen: false,
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
