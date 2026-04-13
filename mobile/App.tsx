import * as AppleAuthentication from 'expo-apple-authentication';
import { Audio } from 'expo-av';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { buildClipKey, findClipIndexByKey, resolveDataUrl, toBookmark } from './src/clip-utils';
import { AppToast } from './src/components/AppToast';
import { PracticeSessionModal } from './src/components/PracticeSessionModal';
import { type MenuScreen, SlideMenu } from './src/components/SlideMenu';
import { demoClips } from './src/demo-clips';
import { FeedScreen } from './src/screens/FeedScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { PracticeScreen } from './src/screens/PracticeScreen';
import { StartScreen } from './src/screens/StartScreen';
import { VocabScreen } from './src/screens/VocabScreen';
import { api } from './src/services/api';
import {
  clearAccountState,
  clearAuthToken,
  DEFAULT_SETTINGS,
  getOrCreateDeviceId,
  loadAuthToken,
  loadBookmarks,
  loadLikeEvents,
  loadLikedClips,
  loadKnownWords,
  loadPracticeData,
  loadProfile,
  loadSettings,
  loadVocab,
  saveAuthBootstrapSnapshot,
  saveAuthToken,
  saveBookmarks,
  saveLikeEvents,
  saveLikedClips,
  saveKnownWords,
  savePracticeData,
  saveProfile,
  saveSettings,
  saveVocab,
} from './src/storage';
import type {
  AppSettings,
  AuthBootstrapResponse,
  AuthInitResponse,
  Bookmark,
  Clip,
  LikeEvent,
  LinkedIdentity,
  PracticeMap,
  Profile,
  VocabEntry,
} from './src/types';

const defaultProfile: Profile = {
  level: null,
  interests: [],
  theme: 'dark',
  onboardingDone: false,
};

function rankClips(clips: Clip[], interests: string[]) {
  if (interests.length === 0) return clips;
  const normalized = interests.map(item => item.toLowerCase());
  const matched = clips.filter(clip => normalized.includes((clip.tag || '').toLowerCase()));
  const others = clips.filter(clip => !normalized.includes((clip.tag || '').toLowerCase()));
  return [...matched, ...others];
}

async function maybeRankWithApi(clips: Clip[], profile: Profile) {
  const fallback = rankClips(clips, profile.interests);

  try {
    const response = await api.rankFeed({
      level: profile.level || 'B1',
      interests: profile.interests,
      listened: [],
      skipped: [],
      vocab_clicked: [],
      session_duration: 0,
    });

    const byId = new Map<number, string>();
    for (const item of response.feed || []) {
      byId.set(item.id, item.reason);
    }

    const ranked: Clip[] = [];
    const used = new Set<number>();

    for (const item of response.feed || []) {
      const clip = clips[item.id];
      if (!clip) continue;
      ranked.push({ ...clip, _aiReason: item.reason });
      used.add(item.id);
    }

    clips.forEach((clip, index) => {
      if (used.has(index)) return;
      ranked.push({ ...clip, _aiReason: byId.get(index) || clip._aiReason });
    });

    return {
      clips: ranked.length > 0 ? ranked : fallback,
      source: 'remote' as const,
    };
  } catch {
    return {
      clips: fallback,
      source: 'fallback' as const,
    };
  }
}

