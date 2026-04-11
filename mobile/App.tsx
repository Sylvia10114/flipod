import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Audio } from 'expo-av';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { buildClipKey, findClipIndexByKey, resolveDataUrl, toBookmark } from './src/clip-utils';
import { AppToast } from './src/components/AppToast';
import { PracticeSessionModal } from './src/components/PracticeSessionModal';
import { type MenuScreen, SlideMenu } from './src/components/SlideMenu';
import { demoClips } from './src/demo-clips';
import { FeedScreen } from './src/screens/FeedScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { PracticeScreen } from './src/screens/PracticeScreen';
import { VocabScreen } from './src/screens/VocabScreen';
import { api } from './src/services/api';
import {
  DEFAULT_SETTINGS,
  getOrCreateDeviceId,
  loadBookmarks,
  loadLikeEvents,
  loadLikedClips,
  loadKnownWords,
  loadPracticeData,
  loadProfile,
  loadSettings,
  loadVocab,
  type LikeEvent,
  saveBookmarks,
  saveLikeEvents,
  saveLikedClips,
  saveKnownWords,
  savePracticeData,
  saveProfile,
  saveSettings,
  saveVocab,
} from './src/storage';
import type { AppSettings, Bookmark, Clip, PracticeMap, Profile, VocabEntry } from './src/types';

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

function mergeBookmarks(local: Bookmark[], remote: Bookmark[]) {
  const byKey = new Map<string, Bookmark>();
  [...remote, ...local].forEach(item => {
    if (!item?.clipKey) return;
    byKey.set(item.clipKey, { ...byKey.get(item.clipKey), ...item });
  });
  return Array.from(byKey.values());
}

function mergeVocab(local: VocabEntry[], remote: VocabEntry[]) {
  const byWord = new Map<string, VocabEntry>();
  [...remote, ...local].forEach(item => {
    const key = item?.word?.toLowerCase();
    if (!key) return;
    byWord.set(key, { ...byWord.get(key), ...item, word: key });
  });
  return Array.from(byWord.values());
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

export default function App() {
  const [booting, setBooting] = useState(true);
  const [deviceId, setDeviceId] = useState('');
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
  const [practiceClipKey, setPracticeClipKey] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const playedKeysRef = useRef<Set<string>>(new Set());
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRerankAtRef = useRef(0);

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
        setPracticeData(localPractice);
        setKnownWords(localKnownWords);
        setBookmarks(localBookmarks);
        setVocabList(localVocab);
        setLikedClipKeys(localLikedClips);
        setLikeEvents(localLikeEvents);

        try {
          const session = await api.createSession(nextDeviceId);
          const remoteProfile = session.profile;
          const mergedProfile = remoteProfile?.onboardingDone ? remoteProfile : (localProfile || defaultProfile);
          const [remoteBookmarks, remoteVocab] = await Promise.all([
            api.listBookmarks(nextDeviceId),
            api.listVocab(nextDeviceId),
          ]);

          const mergedBookmarks = mergeBookmarks(localBookmarks, remoteBookmarks.bookmarks || []);
          const mergedVocab = mergeVocab(localVocab, remoteVocab.vocab || []);

          if (!cancelled) {
            setProfile(mergedProfile);
            setBookmarks(mergedBookmarks);
            setVocabList(mergedVocab);
          }
          await saveProfile(mergedProfile);
          await saveBookmarks(mergedBookmarks);
          await saveVocab(mergedVocab);
        } catch {
          if (!cancelled) {
            setProfile(localProfile || defaultProfile);
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
  }, []);

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

  const handleProfileSubmit = async (nextProfile: Profile) => {
    setProfile(nextProfile);
    await saveProfile(nextProfile);

    if (deviceId) {
      try {
        await api.saveProfile(deviceId, nextProfile);
        await api.trackEvent(deviceId, 'onboarding_completed', {
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

    if (deviceId) {
      try {
        await api.saveProfile(deviceId, nextProfile);
      } catch {
      }
    }
  };

  const handleResetProfile = async () => {
    setProfile(defaultProfile);
    setActiveScreen('feed');
    setMenuOpen(false);
    setPracticeClipKey(null);
    await saveProfile(defaultProfile);
    if (deviceId) {
      try {
        await api.saveProfile(deviceId, defaultProfile);
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
      if (deviceId) {
        try {
          await api.removeBookmark(deviceId, nextBookmark.clipKey);
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

    if (deviceId) {
      try {
        await api.saveBookmark(deviceId, nextBookmark);
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

    if (deviceId) {
      try {
        await api.saveVocab(deviceId, normalizedEntry);
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
  };

  const handleRemoveBookmark = async (clipKey: string) => {
    const nextBookmarks = bookmarks.filter(item => item.clipKey !== clipKey);
    setBookmarks(nextBookmarks);
    await saveBookmarks(nextBookmarks);

    if (deviceId) {
      try {
        await api.removeBookmark(deviceId, clipKey);
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

  let content: React.ReactNode;

  if (booting) {
    content = (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#8B9CF7" />
        <Text style={styles.loadingText}>正在初始化 Flipod RN...</Text>
      </View>
    );
  } else if (!profile.onboardingDone) {
    content = <OnboardingScreen initialProfile={profile} onSubmit={handleProfileSubmit} />;
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

        {profile.onboardingDone && !booting ? (
          <>
            <SlideMenu
              visible={menuOpen}
              profile={profile}
              dominantHand={settings.dominantHand}
              activeScreen={activeScreen}
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
              onResetOnboarding={() => {
                setMenuOpen(false);
                void handleResetProfile();
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
