import * as AppleAuthentication from 'expo-apple-authentication';
import { Audio } from 'expo-av';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  buildClipKey,
  canonicalizeClipKey,
  findClipIndexByKey,
  getClipDurationSeconds,
  getLevelWeight,
  getSourceLabel,
  resolveDataUrls,
  toBookmark,
} from './src/clip-utils';
import {
  buildContentTranslationCacheKey,
  buildContentTranslationRequestItem,
  buildLocalizedClip,
  getDevicePreferredNativeLanguage,
  shouldRefreshLocalizedTitle,
  shouldRequestRemoteTranslations,
} from './src/content-localization';
import { AppToast } from './src/components/AppToast';
import { CalibrationToast } from './src/components/CalibrationToast';
import { PracticeSessionModal } from './src/components/PracticeSessionModal';
import { type MenuScreen, SlideMenu } from './src/components/SlideMenu';
import { demoClips } from './src/demo-clips';
import {
  applyRankedFeedOrder,
  buildLocalizedRecommendationReason,
  buildClipManifest,
  buildLocalStarterFeedFallback,
  collectClipIdsByKeys,
  deriveLikedTopics,
  normalizeClips,
  normalizeTopic,
} from './src/feed-ranking';
import { FeedScreen } from './src/screens/FeedScreen';
import { AccountScreen } from './src/screens/AccountScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { PracticeScreen } from './src/screens/PracticeScreen';
import { VocabScreen } from './src/screens/VocabScreen';
import { api } from './src/services/api';
import { disposeUiFeedback, primeUiFeedback, triggerUiFeedback } from './src/feedback';
import { createUiI18n, UiI18nProvider } from './src/i18n';
import { AppThemeProvider } from './src/theme';
import {
  DEFAULT_CALIBRATION_SIGNALS,
  clearAccountState,
  clearAuthToken,
  clearGuestMode,
  DEFAULT_SETTINGS,
  getOrCreateDeviceId,
  loadAuthToken,
  loadBookmarks,
  loadCalibrationSignals,
  loadCalibrationState,
  loadGuestMode,
  loadLikeEvents,
  loadLikedClips,
  loadListenedClips,
  loadKnownWords,
  loadContentTranslations,
  loadPracticeData,
  loadProfile,
  loadReviewState,
  loadSettings,
  loadVocab,
  saveAuthBootstrapSnapshot,
  saveAuthToken,
  saveBookmarks,
  saveCalibrationSignals,
  saveCalibrationState,
  saveContentTranslations,
  saveGuestMode,
  saveLikeEvents,
  saveLikedClips,
  saveListenedClips,
  saveKnownWords,
  savePracticeData,
  saveProfile,
  saveReviewState,
  saveSettings,
  saveVocab,
} from './src/storage';
import type {
  AppSettings,
  AuthBootstrapResponse,
  AuthInitResponse,
  Bookmark,
  CalibrationSignals,
  CalibrationState,
  CalibrationSuggestion,
  Clip,
  LikeEvent,
  Level,
  LocalizedClipContent,
  LinkedIdentity,
  NativeLanguage,
  PracticeMap,
  Profile,
  RankMode,
  RankRequest,
  RankedFeedItem,
  ReviewState,
  SubtitleSize,
  VocabEntry,
} from './src/types';

const DEVICE_NATIVE_LANGUAGE = getDevicePreferredNativeLanguage();

const defaultProfile: Profile = {
  level: null,
  interests: [],
  nativeLanguage: DEVICE_NATIVE_LANGUAGE,
  theme: 'dark',
  onboardingDone: false,
};

const FEED_BATCH_SIZE = 10;

function deriveRecoTag(events: LikeEvent[]) {
  if (events.length < 3) return null;
  const recent = events.slice(-10);
  const counts = new Map<string, number>();

  for (const event of recent) {
    const tag = event.tag?.toLowerCase();
    if (!tag) continue;
    counts.set(tag, (counts.get(tag) || 0) + 1);
  }

  let bestTag: string | null = null;
  let bestCount = 0;
  for (const [tag, count] of counts.entries()) {
    if (count > bestCount) {
      bestTag = tag;
      bestCount = count;
    }
  }

  return bestTag && bestCount / recent.length > 0.5 ? bestTag : null;
}

function normalizeLevel(level: Profile['level'] | null): Level {
  return (level || 'B1') as Level;
}

function buildCalibrationSuggestion(
  signals: CalibrationSignals,
  calibrationState: CalibrationState,
  level: Level,
  t: (key: string, params?: Record<string, string | number>) => string
): CalibrationSuggestion | null {
  const avg = signals.avgWordsPerClip || 0;
  const hardRate = signals.practiceHardRate || 0;
  const wordsByLevel = signals.wordsByLevel || {};
  const totalWords = Object.values(wordsByLevel).reduce((sum, value) => sum + value, 0);
  const b2Plus = (wordsByLevel.B2 || 0) + (wordsByLevel.C1 || 0) + (wordsByLevel.C2 || 0);
  const c1Plus = (wordsByLevel.C1 || 0) + (wordsByLevel.C2 || 0);
  const b2PlusRatio = totalWords > 0 ? b2Plus / totalWords : 0;
  const c1PlusRatio = totalWords > 0 ? c1Plus / totalWords : 0;
  const levelNum = getLevelWeight(level);

  if (!calibrationState.suggestedUp && levelNum < 4 && avg < 1.5 && hardRate < 0.2 && b2PlusRatio < 0.3) {
    const toLevel = levelNum === 1 ? 'B1' : levelNum === 2 ? 'B2' : 'C1-C2';
    return {
      direction: 'up',
      fromLevel: level,
      toLevel,
      message: t('calibration.suggestedUp', { fromLevel: level, toLevel }),
    };
  }

  if (!calibrationState.suggestedDown && levelNum > 1 && avg > 5 && hardRate > 0.6 && c1PlusRatio > 0.5) {
    const toLevel = levelNum === 4 ? 'B2' : levelNum === 3 ? 'B1' : 'A1-A2';
    return {
      direction: 'down',
      fromLevel: level,
      toLevel,
      message: t('calibration.suggestedDown', { fromLevel: level, toLevel }),
    };
  }

  return null;
}

function readErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof Error) {
    try {
      const parsed = JSON.parse(error.message) as { error?: string };
      return parsed.error || error.message;
    } catch {
      return error.message;
    }
  }
  return fallbackMessage;
}

function getClipTopic(clip: Clip) {
  return normalizeTopic(String(clip.topic || clip.tag || 'story'));
}

function buildFeedSignature(profile: Profile, clipCount: number) {
  return JSON.stringify({
    level: normalizeLevel(profile.level),
    interests: (profile.interests || []).map(item => String(item).trim().toLowerCase()).slice(0, 3),
    clipCount,
  });
}

function buildFeedReasonMap(feed: RankedFeedItem[]) {
  return feed.reduce<Record<number, string>>((acc, item) => {
    if (Number.isInteger(item.id)) {
      acc[item.id] = item.reason;
    }
    return acc;
  }, {});
}