function deriveRecoTag(events: LikeEvent[]) {
  if (events.length < 5) return null;
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

  return bestTag && bestCount / recent.length > 0.6 ? bestTag : null;
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
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [vocabList, setVocabList] = useState<VocabEntry[]>([]);
  const [likedClipKeys, setLikedClipKeys] = useState<string[]>([]);
  const [likeEvents, setLikeEvents] = useState<LikeEvent[]>([]);
  const [knownWords, setKnownWords] = useState<string[]>([]);
  const [clipsPlayed, setClipsPlayed] = useState(0);
  const [activeScreen, setActiveScreen] = useState<MenuScreen>('feed');
  const [menuOpen, setMenuOpen] = useState(false);
  const [rankedClips, setRankedClips] = useState<Clip[]>([]);
  const [feedState, setFeedState] = useState<'loading' | 'normal' | 'rerank' | 'fallback'>('loading');
  const [showStartScreen, setShowStartScreen] = useState(false);
  const [showStartTransition, setShowStartTransition] = useState(false);
  const [practiceClipKey, setPracticeClipKey] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const playedKeysRef = useRef<Set<string>>(new Set());
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRerankAtRef = useRef(0);
  const startTransitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    setShowStartTransition(false);
    setShowStartScreen(Boolean(snapshot.profile.onboardingDone));
    setPracticeClipKey(null);
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
      if (startTransitionTimeoutRef.current) {
        clearTimeout(startTransitionTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    void Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
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
        ]);

        if (cancelled) return;
        setDeviceId(nextDeviceId);
        setSettings(localSettings);
        setProfile(localProfile || defaultProfile);
        setPracticeData(localPractice);
        setKnownWords(localKnownWords);
        setBookmarks(localBookmarks);
        setVocabList(localVocab);
        setLikedClipKeys(localLikedClips);
        setLikeEvents(localLikeEvents);

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
              setShowStartScreen(false);
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
        if (!cancelled && Array.isArray(data.clips) && data.clips.length > 0) {
          setClipsData(data.clips);
        }
      } catch {
        if (!cancelled) {
          setClipsData(demoClips);
        }
      }
    }

    void loadClips();
    return () => {
      cancelled = true;
    };
  }, []);

  const clips = useMemo(() => rankClips(clipsData, profile.interests), [clipsData, profile.interests]);
  const currentClips = rankedClips.length > 0 ? rankedClips : clips;
  const bookmarkedKeys = useMemo(() => bookmarks.map(item => item.clipKey), [bookmarks]);
  const likedKeys = useMemo(() => new Set(likedClipKeys), [likedClipKeys]);
  const vocabWords = useMemo(() => vocabList.map(item => item.word), [vocabList]);
  const recoTag = useMemo(() => deriveRecoTag(likeEvents), [likeEvents]);
  const practiceCount = useMemo(() => {
    return bookmarks.filter(item => !practiceData[item.clipKey]?.done).length || bookmarks.length;
  }, [bookmarks, practiceData]);
  const practiceClipIndex = practiceClipKey ? findClipIndexByKey(currentClips, practiceClipKey) : -1;
  const practiceClip = practiceClipIndex >= 0 ? currentClips[practiceClipIndex] : null;
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
    let cancelled = false;

    async function refreshRank() {
      setFeedState('loading');
      const next = await maybeRankWithApi(clipsData, profile);
      if (!cancelled) {
        setRankedClips(next.clips);
        setFeedState(next.source === 'remote' ? 'normal' : 'fallback');
        lastRerankAtRef.current = 0;
      }
    }

    void refreshRank();
    return () => {
      cancelled = true;
    };
  }, [clipsData, profile]);

  useEffect(() => {
    if (clipsPlayed === 0 || clipsPlayed - lastRerankAtRef.current < 5) return;
    let cancelled = false;

    async function rerankFeed() {
      const next = await maybeRankWithApi(clipsData, profile);
      if (cancelled) return;
      setRankedClips(next.clips);
      setFeedState(next.source === 'remote' ? 'rerank' : 'fallback');
      lastRerankAtRef.current = clipsPlayed;

      if (next.source === 'remote') {
        setTimeout(() => {
          setFeedState(prev => (prev === 'rerank' ? 'normal' : prev));
        }, 3000);
      }
    }

    void rerankFeed();
    return () => {
      cancelled = true;
    };
  }, [clipsData, clipsPlayed, profile]);

  const persistSettings = useCallback(async (nextSettings: AppSettings) => {
    setSettings(nextSettings);
    await saveSettings(nextSettings);
  }, []);

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
    setActiveScreen('feed');
    setMenuOpen(false);
    setShowStartTransition(true);
    setShowStartScreen(false);
    await saveProfile(nextProfile);

    if (startTransitionTimeoutRef.current) {
      clearTimeout(startTransitionTimeoutRef.current);
    }
    startTransitionTimeoutRef.current = setTimeout(() => {
      setShowStartTransition(false);
      setShowStartScreen(true);
    }, 1500);

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
  };

  const handlePromoteInterest = async (tag: string) => {
    const normalized = tag.trim();
    if (!normalized) return;

    const nextProfile = {
      ...profile,
      interests: profile.interests.includes(normalized)
        ? profile.interests
        : [...profile.interests, normalized].slice(-3),
    };
    setProfile(nextProfile);
    await saveProfile(nextProfile);

    if (authToken) {
      try {
        await api.saveProfile(authToken, nextProfile);
      } catch {
      }
    }
  };

  const handleResetProfile = async () => {
    setProfile(defaultProfile);
    setActiveScreen('feed');
    setMenuOpen(false);
    setShowStartScreen(false);
    setShowStartTransition(false);
    setPracticeClipKey(null);
    await saveProfile(defaultProfile);
    if (startTransitionTimeoutRef.current) {
      clearTimeout(startTransitionTimeoutRef.current);
      startTransitionTimeoutRef.current = null;
    }
    if (authToken) {
      try {
        await api.saveProfile(authToken, defaultProfile);
      } catch {
      }
    }
  };

  const handleToggleBookmark = async (clip: Clip, index: number) => {
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
    const normalizedEntry = { ...entry, word: entry.word.toLowerCase() };
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
    const clipKey = buildClipKey(clip, index);
    const isLiked = likedKeys.has(clipKey);

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
    const nextLikeEvents = [...likeEvents, { tag: clip.tag || '', timestamp: Date.now() }];
    setLikedClipKeys(nextLikedClips);
    setLikeEvents(nextLikeEvents);
    await Promise.all([
      saveLikedClips(nextLikedClips),
      saveLikeEvents(nextLikeEvents),
    ]);

    if (authToken) {
      try {
        await api.saveLike(authToken, clipKey, clip.tag || '', nextLikeEvents[nextLikeEvents.length - 1].timestamp);
      } catch {
      }
    }
  };

  const handleClipPlayed = (clipKey: string) => {
    if (playedKeysRef.current.has(clipKey)) return;
    playedKeysRef.current.add(clipKey);
    setClipsPlayed(prev => prev + 1);
  };

  const handlePlaybackRateChange = (rate: number) => {
    const nextSettings = { ...settings, playbackRate: rate };
    void persistSettings(nextSettings);
  };

  const handleToggleHand = () => {
    const nextSettings = {
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

  const handlePracticeComplete = (clipKey: string, record: PracticeMap[string]) => {
    setPracticeData(prev => {
      const next = { ...prev, [clipKey]: record };
      void savePracticeData(next);
      return next;
    });

    if (authToken) {
      void api.savePractice(authToken, clipKey, record).catch(() => {});
    }
  };

  const handleStartPractice = (clipIndex: number) => {
    const clip = currentClips[clipIndex];
    if (!clip) return;
    setPracticeClipKey(buildClipKey(clip, clipIndex));
  };

  const handleClosePractice = () => {
    setPracticeClipKey(null);
  };

  const handleReturnFeed = () => {
    setPracticeClipKey(null);
    setActiveScreen('feed');
  };

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
    setLikeEvents([]);
    setKnownWords([]);
    setClipsPlayed(0);
    setActiveScreen('feed');
    setMenuOpen(false);
    setShowAuthSheet(false);
    setShowStartScreen(false);
    setShowStartTransition(false);
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
  } else if (showStartTransition) {
    content = <StartScreen preparing />;
  } else if (activeScreen === 'feed' && showStartScreen) {
    content = (
      <StartScreen
        onBegin={() => {
          setShowStartScreen(false);
          setActiveScreen('feed');
        }}
      />
    );
  } else if (activeScreen === 'library') {
    content = (
      <LibraryScreen
        bookmarks={bookmarks}
        onRemove={handleRemoveBookmark}
        onOpenMenu={() => setMenuOpen(true)}
      />
    );
  } else if (activeScreen === 'practice') {
    content = (
      <PracticeScreen
        bookmarks={bookmarks}
        clips={currentClips}
        practiceData={practiceData}
        showIntro={!settings.practiceIntroSeen}
        onDismissIntro={handleDismissPracticeIntro}
        onOpenMenu={() => setMenuOpen(true)}
        onStartPractice={handleStartPractice}
      />
    );
  } else if (activeScreen === 'vocab') {
    content = <VocabScreen vocabList={vocabList} onOpenMenu={() => setMenuOpen(true)} />;
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
        vocabWords={vocabWords}
        knownWords={knownWords}
        clipsPlayed={clipsPlayed}
        onToggleLike={handleToggleLike}
        onToggleBookmark={handleToggleBookmark}
        onSaveVocab={handleSaveVocab}
        onMarkKnown={handleMarkKnown}
        onOpenMenu={() => setMenuOpen(true)}
        onResetProfile={handleResetProfile}
        onPromoteInterest={handlePromoteInterest}
        onPlaybackRateChange={handlePlaybackRateChange}
        onClipPlayed={handleClipPlayed}
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
              onComplete={handlePracticeComplete}
              onDismiss={handleClosePractice}
              onReturnFeed={handleReturnFeed}
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
