import * as AppleAuthentication from 'expo-apple-authentication';
import { Audio } from 'expo-av';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  buildClipKey,
  findClipIndexByKey,
  getClipDurationSeconds,
  getLevelWeight,
  getSourceLabel,
  resolveDataUrl,
  toBookmark,
} from './src/clip-utils';
import { AppToast } from './src/components/AppToast';
import { CalibrationToast } from './src/components/CalibrationToast';
import { PracticeSessionModal } from './src/components/PracticeSessionModal';
import { type MenuScreen, SlideMenu } from './src/components/SlideMenu';
import { demoClips } from './src/demo-clips';
import {
  applyRankedFeedOrder,
  buildClipManifest,
  buildLocalStarterFeedFallback,
  collectClipIdsByKeys,
  deriveLikedTopics,
  normalizeClips,
  normalizeTopic,
} from './src/feed-ranking';
import { FeedScreen } from './src/screens/FeedScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { PracticeScreen } from './src/screens/PracticeScreen';
import { VocabScreen } from './src/screens/VocabScreen';
import { api } from './src/services/api';
import { disposeUiFeedback, primeUiFeedback, triggerUiFeedback } from './src/feedback';
import {
  DEFAULT_CALIBRATION_SIGNALS,
  clearAccountState,
  clearAuthToken,
  DEFAULT_SETTINGS,
  getOrCreateDeviceId,
  loadAuthToken,
  loadBookmarks,
  loadCalibrationSignals,
  loadCalibrationState,
  loadLikeEvents,
  loadLikedClips,
  loadListenedClips,
  loadKnownWords,
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
  LinkedIdentity,
  PracticeMap,
  Profile,
  RankMode,
  RankRequest,
  RankedFeedItem,
  ReviewState,
  VocabEntry,
} from './src/types';

const defaultProfile: Profile = {
  level: null,
  interests: [],
  theme: 'dark',
  onboardingDone: false,
};

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
  level: Level
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
      message: `你的表现已经超过 ${level}，要升级到 ${toLevel} 吗？`,
    };
  }

  if (!calibrationState.suggestedDown && levelNum > 1 && avg > 5 && hardRate > 0.6 && c1PlusRatio > 0.5) {
    const toLevel = levelNum === 4 ? 'B2' : levelNum === 3 ? 'B1' : 'A1-A2';
    return {
      direction: 'down',
      fromLevel: level,
      toLevel,
      message: `当前内容似乎有点难，要调整到 ${toLevel} 吗？`,
    };
  }

  return null;
}

