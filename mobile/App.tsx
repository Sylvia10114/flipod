import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { toBookmark } from './src/clip-utils';
import { demoClips } from './src/demo-clips';
import { FeedScreen } from './src/screens/FeedScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { API_BASE_URL, api } from './src/services/api';
import { getOrCreateDeviceId, loadProfile, saveProfile } from './src/storage';
import type { Bookmark, Clip, Profile, VocabEntry } from './src/types';

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

    return ranked.length > 0 ? ranked : fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [deviceId, setDeviceId] = useState<string>('');
  const [profile, setProfile] = useState<Profile>(defaultProfile);
  const [clipsData, setClipsData] = useState<Clip[]>(demoClips);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [vocabList, setVocabList] = useState<VocabEntry[]>([]);
  const [knownWords, setKnownWords] = useState<string[]>([]);
  const [clipsPlayed, setClipsPlayed] = useState(0);
  const [activeTab, setActiveTab] = useState<'feed' | 'library'>('feed');
  const [rankedClips, setRankedClips] = useState<Clip[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const nextDeviceId = await getOrCreateDeviceId();
        const localProfile = (await loadProfile()) || defaultProfile;

        if (cancelled) return;
        setDeviceId(nextDeviceId);

        try {
          const session = await api.createSession(nextDeviceId);
          const remoteProfile = session.profile;
          const mergedProfile = remoteProfile?.onboardingDone ? remoteProfile : localProfile;
          const remoteBookmarks = await api.listBookmarks(nextDeviceId);
          if (!cancelled) {
            setProfile(mergedProfile);
            setBookmarks(remoteBookmarks.bookmarks || []);
          }
          await saveProfile(mergedProfile);
        } catch {
          if (!cancelled) {
            setProfile(localProfile);
          }
        }
      } finally {
        if (!cancelled) {
          setBooting(false);
        }
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadClips() {
      try {
        const response = await fetch(`${API_BASE_URL}/data.json`);
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

    loadClips();
    return () => {
      cancelled = true;
    };
  }, []);

  const clips = useMemo(() => {
    return rankClips(clipsData, profile.interests);
  }, [clipsData, profile.interests]);

  const bookmarkedKeys = useMemo(() => bookmarks.map(item => item.clipKey), [bookmarks]);
  const vocabWords = useMemo(() => vocabList.map(item => item.word), [vocabList]);

  useEffect(() => {
    let cancelled = false;

    async function refreshRank() {
      const next = await maybeRankWithApi(clipsData, profile);
      if (!cancelled) {
        setRankedClips(next);
      }
    }

    refreshRank();
    return () => {
      cancelled = true;
    };
  }, [clipsData, profile]);

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

  const handleResetProfile = async () => {
    setProfile(defaultProfile);
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
      setBookmarks(prev => prev.filter(item => item.clipKey !== nextBookmark.clipKey));
      if (deviceId) {
        try {
          await api.removeBookmark(deviceId, nextBookmark.clipKey);
        } catch {
          setBookmarks(prev => {
            if (prev.some(item => item.clipKey === nextBookmark.clipKey)) return prev;
            return [nextBookmark, ...prev];
          });
        }
      }
      return;
    }

    setBookmarks(prev => [nextBookmark, ...prev.filter(item => item.clipKey !== nextBookmark.clipKey)]);
    if (deviceId) {
      try {
        await api.saveBookmark(deviceId, nextBookmark);
      } catch {
        setBookmarks(prev => prev.filter(item => item.clipKey !== nextBookmark.clipKey));
      }
    }
  };

  const handleSaveVocab = async (entry: VocabEntry) => {
    setVocabList(prev => {
      if (prev.some(item => item.word === entry.word)) return prev;
      return [entry, ...prev];
    });
    if (deviceId) {
      try {
        await api.saveVocab(deviceId, entry);
      } catch {
      }
    }
  };

  const handleMarkKnown = (word: string) => {
    setKnownWords(prev => {
      if (prev.includes(word)) return prev;
      return [...prev, word];
    });
  };

  const handleAdjustInterests = async (_interests: string[]) => {
    const reset = { ...profile, onboardingDone: false };
    setProfile(reset);
    await saveProfile(reset);
  };

  const handleRemoveBookmark = async (clipKey: string) => {
    const target = bookmarks.find(item => item.clipKey === clipKey);
    setBookmarks(prev => prev.filter(item => item.clipKey !== clipKey));

    if (deviceId) {
      try {
        await api.removeBookmark(deviceId, clipKey);
      } catch {
        if (target) {
          setBookmarks(prev => [target, ...prev]);
        }
      }
    }
  };

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        {booting ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#8B9CF7" />
            <Text style={styles.loadingText}>正在初始化 Flipod RN...</Text>
          </View>
        ) : profile.onboardingDone ? (
          activeTab === 'feed' ? (
            <FeedScreen
              clips={rankedClips.length > 0 ? rankedClips : clips}
              profile={profile}
              bookmarkedKeys={bookmarkedKeys}
              vocabWords={vocabWords}
              knownWords={knownWords}
              clipsPlayed={clipsPlayed}
              onToggleBookmark={handleToggleBookmark}
              onSaveVocab={handleSaveVocab}
              onMarkKnown={handleMarkKnown}
              onResetProfile={handleResetProfile}
              onAdjustInterests={handleAdjustInterests}
            />
          ) : (
            <LibraryScreen
              bookmarks={bookmarks}
              onRemove={handleRemoveBookmark}
              onBack={() => setActiveTab('feed')}
            />
          )
        ) : (
          <OnboardingScreen initialProfile={profile} onSubmit={handleProfileSubmit} />
        )}
        {profile.onboardingDone && !booting ? (
          <View style={styles.tabBar}>
            <Text onPress={() => setActiveTab('feed')} style={[styles.tabItem, activeTab === 'feed' && styles.tabItemActive]}>Feed</Text>
            <Text onPress={() => setActiveTab('library')} style={[styles.tabItem, activeTab === 'library' && styles.tabItemActive]}>Saved</Text>
          </View>
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
  tabBar: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 28,
    borderRadius: 999,
    padding: 6,
    backgroundColor: 'rgba(12,12,18,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    flexDirection: 'row',
  },
  tabItem: {
    flex: 1,
    paddingVertical: 12,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.52)',
    fontWeight: '600',
  },
  tabItemActive: {
    color: '#09090B',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    overflow: 'hidden',
  },
});