function preserveFeedPrefixThroughClip(
  currentClips: Clip[],
  incomingFeed: RankedFeedItem[],
  preserveThroughClipId?: number | null
) {
  if (!Number.isInteger(preserveThroughClipId)) {
    return incomingFeed;
  }

  const preserveIndex = currentClips.findIndex(clip => clip.id === preserveThroughClipId);
  if (preserveIndex < 0) {
    return incomingFeed;
  }

  const incomingReasonMap = buildFeedReasonMap(incomingFeed);
  const preservedPrefix = currentClips
    .slice(0, preserveIndex + 1)
    .map(clip => {
      if (!Number.isInteger(clip.id)) return null;
      return {
        id: clip.id as number,
        reason: incomingReasonMap[clip.id as number] || clip._aiReason || '',
      };
    })
    .filter(Boolean) as RankedFeedItem[];

  const preservedIds = new Set(preservedPrefix.map(item => item.id));
  const reorderedTail = incomingFeed.filter(item => !preservedIds.has(item.id));

  return [...preservedPrefix, ...reorderedTail];
}

function cycleSubtitleSize(size: SubtitleSize): SubtitleSize {
  if (size === 'sm') return 'md';
  if (size === 'md') return 'lg';
  return 'sm';
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [deviceId, setDeviceId] = useState('');
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [guestMode, setGuestMode] = useState(false);
  const [linkedIdentities, setLinkedIdentities] = useState<LinkedIdentity[]>([]);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [showAuthSheet, setShowAuthSheet] = useState(false);
  const [profile, setProfile] = useState<Profile>(defaultProfile);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [practiceData, setPracticeData] = useState<PracticeMap>({});
  const [clipsData, setClipsData] = useState<Clip[]>(demoClips);
  const [contentTranslations, setContentTranslations] = useState<Record<string, LocalizedClipContent>>({});
  const [clipsLoaded, setClipsLoaded] = useState(false);
  const [feedOrderIds, setFeedOrderIds] = useState<number[]>([]);
  const [feedReasons, setFeedReasons] = useState<Record<number, string>>({});
  const [skippedClipIds, setSkippedClipIds] = useState<number[]>([]);
  const [visibleFeedCount, setVisibleFeedCount] = useState(FEED_BATCH_SIZE);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [vocabList, setVocabList] = useState<VocabEntry[]>([]);
  const [likedClipKeys, setLikedClipKeys] = useState<string[]>([]);
  const [listenedClipKeys, setListenedClipKeys] = useState<string[]>([]);
  const [likeEvents, setLikeEvents] = useState<LikeEvent[]>([]);
  const [knownWords, setKnownWords] = useState<string[]>([]);
  const [reviewState, setReviewState] = useState<ReviewState>({});
  const [calibrationSignals, setCalibrationSignals] = useState<CalibrationSignals>(DEFAULT_CALIBRATION_SIGNALS);
  const [calibrationState, setCalibrationState] = useState<CalibrationState>({});
  const [calibrationSuggestion, setCalibrationSuggestion] = useState<CalibrationSuggestion | null>(null);
  const [clipsPlayed, setClipsPlayed] = useState(0);
  const [activeScreen, setActiveScreen] = useState<MenuScreen>('feed');
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedState, setFeedState] = useState<'loading' | 'normal' | 'rerank' | 'fallback'>('loading');
  const [practiceClipKey, setPracticeClipKey] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const currentTheme = profile.theme === 'light' ? 'light' : 'dark';
  const ui = useMemo(() => createUiI18n(profile.nativeLanguage), [profile.nativeLanguage]);
  const playedKeysRef = useRef<Set<string>>(new Set());
  const calibrationStateRef = useRef<CalibrationState>({});
  const lastFeedSignatureRef = useRef<string | null>(null);
  const currentClipsRef = useRef<Clip[]>(demoClips);
  const rankContextRef = useRef<{
    manifest: ReturnType<typeof buildClipManifest>;
    listenedClipIds: number[];
    skippedClipIds: number[];
    likedTopics: string[];
    wordsLookedUp: number;
  }>({
    manifest: buildClipManifest(demoClips),
    listenedClipIds: [],
    skippedClipIds: [],
    likedTopics: [],
    wordsLookedUp: 0,
  });
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightContentTranslationsRef = useRef<Set<string>>(new Set());

  const applyAuthSnapshot = useCallback((snapshot: AuthBootstrapResponse) => {
    setProfile({
      level: snapshot.profile.level || null,
      interests: Array.isArray(snapshot.profile.interests) ? snapshot.profile.interests : [],
      nativeLanguage: snapshot.profile.nativeLanguage || DEVICE_NATIVE_LANGUAGE,
      theme: snapshot.profile.theme === 'light' ? 'light' : 'dark',
      onboardingDone: Boolean(snapshot.profile.onboardingDone),
    });
    setBookmarks(snapshot.bookmarks || []);
    setVocabList(snapshot.vocab || []);
    setPracticeData(snapshot.practiceData || {});
    setKnownWords(snapshot.knownWords || []);
    setLikedClipKeys(snapshot.likedClipKeys || []);
    setLikeEvents(snapshot.likeEvents || []);
    setLinkedIdentities(snapshot.linkedIdentities || []);
    setActiveScreen('feed');
    setPracticeClipKey(null);
    setFeedOrderIds([]);
    setFeedReasons({});
    setSkippedClipIds([]);
    setVisibleFeedCount(FEED_BATCH_SIZE);
    lastFeedSignatureRef.current = null;
  }, []);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    setToastVisible(true);
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = setTimeout(() => {
      setToastVisible(false);
    }, 2600);
  }, []);

  const requestContentTranslations = useCallback(async (
    targetClips: Array<{ clip: Clip; index: number }>,
    localeOverride?: NativeLanguage
  ) => {
    const locale = localeOverride || profile.nativeLanguage;
    if (!shouldRequestRemoteTranslations(locale)) {
      return;
    }

    const items = targetClips.reduce<Array<ReturnType<typeof buildContentTranslationRequestItem>>>((acc, entry) => {
      const item = buildContentTranslationRequestItem(entry.clip, entry.index);
      const cacheKey = buildContentTranslationCacheKey(item.contentKey, locale, item.contentHash);
      const cachedTranslation = contentTranslations[cacheKey];
      const cacheMissingTitle = !String(cachedTranslation?.title || '').trim();
      const cacheNeedsTitleRefresh = shouldRefreshLocalizedTitle(entry.clip, locale, cachedTranslation);
      if (
        (cachedTranslation && !cacheMissingTitle && !cacheNeedsTitleRefresh)
        || inflightContentTranslationsRef.current.has(cacheKey)
      ) {
        return acc;
      }
      inflightContentTranslationsRef.current.add(cacheKey);
      acc.push(item);
      return acc;
    }, []);

    if (!items.length) {
      return;
    }

    try {
      const response = await api.getContentTranslations(locale, items);
      setContentTranslations(prev => {
        const next = { ...prev };
        for (const translation of Object.values(response.translations || {})) {
          const cacheKey = buildContentTranslationCacheKey(
            translation.contentKey,
            locale,
            translation.contentHash
          );
          next[cacheKey] = translation;
        }
        void saveContentTranslations(next);
        return next;
      });
    } catch {
    } finally {
      items.forEach(item => {
        inflightContentTranslationsRef.current.delete(
          buildContentTranslationCacheKey(item.contentKey, locale, item.contentHash)
        );
      });
    }
  }, [contentTranslations, profile.nativeLanguage]);

  const localizedClipsData = useMemo(() => {
    return clipsData.map((clip, index) => {
      const identity = buildContentTranslationRequestItem(clip, index);
      const cacheKey = buildContentTranslationCacheKey(
        identity.contentKey,
        profile.nativeLanguage,
        identity.contentHash
      );
      return buildLocalizedClip(
        clip,
        profile.nativeLanguage,
        contentTranslations[cacheKey],
        ui.t('common.translationUnavailable')
      );
    });
  }, [clipsData, contentTranslations, profile.nativeLanguage, ui]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    calibrationStateRef.current = calibrationState;
  }, [calibrationState]);

  useEffect(() => {
    void Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    }).then(() => primeUiFeedback()).catch(() => {});

    return () => {
      void disposeUiFeedback();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const [
          nextDeviceId,
          nextAuthToken,
          nextGuestMode,
          localProfile,
          localSettings,
          localPractice,
          localKnownWords,
          localBookmarks,
          localVocab,
          localLikedClips,
          localLikeEvents,
          localListenedClips,
          localReviewState,
          localCalibrationSignals,
          localCalibrationState,
          localContentTranslations,
        ] = await Promise.all([
          getOrCreateDeviceId(),
          loadAuthToken(),
          loadGuestMode(),
          loadProfile(),
          loadSettings(),
          loadPracticeData(),
          loadKnownWords(),
          loadBookmarks(),
          loadVocab(),
          loadLikedClips(),
          loadLikeEvents(),
          loadListenedClips(),
          loadReviewState(),
          loadCalibrationSignals(),
          loadCalibrationState(),
          loadContentTranslations(),
        ]);

        if (cancelled) return;
        const normalizedClipCount = Math.max(localCalibrationSignals.clipsPlayed || 0, localListenedClips.length);
        const normalizedCalibrationSignals = {
          ...localCalibrationSignals,
          clipsPlayed: normalizedClipCount,
          avgWordsPerClip: normalizedClipCount > 0
            ? localCalibrationSignals.wordsLookedUp / normalizedClipCount
            : 0,
        };
        setDeviceId(nextDeviceId);
        setGuestMode(nextGuestMode);
        setSettings(localSettings);
        setProfile(localProfile || {
          ...defaultProfile,
          nativeLanguage: DEVICE_NATIVE_LANGUAGE,
        });
        setPracticeData(localPractice);
        setKnownWords(localKnownWords);
        setBookmarks(localBookmarks);
        setVocabList(localVocab);
        setLikedClipKeys(localLikedClips);
        setLikeEvents(localLikeEvents);
        setListenedClipKeys(localListenedClips);
        setReviewState(localReviewState);
        setCalibrationSignals(normalizedCalibrationSignals);
        setCalibrationState(localCalibrationState);
        setContentTranslations(localContentTranslations);
        setClipsPlayed(normalizedClipCount);
        playedKeysRef.current = new Set(localListenedClips);
        calibrationStateRef.current = localCalibrationState;

        if (normalizedClipCount !== localCalibrationSignals.clipsPlayed) {
          void saveCalibrationSignals(normalizedCalibrationSignals);
        }

        if (nextAuthToken) {
          try {
            const snapshot = await api.getAuthBootstrap(nextAuthToken);
            if (cancelled) return;
            applyAuthSnapshot(snapshot);
            setAuthToken(nextAuthToken);
            setGuestMode(false);
            await saveAuthBootstrapSnapshot(snapshot);
            await clearGuestMode();
          } catch {
            await clearAuthToken();
            if (!cancelled) {
              setAuthToken(null);
              setLinkedIdentities([]);
            }
          }
        }
      } finally {
        if (!cancelled) {
          setBooting(false);
        }
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [applyAuthSnapshot]);

  useEffect(() => {
    let cancelled = false;

    async function loadClips() {
      try {
        let data: { clips?: Clip[] } | null = null;
        let lastError: Error | null = null;
        for (const url of resolveDataUrls()) {
          try {
            const response = await fetch(url);
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
            data = await response.json() as { clips?: Clip[] };
            if (Array.isArray(data.clips) && data.clips.length > 0) {
              break;
            }
          } catch (error) {
            lastError = error instanceof Error ? error : new Error('Failed to load clips');
          }
        }
        if (cancelled) return;

        if (data && Array.isArray(data.clips) && data.clips.length > 0) {
          setClipsData(normalizeClips(data.clips));
          setClipsLoaded(true);
          return;
        }

        if (lastError) {
          throw lastError;
        }
        setClipsData(demoClips);
        setClipsLoaded(true);
      } catch {
        if (!cancelled) {
          setClipsData(demoClips);
          setClipsLoaded(true);
        }
      }
    }

    void loadClips();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!clipsData.length) return;

    const canonicalize = (clipKey: string) => canonicalizeClipKey(clipsData, clipKey);
    const dedupeStrings = (values: string[]) => {
      const seen = new Set<string>();
      return values.filter(value => {
        const normalized = canonicalize(value);
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      }).map(value => canonicalize(value));
    };

    const nextBookmarks = (() => {
      let changed = false;
      const seen = new Set<string>();
      const mapped = bookmarks.reduce<Bookmark[]>((acc, item) => {
        const clipKey = canonicalize(item.clipKey);
        changed = changed || clipKey !== item.clipKey;
        if (seen.has(clipKey)) {
          changed = true;
          return acc;
        }
        seen.add(clipKey);
        acc.push({ ...item, clipKey });
        return acc;
      }, []);
      return changed ? mapped : null;
    })();

    const nextPracticeData = (() => {
      let changed = false;
      const remapped: PracticeMap = {};
      Object.entries(practiceData).forEach(([clipKey, record]) => {
        const canonicalKey = canonicalize(clipKey);
        changed = changed || canonicalKey !== clipKey;
        remapped[canonicalKey] = record;
      });
      return changed ? remapped : null;
    })();

    const nextLikedClipKeys = (() => {
      const mapped = dedupeStrings(likedClipKeys);
      const changed = mapped.length !== likedClipKeys.length || mapped.some((value, index) => value !== likedClipKeys[index]);
      return changed ? mapped : null;
    })();

    const nextListenedClipKeys = (() => {
      const mapped = dedupeStrings(listenedClipKeys);
      const changed = mapped.length !== listenedClipKeys.length || mapped.some((value, index) => value !== listenedClipKeys[index]);
      return changed ? mapped : null;
    })();

    const nextVocabList = (() => {
      let changed = false;
      const mapped = vocabList.map(item => {
        if (!item.clipKey) return item;
        const clipKey = canonicalize(item.clipKey);
        if (clipKey !== item.clipKey) {
          changed = true;
          return { ...item, clipKey };
        }
        return item;
      });
      return changed ? mapped : null;
    })();

    if (practiceClipKey) {
      const canonicalPracticeClipKey = canonicalize(practiceClipKey);
      if (canonicalPracticeClipKey !== practiceClipKey) {
        setPracticeClipKey(canonicalPracticeClipKey);
      }
    }

    if (nextBookmarks) {
      setBookmarks(nextBookmarks);
      void saveBookmarks(nextBookmarks);
    }
    if (nextPracticeData) {
      setPracticeData(nextPracticeData);
      void savePracticeData(nextPracticeData);
    }
    if (nextLikedClipKeys) {
      setLikedClipKeys(nextLikedClipKeys);
      void saveLikedClips(nextLikedClipKeys);
    }
    if (nextListenedClipKeys) {
      setListenedClipKeys(nextListenedClipKeys);
      playedKeysRef.current = new Set(nextListenedClipKeys);
      void saveListenedClips(nextListenedClipKeys);
    }
    if (nextVocabList) {
      setVocabList(nextVocabList);
      void saveVocab(nextVocabList);
    }
  }, [bookmarks, clipsData, likedClipKeys, listenedClipKeys, practiceClipKey, practiceData, vocabList]);
  const bookmarkedKeys = useMemo(() => bookmarks.map(item => item.clipKey), [bookmarks]);
  const likedKeys = useMemo(() => new Set(likedClipKeys), [likedClipKeys]);
  const vocabWords = useMemo(() => vocabList.map(item => item.word), [vocabList]);
  const recoTag = useMemo(() => deriveRecoTag(likeEvents), [likeEvents]);
  const clipManifest = useMemo(() => buildClipManifest(clipsData), [clipsData]);
  const listenedClipIds = useMemo(() => {
    return collectClipIdsByKeys(clipsData, listenedClipKeys, buildClipKey);
  }, [clipsData, listenedClipKeys]);
  const likedTopics = useMemo(() => deriveLikedTopics(likeEvents), [likeEvents]);
  const rankedFeed = useMemo<RankedFeedItem[]>(() => {
    return feedOrderIds.map(id => ({
      id,
      reason: feedReasons[id] || '',
    }));
  }, [feedOrderIds, feedReasons]);
  const resolveRankReason = useCallback((clip: Clip) => {
    return buildLocalizedRecommendationReason(
      clip,
      normalizeLevel(profile.level),
      profile.interests,
      ui.t
    );
  }, [profile.interests, profile.level, ui]);
  const currentRawClips = useMemo(() => {
    const rankedClips = applyRankedFeedOrder(clipsData, rankedFeed, clip => resolveRankReason(clip));
    if (rankedClips.length > 0) {
      return rankedClips;
    }
    return clipsData;
  }, [clipsData, rankedFeed, resolveRankReason]);
  const currentClips = useMemo(() => {
    const rankedClips = applyRankedFeedOrder(localizedClipsData, rankedFeed, clip => resolveRankReason(clip));
    if (rankedClips.length > 0) {
      return rankedClips;
    }
    return localizedClipsData;
  }, [localizedClipsData, rankedFeed, resolveRankReason]);
  const visibleFeedClips = useMemo(() => {
    return currentClips.slice(0, visibleFeedCount);
  }, [currentClips, visibleFeedCount]);
  const minutesListened = useMemo(() => {
    const listenedSet = new Set(listenedClipKeys);
    const totalSeconds = clipsData.reduce((sum, clip, index) => {
      const clipKey = buildClipKey(clip, index);
      if (!listenedSet.has(clipKey)) return sum;
      return sum + getClipDurationSeconds(clip);
    }, 0);
    return Math.max(0, Math.round(totalSeconds / 60));
  }, [clipsData, listenedClipKeys]);
  const practiceCount = useMemo(() => {
    return bookmarks.filter(item => !practiceData[item.clipKey]?.done).length || bookmarks.length;
  }, [bookmarks, practiceData]);
  const practiceClipIndex = practiceClipKey ? findClipIndexByKey(clipsData, practiceClipKey) : -1;
  const practiceClip = practiceClipIndex >= 0 ? localizedClipsData[practiceClipIndex] : null;
  const isAuthenticated = Boolean(authToken);
  const isGuest = guestMode && !authToken;
  const canAccessApp = Boolean(authToken || guestMode);

  const localMigrationPayload = useMemo(() => ({
    deviceId,
    profile,
    bookmarks,
    vocab: vocabList,
    practiceData,
    knownWords,
    likedClipKeys,
    likeEvents,
  }), [bookmarks, deviceId, knownWords, likeEvents, likedClipKeys, practiceData, profile, vocabList]);

  useEffect(() => {
    rankContextRef.current = {
      manifest: clipManifest,
      listenedClipIds,
      skippedClipIds,
      likedTopics,
      wordsLookedUp: calibrationSignals.wordsLookedUp,
    };
  }, [calibrationSignals.wordsLookedUp, clipManifest, likedTopics, listenedClipIds, skippedClipIds]);

  useEffect(() => {
    currentClipsRef.current = currentClips;
  }, [currentClips]);

  useEffect(() => {
    if (!clipsLoaded || !currentRawClips.length) return;
    void requestContentTranslations(
      currentRawClips.slice(0, 2).map((clip, index) => ({ clip, index })),
      profile.nativeLanguage
    );
  }, [clipsLoaded, currentRawClips, profile.nativeLanguage, requestContentTranslations]);

  useEffect(() => {
    if (practiceClipIndex < 0) return;
    const rawClip = clipsData[practiceClipIndex];
    if (!rawClip) return;
    void requestContentTranslations([{ clip: rawClip, index: practiceClipIndex }], profile.nativeLanguage);
  }, [clipsData, practiceClipIndex, profile.nativeLanguage, requestContentTranslations]);

  const applyFeedItems = useCallback((feed: RankedFeedItem[], nextState: 'normal' | 'fallback') => {
    setFeedOrderIds(feed.map(item => item.id));
    setFeedReasons(buildFeedReasonMap(feed));
    setVisibleFeedCount(FEED_BATCH_SIZE);
    setFeedState(nextState);
  }, []);

  const buildRankRequestForProfile = useCallback((nextProfile: Profile, mode: RankMode = 'starter'): RankRequest => {
    const context = rankContextRef.current;
    return {
      mode,
      level: normalizeLevel(nextProfile.level),
      interests: nextProfile.interests.slice(0, 3),
      listenedClipIds: context.listenedClipIds,
      skippedClipIds: context.skippedClipIds,
      likedTopics: context.likedTopics,
      wordsLookedUp: context.wordsLookedUp,
      maxItems: Math.max(FEED_BATCH_SIZE, context.manifest.length),
    };
  }, []);

  const handleLoadMoreFeed = useCallback(() => {
    setVisibleFeedCount(prev => {
      if (prev >= currentClips.length) {
        return prev;
      }
      return Math.min(prev + FEED_BATCH_SIZE, currentClips.length);
    });
  }, [currentClips.length]);

  const requestRankedFeed = useCallback(async (
    nextProfile: Profile,
    options: {
      mode?: RankMode;
      pendingState?: 'loading' | 'rerank';
      signature?: string | null;
      preserveThroughClipId?: number | null;
    } = {}
  ) => {
    const request = buildRankRequestForProfile(nextProfile, options.mode || 'starter');
    const fallbackFeed = buildLocalStarterFeedFallback(rankContextRef.current.manifest, request, ui.t);

    if (options.pendingState) {
      setFeedState(options.pendingState);
    }

    const applySignature = () => {
      if (options.signature) {
        lastFeedSignatureRef.current = options.signature;
      }
    };

    if (!authToken) {
      applyFeedItems(
        preserveFeedPrefixThroughClip(currentClipsRef.current, fallbackFeed, options.preserveThroughClipId),
        'fallback'
      );
      applySignature();
      return fallbackFeed;
    }

    try {
      const response = await api.rankFeed(request, authToken);
      const remoteFeed = Array.isArray(response.feed) && response.feed.length > 0 ? response.feed : fallbackFeed;
      applyFeedItems(
        preserveFeedPrefixThroughClip(currentClipsRef.current, remoteFeed, options.preserveThroughClipId),
        response.feed?.length ? 'normal' : 'fallback'
      );
      applySignature();
      return remoteFeed;
    } catch {
      applyFeedItems(
        preserveFeedPrefixThroughClip(currentClipsRef.current, fallbackFeed, options.preserveThroughClipId),
        'fallback'
      );
      applySignature();
      return fallbackFeed;
    }
  }, [applyFeedItems, authToken, buildRankRequestForProfile, ui]);

  useEffect(() => {
    if (!authToken || !clipsLoaded || !profile.onboardingDone) return;

    const signature = buildFeedSignature(profile, clipManifest.length);
    if (lastFeedSignatureRef.current === signature) {
      return;
    }

    void requestRankedFeed(profile, {
      mode: 'starter',
      pendingState: feedOrderIds.length > 0 ? 'rerank' : 'loading',
      signature,
    });
  }, [
    authToken,
    clipManifest.length,
    clipsLoaded,
    feedOrderIds.length,
    profile,
    requestRankedFeed,
  ]);

  const persistSettings = useCallback(async (nextSettings: AppSettings) => {
    setSettings(nextSettings);
    await saveSettings(nextSettings);
  }, []);

  const maybeShowCalibration = useCallback((signals: CalibrationSignals) => {
    if (practiceClipKey || calibrationSuggestion) return;
    const suggestion = buildCalibrationSuggestion(
      signals,
      calibrationStateRef.current,
      normalizeLevel(profile.level),
      ui.t
    );
    if (suggestion) {
      setCalibrationSuggestion(suggestion);
    }
  }, [calibrationSuggestion, practiceClipKey, profile.level, ui]);

  const finishAuthFlow = useCallback(async (payload: AuthInitResponse) => {
    const snapshot = await api.migrateLocal(payload.session.token, localMigrationPayload);
    await Promise.all([
      saveAuthToken(payload.session.token),
      saveAuthBootstrapSnapshot(snapshot),
      clearGuestMode(),
    ]);
    setAuthToken(payload.session.token);
    setGuestMode(false);
    applyAuthSnapshot(snapshot);
    setActiveScreen('feed');
    setMenuOpen(false);
    setShowAuthSheet(false);
    setAuthError('');
    triggerUiFeedback('success');
  }, [applyAuthSnapshot, localMigrationPayload]);

  const handleRequestSms = useCallback(async (phoneNumber: string) => {
    setAuthError('');
    return api.requestSmsCode(phoneNumber);
  }, []);

  const handleVerifyPhone = useCallback(async (phoneNumber: string, code: string) => {
    setAuthBusy(true);
    setAuthError('');
    try {
      if (showAuthSheet && authToken) {
        const response = await api.linkPhone(authToken, phoneNumber, code, deviceId);
        setLinkedIdentities(response.linkedIdentities);
        setShowAuthSheet(false);
        showToast(ui.t('app.toastPhoneLinked'));
        triggerUiFeedback('success');
        return;
      }

      const response = await api.verifySmsCode(phoneNumber, code, deviceId);
      await finishAuthFlow(response);
    } catch (error) {
      const message = readErrorMessage(error, ui.t('app.requestFailed'));
      setAuthError(message);
      throw new Error(message);
    } finally {
      setAuthBusy(false);
    }
  }, [authToken, deviceId, finishAuthFlow, showAuthSheet, showToast, ui]);

  const handleApplePress = useCallback(async () => {
    setAuthBusy(true);
    setAuthError('');

    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken || !credential.authorizationCode) {
        throw new Error(ui.t('login.appleFailed'));
      }

      const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
        .filter(Boolean)
        .join(' ')
        .trim();

      if (showAuthSheet && authToken) {
        const response = await api.linkApple(
          authToken,
          credential.identityToken,
          credential.authorizationCode,
          deviceId,
          fullName
        );
        setLinkedIdentities(response.linkedIdentities);
        setShowAuthSheet(false);
        showToast(ui.t('app.toastAppleLinked'));
        triggerUiFeedback('success');
        return;
      }

      const response = await api.signInWithApple(
        credential.identityToken,
        credential.authorizationCode,
        deviceId,
        fullName
      );
      await finishAuthFlow(response);
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 'ERR_REQUEST_CANCELED') {
        return;
      }

      const message = readErrorMessage(error, ui.t('app.requestFailed'));
      setAuthError(message);
      throw new Error(message);
    } finally {
      setAuthBusy(false);
    }
  }, [authToken, deviceId, finishAuthFlow, showAuthSheet, showToast, ui]);

  const handleProfileSubmit = async (nextProfile: Profile) => {
    setProfile(nextProfile);
    setMenuOpen(false);
    await saveProfile(nextProfile);
    const signature = buildFeedSignature(nextProfile, rankContextRef.current.manifest.length);

    if (authToken) {
      try {
        await api.saveProfile(authToken, nextProfile);
        await api.trackEvent(authToken, 'onboarding_completed', {
          level: nextProfile.level,
          interests: nextProfile.interests,
        });
      } catch {
      }
    }

    await requestRankedFeed(nextProfile, {
      mode: 'starter',
      pendingState: 'loading',
      signature,
    });

    setActiveScreen('feed');
  };

  const boostInterestFromLike = async (tag: string, preserveThroughClipId?: number | null) => {
    const normalized = normalizeTopic(tag);
    if (!normalized) return;

    const nextProfile = {
      ...profile,
      interests: profile.interests.includes(normalized)
        ? profile.interests
        : [...profile.interests, normalized].slice(-3),
    };
    setProfile(nextProfile);
    await saveProfile(nextProfile);
    const signature = buildFeedSignature(nextProfile, rankContextRef.current.manifest.length);

    if (authToken) {
      try {
        await Promise.all([
          api.saveProfile(authToken, nextProfile),
          api.trackEvent(authToken, 'topic_promoted_from_like', {
            topic: normalized,
            interests: nextProfile.interests,
          }),
        ]);
      } catch {
      }
    }

    await requestRankedFeed(nextProfile, {
      mode: 'rerank',
      pendingState: 'rerank',
      signature,
      preserveThroughClipId,
    });
  };

  const handleResetProfile = async () => {
    setProfile(defaultProfile);
    setActiveScreen('feed');
    setMenuOpen(false);
    setPracticeClipKey(null);
    setFeedOrderIds([]);
    setFeedReasons({});
    setSkippedClipIds([]);
    setVisibleFeedCount(FEED_BATCH_SIZE);
    lastFeedSignatureRef.current = null;
    await saveProfile(defaultProfile);
    if (authToken) {
      try {
        await api.saveProfile(authToken, defaultProfile);
      } catch {
      }
    }
  };

  const handleToggleBookmark = async (clip: Clip, index: number) => {
    triggerUiFeedback('bookmark');
    const nextBookmark = toBookmark(clip, index);
    const exists = bookmarkedKeys.includes(nextBookmark.clipKey);

    if (exists) {
      const nextBookmarks = bookmarks.filter(item => item.clipKey !== nextBookmark.clipKey);
      setBookmarks(nextBookmarks);
      await saveBookmarks(nextBookmarks);
      if (authToken) {
        try {
          await api.removeBookmark(authToken, nextBookmark.clipKey);
        } catch {
        }
      }
      return;
    }

    const nextBookmarks = [nextBookmark, ...bookmarks.filter(item => item.clipKey !== nextBookmark.clipKey)];
    setBookmarks(nextBookmarks);
    await saveBookmarks(nextBookmarks);
    if (!settings.bookmarkPracticeHintSeen) {
      const nextSettings = { ...settings, bookmarkPracticeHintSeen: true };
      void persistSettings(nextSettings);
      showToast(ui.t('app.toastSavedForPractice'));
    }

    if (authToken) {
      try {
        await api.saveBookmark(authToken, nextBookmark);
      } catch {
      }
    }
  };

  const handleSaveVocab = async (entry: VocabEntry) => {
    const now = Date.now();
    const existing = vocabList.find(item => item.word === entry.word.toLowerCase());
    const normalizedEntry = {
      ...existing,
      ...entry,
      word: entry.word.toLowerCase(),
      timestamp: existing?.timestamp || entry.timestamp || now,
      createdAt: existing?.createdAt || entry.createdAt || new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    };
    const nextVocab = vocabList.some(item => item.word === normalizedEntry.word)
      ? vocabList.map(item => item.word === normalizedEntry.word ? { ...item, ...normalizedEntry } : item)
      : [normalizedEntry, ...vocabList];
    setVocabList(nextVocab);
    await saveVocab(nextVocab);

    if (authToken) {
      try {
        await api.saveVocab(authToken, normalizedEntry);
      } catch {
      }
    }
  };

  const handleRecordWordLookup = useCallback((cefr?: string, details?: { clip?: Clip | null; word?: string }) => {
    setCalibrationSignals(prev => {
      const nextWordsByLevel = { ...prev.wordsByLevel };
      const normalized = (cefr || '').toUpperCase().replace(/^A$/, 'A2');
      if (normalized && /^[ABC][12]$/.test(normalized)) {
        nextWordsByLevel[normalized] = (nextWordsByLevel[normalized] || 0) + 1;
      }

      const next = {
        ...prev,
        wordsLookedUp: prev.wordsLookedUp + 1,
        wordsByLevel: nextWordsByLevel,
        avgWordsPerClip: prev.clipsPlayed > 0 ? (prev.wordsLookedUp + 1) / prev.clipsPlayed : 0,
      };
      void saveCalibrationSignals(next);
      return next;
    });

    if (authToken && details?.clip && details.word) {
      void api.trackEvent(
        authToken,
        'word_lookup',
        {
          word: details.word.toLowerCase(),
          cefr,
          topic: getClipTopic(details.clip),
          source: getSourceLabel(details.clip.source),
        },
        details.clip.id
      ).catch(() => {});
    }
  }, [authToken]);

  const handleMarkKnown = async (word: string) => {
    const normalized = word.toLowerCase();
    setKnownWords(prev => {
      if (prev.includes(normalized)) return prev;
      const next = [...prev, normalized];
      void saveKnownWords(next);
      return next;
    });

    if (authToken) {
      try {
        await api.saveKnownWord(authToken, normalized);
      } catch {
      }
    }
  };

  const handleRemoveBookmark = async (clipKey: string) => {
    const nextBookmarks = bookmarks.filter(item => item.clipKey !== clipKey);
    setBookmarks(nextBookmarks);
    await saveBookmarks(nextBookmarks);

    if (authToken) {
      try {
        await api.removeBookmark(authToken, clipKey);
      } catch {
      }
    }
  };

  const handleToggleLike = async (clip: Clip, index: number) => {
    triggerUiFeedback('like');
    const clipKey = buildClipKey(clip, index);
    const isLiked = likedKeys.has(clipKey);
    const topic = getClipTopic(clip);

    if (isLiked) {
      const nextLikedClips = likedClipKeys.filter(item => item !== clipKey);
      setLikedClipKeys(nextLikedClips);
      await saveLikedClips(nextLikedClips);
      if (authToken) {
        try {
          await api.removeLike(authToken, clipKey);
        } catch {
        }
      }
      return;
    }

    const nextLikedClips = [...likedClipKeys, clipKey];
    const nextLikeEvents = [...likeEvents, { tag: topic, timestamp: Date.now() }];
    setLikedClipKeys(nextLikedClips);
    setLikeEvents(nextLikeEvents);
    await Promise.all([
      saveLikedClips(nextLikedClips),
      saveLikeEvents(nextLikeEvents),
    ]);
    showToast(ui.t('app.toastLiked'));
    void boostInterestFromLike(topic, clip.id);

    if (authToken) {
      try {
        const timestamp = nextLikeEvents[nextLikeEvents.length - 1].timestamp;
        await Promise.all([
          api.saveLike(authToken, clipKey, topic, timestamp),
          api.trackEvent(authToken, 'clip_liked', {
            clipKey,
            topic,
            source: getSourceLabel(clip.source),
          }, clip.id),
        ]);
      } catch {
      }
    }
  };

  const handleClipStarted = useCallback((clip: Clip, index: number) => {
    const clipKey = buildClipKey(clip, index);
    if (playedKeysRef.current.has(clipKey)) return;
    playedKeysRef.current.add(clipKey);
    setClipsPlayed(prev => prev + 1);

    setListenedClipKeys(prev => {
      if (prev.includes(clipKey)) return prev;
      const next = [...prev, clipKey];
      void saveListenedClips(next);
      return next;
    });

    setCalibrationSignals(prev => {
      const nextClipCount = prev.clipsPlayed + 1;
      const next = {
        ...prev,
        clipsPlayed: nextClipCount,
        avgWordsPerClip: nextClipCount > 0 ? prev.wordsLookedUp / nextClipCount : 0,
      };
      void saveCalibrationSignals(next);
      if (nextClipCount >= 10 && nextClipCount % 10 === 0) {
        setTimeout(() => {
          maybeShowCalibration(next);
        }, 500);
      }
      return next;
    });

    if (authToken) {
      void api.trackEvent(authToken, 'clip_started', {
        clipKey,
        topic: getClipTopic(clip),
        source: getSourceLabel(clip.source),
      }, clip.id).catch(() => {});
    }
  }, [authToken, maybeShowCalibration]);

  const handleClipCompleted = useCallback((clip: Clip, index: number, progressRatio: number) => {
    if (!authToken) return;
    void api.trackEvent(authToken, 'clip_completed', {
      clipKey: buildClipKey(clip, index),
      progressRatio,
      topic: getClipTopic(clip),
    }, clip.id).catch(() => {});
  }, [authToken]);

  const handleClipSkipped = useCallback((clip: Clip, index: number, progressRatio: number, dwellMs: number) => {
    if (typeof clip.id === 'number') {
      setSkippedClipIds(prev => (prev.includes(clip.id as number) ? prev : [...prev, clip.id as number]));
    }

    if (!authToken) return;
    void api.trackEvent(authToken, 'clip_skipped', {
      clipKey: buildClipKey(clip, index),
      progressRatio,
      dwellMs,
      topic: getClipTopic(clip),
    }, clip.id).catch(() => {});
  }, [authToken]);

  const handlePlaybackRateChange = (rate: number) => {
    const nextSettings = { ...settings, playbackRate: rate };
    void persistSettings(nextSettings);
  };

  const handleSubtitleSizeChange = () => {
    const nextSettings: AppSettings = {
      ...settings,
      subtitleSize: cycleSubtitleSize(settings.subtitleSize),
    };
    void persistSettings(nextSettings);
  };

  const handleToggleHand = () => {
    const nextSettings: AppSettings = {
      ...settings,
      dominantHand: settings.dominantHand === 'left' ? 'right' : 'left',
    };
    void persistSettings(nextSettings);
  };

  const handleToggleTheme = useCallback(async () => {
    const nextProfile: Profile = {
      ...profile,
      theme: profile.theme === 'light' ? 'dark' : 'light',
    };
    setProfile(nextProfile);
    await saveProfile(nextProfile);

    if (authToken) {
      try {
        await api.saveProfile(authToken, nextProfile);
      } catch {
      }
    }

    showToast(nextProfile.theme === 'light' ? ui.t('app.toastThemeLight') : ui.t('app.toastThemeDark'));
  }, [authToken, profile, showToast, ui]);

  const handleNativeLanguageChange = useCallback(async (nativeLanguage: NativeLanguage) => {
    if (profile.nativeLanguage === nativeLanguage) return;

    const nextProfile: Profile = {
      ...profile,
      nativeLanguage,
    };

    setProfile(nextProfile);
    await saveProfile(nextProfile);

    if (authToken) {
      try {
        await api.saveProfile(authToken, nextProfile);
      } catch {
      }
    }

    void requestContentTranslations(
      currentRawClips.slice(0, 2).map((clip, index) => ({ clip, index })),
      nativeLanguage
    );

    if (practiceClipIndex >= 0 && clipsData[practiceClipIndex]) {
      void requestContentTranslations(
        [{ clip: clipsData[practiceClipIndex], index: practiceClipIndex }],
        nativeLanguage
      );
    }

    showToast(ui.t('app.toastLanguageUpdated'));
  }, [
    authToken,
    clipsData,
    currentRawClips,
    practiceClipIndex,
    profile,
    requestContentTranslations,
    showToast,
    ui,
  ]);

  const handleDismissPracticeIntro = () => {
    if (settings.practiceIntroSeen) return;
    const nextSettings = { ...settings, practiceIntroSeen: true };
    void persistSettings(nextSettings);
  };

  const handlePracticeComplete = useCallback((clipKey: string, record: PracticeMap[string]) => {
    setPracticeData(prev => {
      const next = { ...prev, [clipKey]: record };
      void savePracticeData(next);
      return next;
    });

    setCalibrationSignals(prev => {
      const nextSessions = prev.practiceSessions + 1;
      const clipIndex = findClipIndexByKey(clipsData, clipKey);
      const sentenceCount = clipIndex >= 0 ? clipsData[clipIndex]?.lines.length || 0 : 0;
      const next = {
        ...prev,
        practiceSessions: nextSessions,
        practiceHardRate: nextSessions > 0
          ? ((prev.practiceHardRate * prev.practiceSessions) + (record.hard / Math.max(1, sentenceCount))) / nextSessions
          : prev.practiceHardRate,
      };
      void saveCalibrationSignals(next);
      return next;
    });

    if (authToken) {
      void api.savePractice(authToken, clipKey, record).catch(() => {});
    }
  }, [authToken, clipsData]);

  const handleReviewAction = useCallback((word: string, action: 'remember' | 'forgot') => {
    const normalized = word.toLowerCase();
    const ONE_DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();

    setReviewState(prev => {
      const previous = prev[normalized] || { interval: ONE_DAY, nextReview: now + ONE_DAY };
      const nextEntry = action === 'remember'
        ? {
            interval: previous.interval * 2,
            nextReview: now + previous.interval * 2,
          }
        : {
            interval: ONE_DAY,
            nextReview: now + ONE_DAY,
          };
      const next = { ...prev, [normalized]: nextEntry };
      void saveReviewState(next);
      return next;
    });
  }, []);

  const handleAcceptCalibration = useCallback(async () => {
    if (!calibrationSuggestion) return;
    const directionKey = calibrationSuggestion.direction === 'up' ? 'suggestedUp' : 'suggestedDown';
    const nextProfile = {
      ...profile,
      level: calibrationSuggestion.toLevel,
    };
    const nextCalibrationState = {
      ...calibrationStateRef.current,
      [directionKey]: true,
    };

    calibrationStateRef.current = nextCalibrationState;
    setCalibrationState(nextCalibrationState);
    await Promise.all([
      saveCalibrationState(nextCalibrationState),
      saveProfile(nextProfile),
    ]);
    setProfile(nextProfile);
    setCalibrationSuggestion(null);
    showToast(ui.t('app.toastLevelAdjusted', { level: calibrationSuggestion.toLevel }));
    const signature = buildFeedSignature(nextProfile, rankContextRef.current.manifest.length);

    if (authToken) {
      try {
        await api.saveProfile(authToken, nextProfile);
      } catch {
      }
    }

    await requestRankedFeed(nextProfile, {
      mode: 'rerank',
      pendingState: 'rerank',
      signature,
    });
  }, [authToken, calibrationSuggestion, profile, requestRankedFeed, showToast, ui]);

  const handleDismissCalibration = useCallback(async () => {
    if (!calibrationSuggestion) return;
    const directionKey = calibrationSuggestion.direction === 'up' ? 'suggestedUp' : 'suggestedDown';
    const nextCalibrationState = {
      ...calibrationStateRef.current,
      [directionKey]: true,
    };
    calibrationStateRef.current = nextCalibrationState;
    setCalibrationState(nextCalibrationState);
    setCalibrationSuggestion(null);
    await saveCalibrationState(nextCalibrationState);
  }, [calibrationSuggestion]);

  const handleStartPractice = useCallback((clipIndex: number) => {
    const clip = clipsData[clipIndex];
    if (!clip) return;
    setPracticeClipKey(buildClipKey(clip, clipIndex));
  }, [clipsData]);

  const handleClosePractice = useCallback(() => {
    setPracticeClipKey(null);
  }, []);

  const handleReturnFeed = useCallback(() => {
    setPracticeClipKey(null);
    setActiveScreen('feed');
  }, []);

  const handlePracticeAgain = useCallback(() => {
    setPracticeClipKey(null);
    setActiveScreen('practice');
  }, []);

  const handleTryGuest = useCallback(async () => {
    await saveGuestMode(true);
    setGuestMode(true);
    setAuthError('');
    setShowAuthSheet(false);
    setMenuOpen(false);
    setActiveScreen('feed');
  }, []);

  const handleEndGuestMode = useCallback(async () => {
    await clearGuestMode();
    setGuestMode(false);
    setShowAuthSheet(false);
    setMenuOpen(false);
    setActiveScreen('feed');
    setAuthError('');
  }, []);

  const handleLogout = useCallback(async () => {
    if (authToken) {
      try {
        await api.logout(authToken);
      } catch {
      }
    }

    await Promise.all([
      clearAuthToken(),
      clearAccountState(),
      clearGuestMode(),
    ]);

    setAuthToken(null);
    setGuestMode(false);
    setLinkedIdentities([]);
    setProfile(defaultProfile);
    setPracticeData({});
    setBookmarks([]);
    setVocabList([]);
    setLikedClipKeys([]);
    setListenedClipKeys([]);
    setLikeEvents([]);
    setKnownWords([]);
    setReviewState({});
    setCalibrationSignals(DEFAULT_CALIBRATION_SIGNALS);
    setCalibrationState({});
    playedKeysRef.current = new Set();
    calibrationStateRef.current = {};
    setCalibrationSuggestion(null);
    setClipsPlayed(0);
    setFeedOrderIds([]);
    setFeedReasons({});
    setSkippedClipIds([]);
    setVisibleFeedCount(FEED_BATCH_SIZE);
    lastFeedSignatureRef.current = null;
    setActiveScreen('feed');
    setMenuOpen(false);
    setShowAuthSheet(false);
    setPracticeClipKey(null);
    setAuthError('');
  }, [authToken]);

  const handleDeleteAccount = useCallback(async () => {
    try {
      if (authToken) {
        await api.deleteAccount(authToken);
      }
    } catch (error) {
      showToast(readErrorMessage(error, ui.t('app.requestFailed')));
      return;
    }

    await Promise.all([
      clearAuthToken(),
      clearAccountState(),
      clearGuestMode(),
    ]);

    setAuthToken(null);
    setGuestMode(false);
    setLinkedIdentities([]);
    setProfile(defaultProfile);
    setPracticeData({});
    setBookmarks([]);
    setVocabList([]);
    setLikedClipKeys([]);
    setListenedClipKeys([]);
    setLikeEvents([]);
    setKnownWords([]);
    setReviewState({});
    setCalibrationSignals(DEFAULT_CALIBRATION_SIGNALS);
    setCalibrationState({});
    playedKeysRef.current = new Set();
    calibrationStateRef.current = {};
    setCalibrationSuggestion(null);
    setClipsPlayed(0);
    setFeedOrderIds([]);
    setFeedReasons({});
    setSkippedClipIds([]);
    setVisibleFeedCount(FEED_BATCH_SIZE);
    lastFeedSignatureRef.current = null;
    setActiveScreen('feed');
    setMenuOpen(false);
    setShowAuthSheet(false);
    setPracticeClipKey(null);
    setAuthError('');
    showToast(ui.t('app.toastAccountDeleted'));
  }, [authToken, showToast, ui]);

  let content: React.ReactNode;

  if (booting) {
    content = (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#8B9CF7" />
        <Text style={styles.loadingText}>{ui.t('app.initializing')}</Text>
      </View>
    );
  } else if (!canAccessApp) {
    content = (
      <LoginScreen
        loading={authBusy}
        errorMessage={authError}
        onRequestSms={handleRequestSms}
        onVerifyPhone={handleVerifyPhone}
        onApplePress={handleApplePress}
        onTryGuest={handleTryGuest}
      />
    );
  } else if (!profile.onboardingDone) {
    content = <OnboardingScreen initialProfile={profile} onSubmit={handleProfileSubmit} />;
  } else if (activeScreen === 'library') {
    content = (
      <LibraryScreen
        bookmarks={bookmarks}
        clips={localizedClipsData}
        onRemove={handleRemoveBookmark}
        onBack={() => setActiveScreen('feed')}
      />
    );
  } else if (activeScreen === 'account') {
    content = (
      <AccountScreen
        profile={profile}
        isGuest={isGuest}
        linkedIdentities={linkedIdentities}
        onBack={() => setActiveScreen('feed')}
        onLinkPhone={() => {
          setAuthError('');
          setShowAuthSheet(true);
        }}
        onLinkApple={() => {
          setAuthError('');
          setShowAuthSheet(true);
        }}
        onLogout={() => {
          void handleLogout();
        }}
        onDeleteAccount={handleDeleteAccount}
        onEndGuestMode={() => {
          void handleEndGuestMode();
        }}
        onChangeNativeLanguage={language => {
          void handleNativeLanguageChange(language);
        }}
      />
    );
  } else if (activeScreen === 'practice') {
    content = (
      <PracticeScreen
        bookmarks={bookmarks}
        clips={localizedClipsData}
        profile={profile}
        vocabList={vocabList}
        practiceData={practiceData}
        showIntro={!settings.practiceIntroSeen}
        onDismissIntro={handleDismissPracticeIntro}
        onBackToFeed={() => setActiveScreen('feed')}
        onStartPractice={handleStartPractice}
      />
    );
  } else if (activeScreen === 'vocab') {
    content = (
      <VocabScreen
        vocabList={vocabList}
        clips={localizedClipsData}
        onBack={() => setActiveScreen('feed')}
      />
    );
  } else {
    content = (
      <FeedScreen
        clips={currentClips}
        visibleClipCount={visibleFeedClips.length}
        hasMoreClips={visibleFeedClips.length < currentClips.length}
        profile={profile}
        dominantHand={settings.dominantHand}
        playbackRate={settings.playbackRate}
        subtitleSize={settings.subtitleSize}
        feedState={feedState}
        bookmarkedKeys={bookmarkedKeys}
        likedKeys={likedClipKeys}
        recoTag={recoTag}
        minutesListened={minutesListened}
        reviewState={reviewState}
        vocabEntries={vocabList}
        vocabWords={vocabWords}
        knownWords={knownWords}
        clipsPlayed={clipsPlayed}
        onToggleLike={handleToggleLike}
        onToggleBookmark={handleToggleBookmark}
        onSaveVocab={handleSaveVocab}
        onMarkKnown={handleMarkKnown}
        onRecordWordLookup={handleRecordWordLookup}
        onReviewAction={handleReviewAction}
        onOpenMenu={() => setMenuOpen(true)}
        onLoadMoreClips={handleLoadMoreFeed}
        onPlaybackRateChange={handlePlaybackRateChange}
        onSubtitleSizeChange={handleSubtitleSizeChange}
        onClipStarted={handleClipStarted}
        onClipCompleted={handleClipCompleted}
        onClipSkipped={handleClipSkipped}
        onVisibleClipChange={(clip, index) => {
          const nextTargets = [{ clip: currentRawClips[index] || clip, index }];
          if (currentRawClips[index + 1]) {
            nextTargets.push({ clip: currentRawClips[index + 1], index: index + 1 });
          }
          void requestContentTranslations(nextTargets, profile.nativeLanguage);
        }}
      />
    );
  }

  return (
    <SafeAreaProvider>
      <AppThemeProvider theme={currentTheme}>
        <UiI18nProvider nativeLanguage={profile.nativeLanguage}>
          <View style={[styles.root, currentTheme === 'light' && styles.rootLight]}>
            {content}

            {canAccessApp && !booting ? (
              <>
                <SlideMenu
                  visible={menuOpen}
                  profile={profile}
                  isGuest={isGuest}
                  dominantHand={settings.dominantHand}
                  activeScreen={activeScreen}
                  linkedIdentities={linkedIdentities}
                  bookmarksCount={bookmarks.length}
                  practiceCount={practiceCount}
                  vocabCount={vocabList.length}
                  clipsPlayed={clipsPlayed}
                  onClose={() => setMenuOpen(false)}
                  onNavigate={screen => {
                    setActiveScreen(screen);
                    setMenuOpen(false);
                  }}
                  onToggleHand={handleToggleHand}
                  onToggleTheme={() => {
                    setMenuOpen(false);
                    void handleToggleTheme();
                  }}
                  onResetOnboarding={() => {
                    setMenuOpen(false);
                    void handleResetProfile();
                  }}
                />

                <LoginScreen
                  visible={showAuthSheet}
                  mode={isAuthenticated ? 'link' : 'sign-in'}
                  presentation="modal"
                  linkedIdentities={linkedIdentities}
                  loading={authBusy}
                  errorMessage={authError}
                  onRequestSms={handleRequestSms}
                  onVerifyPhone={handleVerifyPhone}
                  onApplePress={handleApplePress}
                  onCancel={() => {
                    setShowAuthSheet(false);
                    setAuthError('');
                  }}
                />

                <PracticeSessionModal
                  visible={Boolean(practiceClipKey && practiceClip)}
                  clip={practiceClip}
                  clipIndex={practiceClipIndex}
                  vocabWords={vocabWords}
                  knownWords={knownWords}
                  onSaveVocab={handleSaveVocab}
                  onMarkKnown={handleMarkKnown}
                  onRecordWordLookup={handleRecordWordLookup}
                  onComplete={handlePracticeComplete}
                  onDismiss={handleClosePractice}
                  onReturnFeed={handleReturnFeed}
                  onPracticeAgain={handlePracticeAgain}
                />

                <CalibrationToast
                  visible={Boolean(calibrationSuggestion)}
                  message={calibrationSuggestion?.message || ''}
                  acceptLabel={ui.t('common.continue')}
                  dismissLabel={ui.t('common.cancelLater')}
                  onAccept={() => {
                    triggerUiFeedback('success');
                    void handleAcceptCalibration();
                  }}
                  onDismiss={() => {
                    triggerUiFeedback('menu');
                    void handleDismissCalibration();
                  }}
                />

                <AppToast message={toastMessage} visible={toastVisible} />
              </>
            ) : null}
          </View>
        </UiI18nProvider>
      </AppThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#09090B',
  },
  rootLight: {
    backgroundColor: '#F2F2F7',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#09090B',
  },
  loadingText: {
    marginTop: 16,
    color: 'rgba(255,255,255,0.72)',
    fontSize: 15,
  },
});