function readErrorMessage(error: unknown) {
  if (error instanceof Error) {
    try {
      const parsed = JSON.parse(error.message) as { error?: string };
      return parsed.error || error.message;
    } catch {
      return error.message;
    }
  }
  return '请求失败，请稍后重试';
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

export default function App() {
  const [booting, setBooting] = useState(true);
  const [deviceId, setDeviceId] = useState('');
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [linkedIdentities, setLinkedIdentities] = useState<LinkedIdentity[]>([]);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [showAuthSheet, setShowAuthSheet] = useState(false);
  const [profile, setProfile] = useState<Profile>(defaultProfile);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [practiceData, setPracticeData] = useState<PracticeMap>({});
  const [clipsData, setClipsData] = useState<Clip[]>(demoClips);
  const [clipsLoaded, setClipsLoaded] = useState(false);
  const [feedOrderIds, setFeedOrderIds] = useState<number[]>([]);
  const [feedReasons, setFeedReasons] = useState<Record<number, string>>({});
  const [skippedClipIds, setSkippedClipIds] = useState<number[]>([]);
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
  const playedKeysRef = useRef<Set<string>>(new Set());
  const calibrationStateRef = useRef<CalibrationState>({});
  const lastFeedSignatureRef = useRef<string | null>(null);
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

  const applyAuthSnapshot = useCallback((snapshot: AuthBootstrapResponse) => {
    setProfile({
      level: snapshot.profile.level || null,
      interests: Array.isArray(snapshot.profile.interests) ? snapshot.profile.interests : [],
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
        ] = await Promise.all([
          getOrCreateDeviceId(),
          loadAuthToken(),
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
        setSettings(localSettings);
        setProfile(localProfile || defaultProfile);
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
            await saveAuthBootstrapSnapshot(snapshot);
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
        const response = await fetch(resolveDataUrl());
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json() as { clips?: Clip[] };
        if (cancelled) return;

        if (Array.isArray(data.clips) && data.clips.length > 0) {
          setClipsData(normalizeClips(data.clips));
          setClipsLoaded(true);
          return;
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
  const currentClips = useMemo(() => {
    const rankedClips = applyRankedFeedOrder(clipsData, rankedFeed);
    if (rankedClips.length > 0) {
      return rankedClips;
    }
    return clipsData.slice(0, 10);
  }, [clipsData, rankedFeed]);
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
  const practiceClip = practiceClipIndex >= 0 ? clipsData[practiceClipIndex] : null;
  const isAuthenticated = Boolean(authToken);

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

  const applyFeedItems = useCallback((feed: RankedFeedItem[], nextState: 'normal' | 'fallback') => {
    setFeedOrderIds(feed.map(item => item.id));
    setFeedReasons(buildFeedReasonMap(feed));
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
      maxItems: 10,
    };
  }, []);

  const requestRankedFeed = useCallback(async (
    nextProfile: Profile,
    options: { mode?: RankMode; pendingState?: 'loading' | 'rerank'; signature?: string | null } = {}
  ) => {
    const request = buildRankRequestForProfile(nextProfile, options.mode || 'starter');
    const fallbackFeed = buildLocalStarterFeedFallback(rankContextRef.current.manifest, request);

    if (options.pendingState) {
      setFeedState(options.pendingState);
    }

    const applySignature = () => {
      if (options.signature) {
        lastFeedSignatureRef.current = options.signature;
      }
    };

    if (!authToken) {
      applyFeedItems(fallbackFeed, 'fallback');
      applySignature();
      return fallbackFeed;
    }

    try {
      const response = await api.rankFeed(request, authToken);
      const remoteFeed = Array.isArray(response.feed) && response.feed.length > 0 ? response.feed : fallbackFeed;
      applyFeedItems(remoteFeed, response.feed?.length ? 'normal' : 'fallback');
      applySignature();
      return remoteFeed;
    } catch {
      applyFeedItems(fallbackFeed, 'fallback');
      applySignature();
      return fallbackFeed;
    }
  }, [applyFeedItems, authToken, buildRankRequestForProfile]);

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
    const suggestion = buildCalibrationSuggestion(signals, calibrationStateRef.current, normalizeLevel(profile.level));
    if (suggestion) {
      setCalibrationSuggestion(suggestion);
    }
  }, [calibrationSuggestion, practiceClipKey, profile.level]);

  const finishAuthFlow = useCallback(async (payload: AuthInitResponse) => {
    const snapshot = await api.migrateLocal(payload.session.token, localMigrationPayload);
    await Promise.all([
      saveAuthToken(payload.session.token),
      saveAuthBootstrapSnapshot(snapshot),
    ]);
    setAuthToken(payload.session.token);
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
        showToast('手机号已绑定');
        triggerUiFeedback('success');
        return;
      }

      const response = await api.verifySmsCode(phoneNumber, code, deviceId);
      await finishAuthFlow(response);
    } catch (error) {
      const message = readErrorMessage(error);
      setAuthError(message);
      throw new Error(message);
    } finally {
      setAuthBusy(false);
    }
  }, [authToken, deviceId, finishAuthFlow, showAuthSheet, showToast]);

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
        throw new Error('Apple 登录未返回必要凭证');
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
        showToast('Apple 已绑定');
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

      const message = readErrorMessage(error);
      setAuthError(message);
      throw new Error(message);
    } finally {
      setAuthBusy(false);
    }
  }, [authToken, deviceId, finishAuthFlow, showAuthSheet, showToast]);

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

  const handlePromoteInterest = async (tag: string) => {
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
          api.trackEvent(authToken, 'topic_promoted', {
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
      showToast('已收藏 · 可以在侧边菜单「听力练习」里精听这段');
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

  const handleToggleHand = () => {
    const nextSettings: AppSettings = {
      ...settings,
      dominantHand: settings.dominantHand === 'left' ? 'right' : 'left',
    };
    void persistSettings(nextSettings);
  };

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
    showToast(`已调整为 ${calibrationSuggestion.toLevel}`);
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
  }, [authToken, calibrationSuggestion, profile, requestRankedFeed, showToast]);

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
    ]);

    setAuthToken(null);
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
    lastFeedSignatureRef.current = null;
    setActiveScreen('feed');
    setMenuOpen(false);
    setShowAuthSheet(false);
    setPracticeClipKey(null);
    setAuthError('');
  }, [authToken]);

  let content: React.ReactNode;

  if (booting) {
    content = (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#8B9CF7" />
        <Text style={styles.loadingText}>正在初始化 Flipod RN...</Text>
      </View>
    );
  } else if (!isAuthenticated) {
    content = (
      <LoginScreen
        loading={authBusy}
        errorMessage={authError}
        onRequestSms={handleRequestSms}
        onVerifyPhone={handleVerifyPhone}
        onApplePress={handleApplePress}
      />
    );
  } else if (!profile.onboardingDone) {
    content = <OnboardingScreen initialProfile={profile} onSubmit={handleProfileSubmit} />;
  } else if (activeScreen === 'library') {
    content = (
      <LibraryScreen
        bookmarks={bookmarks}
        onRemove={handleRemoveBookmark}
        onBack={() => setActiveScreen('feed')}
      />
    );
  } else if (activeScreen === 'practice') {
    content = (
      <PracticeScreen
        bookmarks={bookmarks}
        clips={clipsData}
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
    content = <VocabScreen vocabList={vocabList} onBack={() => setActiveScreen('feed')} />;
  } else {
    content = (
      <FeedScreen
        clips={currentClips}
        profile={profile}
        dominantHand={settings.dominantHand}
        playbackRate={settings.playbackRate}
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
        onPromoteInterest={handlePromoteInterest}
        onPlaybackRateChange={handlePlaybackRateChange}
        onClipStarted={handleClipStarted}
        onClipCompleted={handleClipCompleted}
        onClipSkipped={handleClipSkipped}
      />
    );
  }

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        {content}

        {isAuthenticated && !booting ? (
          <>
            <SlideMenu
              visible={menuOpen}
              profile={profile}
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
              onLinkPhone={() => {
                setMenuOpen(false);
                setAuthError('');
                setShowAuthSheet(true);
              }}
              onLinkApple={() => {
                setMenuOpen(false);
                setAuthError('');
                setShowAuthSheet(true);
              }}
              onLogout={() => {
                setMenuOpen(false);
                void handleLogout();
              }}
              onResetOnboarding={() => {
                setMenuOpen(false);
                void handleResetProfile();
              }}
            />

            <LoginScreen
              visible={showAuthSheet}
              mode="link"
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
              acceptLabel={calibrationSuggestion?.direction === 'up' ? '升级' : '调整'}
              dismissLabel={calibrationSuggestion?.direction === 'up' ? '暂不' : '保持'}
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
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#09090B',
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
