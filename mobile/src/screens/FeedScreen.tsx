import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type ViewToken,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  buildClipKey,
  getSentenceRange,
  getSourceLabel,
  getWordTimestamp,
} from '../clip-utils';
import {
  GlassCard,
  PillButton,
  PlayerLayout,
  ScreenSurface,
} from '../components/AppChrome';
import { ProgressCard, ReviewCard } from '../components/FeedCards';
import { PlayerControls } from '../components/PlayerControls';
import { ProgressBar } from '../components/ProgressBar';
import { WordLine } from '../components/WordLine';
import { WordPopup } from '../components/WordPopup';
import { colors, layout, radii, spacing, typography } from '../design';
import { triggerUiFeedback } from '../feedback';
import { useFeedPlayer } from '../hooks/useFeedPlayer';
import type {
  Clip,
  ClipLine,
  ClipLineWord,
  DominantHand,
  Profile,
  ReviewState,
  VocabEntry,
} from '../types';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const ONE_DAY = 24 * 60 * 60 * 1000;

type Props = {
  clips: Clip[];
  visibleClipCount: number;
  hasMoreClips: boolean;
  profile: Profile;
  dominantHand: DominantHand;
  playbackRate: number;
  feedState: 'loading' | 'normal' | 'rerank' | 'fallback';
  bookmarkedKeys: string[];
  likedKeys: string[];
  recoTag: string | null;
  minutesListened: number;
  reviewState: ReviewState;
  vocabEntries: VocabEntry[];
  vocabWords: string[];
  knownWords: string[];
  clipsPlayed: number;
  onToggleLike: (clip: Clip, index: number) => void;
  onToggleBookmark: (clip: Clip, index: number) => void;
  onSaveVocab: (entry: VocabEntry) => void;
  onMarkKnown: (word: string) => void;
  onRecordWordLookup: (cefr?: string, details?: { clip?: Clip | null; word?: string }) => void;
  onReviewAction: (word: string, action: 'remember' | 'forgot') => void;
  onOpenMenu: () => void;
  onPromoteInterest: (tag: string) => void;
  onLoadMoreClips: () => void;
  onPlaybackRateChange: (rate: number) => void;
  onClipStarted: (clip: Clip, index: number) => void;
  onClipCompleted: (clip: Clip, index: number, progressRatio: number) => void;
  onClipSkipped: (clip: Clip, index: number, progressRatio: number, dwellMs: number) => void;
};

type PopupState = {
  word: ClipLineWord;
  contextEn: string;
  contextZh: string;
  clipKey: string;
  clipTitle: string;
} | null;

type FeedClipPage = {
  type: 'clip';
  key: string;
  clip: Clip;
  clipIndex: number;
};

type FeedReviewPage = {
  type: 'review';
  key: string;
  entry: VocabEntry;
};

type FeedProgressPage = {
  type: 'progress';
  key: string;
};

type FeedPage = FeedClipPage | FeedReviewPage | FeedProgressPage;

export function FeedScreen({
  clips,
  visibleClipCount,
  hasMoreClips,
  profile,
  dominantHand,
  playbackRate,
  feedState,
  bookmarkedKeys,
  likedKeys,
  recoTag,
  minutesListened,
  reviewState,
  vocabEntries,
  vocabWords,
  knownWords,
  clipsPlayed,
  onToggleLike,
  onToggleBookmark,
  onSaveVocab,
  onMarkKnown,
  onRecordWordLookup,
  onReviewAction,
  onOpenMenu,
  onPromoteInterest,
  onLoadMoreClips,
  onPlaybackRateChange,
  onClipStarted,
  onClipCompleted,
  onClipSkipped,
}: Props) {
  const insets = useSafeAreaInsets();
  const data = useMemo(() => clips.slice(0, visibleClipCount), [clips, visibleClipCount]);
  const pageHeight = Math.max(480, SCREEN_HEIGHT - insets.top - insets.bottom);
  const [showZh, setShowZh] = useState(false);
  const [masked, setMasked] = useState(false);
  const [popup, setPopup] = useState<PopupState>(null);
  const [dismissedCards, setDismissedCards] = useState<Set<string>>(new Set());
  const [transcriptIndex, setTranscriptIndex] = useState<number | null>(null);
  const startedRef = useRef<Set<string>>(new Set());
  const completedRef = useRef<Set<string>>(new Set());
  const loadTriggerRef = useRef(0);
  const sessionRef = useRef<{
    clip: Clip;
    clipIndex: number;
    clipKey: string;
    startedAt: number;
    lastProgress: number;
  } | null>(null);

  const {
    activeIndex,
    activeLineIndex,
    durationMillis,
    errorMessage,
    isLoading,
    isPlaying,
    pause,
    playbackRate: currentPlaybackRate,
    positionMillis,
    playIndex,
    seekNextSentence,
    seekPrevSentence,
    seekToRatio,
    setRate,
    togglePlay,
  } = useFeedPlayer(clips, playbackRate);

  const dismissCard = useCallback((key: string) => {
    setDismissedCards(prev => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const reviewEntries = useMemo(() => {
    const now = Date.now();
    return vocabEntries
      .filter(entry => {
        const timestamp = getWordTimestamp(entry);
        if (!timestamp || now - timestamp < ONE_DAY) return false;
        const normalized = entry.word.toLowerCase();
        const existing = reviewState[normalized];
        return !existing || existing.nextReview <= now;
      })
      .filter(entry => !dismissedCards.has(`review:${entry.word.toLowerCase()}`))
      .sort((a, b) => getWordTimestamp(a) - getWordTimestamp(b))
      .slice(0, 2);
  }, [dismissedCards, reviewState, vocabEntries]);

  const showProgressCard = clipsPlayed > 0 && !dismissedCards.has('progress');
  const feedPages = useMemo<FeedPage[]>(() => {
    const pages: FeedPage[] = [];
    let reviewIndex = 0;

    data.forEach((clip, clipIndex) => {
      pages.push({
        type: 'clip',
        key: buildClipKey(clip, clipIndex),
        clip,
        clipIndex,
      });

      if (clipIndex === 1 && showProgressCard) {
        pages.push({ type: 'progress', key: 'progress' });
      }

      const clipCounter = clipIndex + 1;
      if (clipCounter > 0 && clipCounter % 4 === 0 && reviewIndex < reviewEntries.length) {
        const entry = reviewEntries[reviewIndex++];
        pages.push({
          type: 'review',
          key: `review:${entry.word.toLowerCase()}`,
          entry,
        });
      }
    });

    return pages;
  }, [data, reviewEntries, showProgressCard]);

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 75 });
  const transcriptClip = typeof transcriptIndex === 'number' ? clips[transcriptIndex] : null;
  const currentClip = clips[activeIndex];
  const currentTime = positionMillis / 1000;
  const progress = durationMillis > 0 ? positionMillis / durationMillis : 0;
  const currentSentenceRange = currentClip ? getSentenceRange(currentClip, activeLineIndex) : null;
  const cefrSegments = useMemo(() => {
    const buckets = { a12: 0, b1: 0, b2plus: 0 };
    vocabEntries.forEach(entry => {
      const cefr = (entry.cefr || '').toUpperCase();
      if (cefr === 'B1') {
        buckets.b1 += 1;
      } else if (cefr === 'B2' || cefr === 'C1' || cefr === 'C2') {
        buckets.b2plus += 1;
      } else {
        buckets.a12 += 1;
      }
    });
    return [
      { label: 'A1/A2', value: buckets.a12, color: '#7AAFC4', labelColor: colors.textPrimary },
      { label: 'B1', value: buckets.b1, color: '#C4A96E', labelColor: '#7AAFC4' },
      { label: 'B2+', value: buckets.b2plus, color: '#C47A6E', labelColor: '#C4A96E' },
    ];
  }, [vocabEntries]);

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const firstVisible = viewableItems.find(viewable => viewable.isViewable && typeof viewable.index === 'number');
    if (!firstVisible || typeof firstVisible.index !== 'number') return;

    const page = feedPages[firstVisible.index];
    if (!page) return;

    if (page.type === 'clip') {
      const loadThreshold = Math.max(0, data.length - 3);
      if (hasMoreClips && page.clipIndex >= loadThreshold && loadTriggerRef.current < data.length) {
        loadTriggerRef.current = data.length;
        onLoadMoreClips();
      }
      void playIndex(page.clipIndex);
      return;
    }

    void pause();
  }, [data.length, feedPages, hasMoreClips, onLoadMoreClips, pause, playIndex]);

  const finalizeSession = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;

    const dwellMs = Date.now() - session.startedAt;
    if (session.lastProgress < 0.3 && dwellMs >= 3000) {
      onClipSkipped(session.clip, session.clipIndex, session.lastProgress, dwellMs);
    }

    sessionRef.current = null;
  }, [onClipSkipped]);

  React.useEffect(() => {
    if (loadTriggerRef.current > data.length || visibleClipCount <= 10) {
      loadTriggerRef.current = 0;
    }
  }, [data.length, visibleClipCount]);

  React.useEffect(() => {
    if (!isPlaying) return;

    const clip = clips[activeIndex];
    if (!clip) return;

    const clipKey = buildClipKey(clip, activeIndex);
    if (sessionRef.current?.clipKey !== clipKey) {
      finalizeSession();
      sessionRef.current = {
        clip,
        clipIndex: activeIndex,
        clipKey,
        startedAt: Date.now(),
        lastProgress: progress,
      };
    } else {
      sessionRef.current.lastProgress = progress;
    }

    if (!startedRef.current.has(clipKey)) {
      startedRef.current.add(clipKey);
      onClipStarted(clip, activeIndex);
    }
  }, [activeIndex, clips, finalizeSession, isPlaying, onClipStarted, progress]);

  React.useEffect(() => {
    if (!isPlaying) return;
    const clip = clips[activeIndex];
    if (!clip || progress < 0.8) return;

    const clipKey = buildClipKey(clip, activeIndex);
    if (completedRef.current.has(clipKey)) return;
    completedRef.current.add(clipKey);
    onClipCompleted(clip, activeIndex, progress);
  }, [activeIndex, clips, isPlaying, onClipCompleted, progress]);

  React.useEffect(() => {
    return () => {
      finalizeSession();
    };
  }, [finalizeSession]);

  return (
    <ScreenSurface>
      <FlatList
        data={feedPages}
        keyExtractor={item => item.key}
        pagingEnabled
        snapToInterval={pageHeight}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig.current}
        renderItem={({ item }: ListRenderItemInfo<FeedPage>) => {
          if (item.type === 'review') {
            return (
              <View style={[styles.cardPage, { minHeight: pageHeight, paddingBottom: 18 + insets.bottom }]}>
                <ReviewCard
                  entry={item.entry}
                  onForgot={() => {
                    onReviewAction(item.entry.word, 'forgot');
                    dismissCard(`review:${item.entry.word.toLowerCase()}`);
                  }}
                  onRemember={() => {
                    onReviewAction(item.entry.word, 'remember');
                    dismissCard(`review:${item.entry.word.toLowerCase()}`);
                  }}
                />
              </View>
            );
          }

          if (item.type === 'progress') {
            return (
              <View style={[styles.cardPage, { minHeight: pageHeight, paddingBottom: 18 + insets.bottom }]}>
                <ProgressCard
                  clipsPlayed={clipsPlayed}
                  minutesListened={minutesListened}
                  newWordsCount={vocabEntries.length}
                  cefrSegments={cefrSegments}
                  onDismiss={() => dismissCard('progress')}
                />
              </View>
            );
          }

          const clip = item.clip;
          const index = item.clipIndex;
          const isActive = index === activeIndex;
          const line = isActive ? clip.lines?.[activeLineIndex] : clip.lines?.[0];
          const clipKey = item.key;
          const liked = likedKeys.includes(clipKey);
          const saved = bookmarkedKeys.includes(clipKey);

          return (
            <View style={[styles.page, { minHeight: pageHeight, paddingBottom: 18 + insets.bottom }]}>
              <PlayerLayout
                header={
                  <View style={styles.headerBlock}>
                    <View style={styles.headerActions}>
                      <Pressable onPress={() => {
                        triggerUiFeedback('menu');
                        onOpenMenu();
                      }} style={styles.iconButton}>
                        <Feather name="menu" size={18} color={colors.textSecondary} />
                      </Pressable>
                      <View style={styles.iconButtonPlaceholder} />
                    </View>
                    <View style={styles.headerCopy}>
                      <Text style={styles.clipTitle}>{clip.title}</Text>
                      <Pressable
                        onPress={() => {
                          triggerUiFeedback('menu');
                          setTranscriptIndex(index);
                        }}
                      >
                        <Text style={styles.clipSource}>{getSourceLabel(clip.source)}{clip.tag ? ` · ${clip.tag}` : ''}</Text>
                      </Pressable>
                      {clip._aiReason ? <Text style={styles.clipReason}>{clip._aiReason}</Text> : null}
                      {clip.tag ? (
                        <Pressable
                          onPress={() => {
                            triggerUiFeedback('card');
                            onPromoteInterest(clip.tag || '');
                          }}
                          style={styles.topicBoostPill}
                        >
                          <Text style={styles.topicBoostText}>多来点这个主题</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                }
                controls={
                  <View style={styles.controlsWrap}>
                    <ProgressBar
                      progress={isActive ? progress : 0}
                      markers={[]}
                      currentSentenceRange={isActive ? currentSentenceRange : null}
                      onSeek={ratio => {
                        if (!isActive) return;
                        void seekToRatio(ratio);
                      }}
                    />
                    <PlayerControls
                      isPlaying={isActive && isPlaying}
                      isLoading={isActive && isLoading}
                      positionMillis={isActive ? positionMillis : 0}
                      durationMillis={isActive ? durationMillis : 0}
                      playbackRate={currentPlaybackRate}
                      dominantHand={dominantHand}
                      showZh={showZh}
                      masked={masked}
                      onTogglePlay={() => {
                        void togglePlay(index);
                      }}
                      onSeekPrevSentence={() => {
                        if (!isActive) return;
                        void seekPrevSentence();
                      }}
                      onSeekNextSentence={() => {
                        if (!isActive) return;
                        void seekNextSentence();
                      }}
                      onSetRate={rate => {
                        void setRate(rate);
                        onPlaybackRateChange(rate);
                      }}
                      onToggleZh={() => setShowZh(prev => !prev)}
                      onToggleMask={() => setMasked(prev => !prev)}
                      onOpenMenu={onOpenMenu}
                    />
                  </View>
                }
              >
                <View style={styles.contentStage}>
                  <View style={[styles.sideRail, dominantHand === 'left' ? styles.sideRailLeft : styles.sideRailRight]}>
                    <Pressable
                      onPress={() => onToggleLike(clip, index)}
                      style={styles.sideButton}
                    >
                      <Ionicons
                        name={liked ? 'heart' : 'heart-outline'}
                        size={24}
                        color={liked ? colors.textPrimary : colors.textTertiary}
                      />
                    </Pressable>
                    <Pressable onPress={() => onToggleBookmark(clip, index)} style={styles.sideButton}>
                      <Ionicons
                        name={saved ? 'bookmark' : 'bookmark-outline'}
                        size={24}
                        color={saved ? colors.textPrimary : colors.textTertiary}
                      />
                    </Pressable>
                  </View>

                  <View style={styles.lineWrap}>
                    {line ? (
                      <WordLine
                        line={line}
                        currentTime={isActive ? currentTime : 0}
                        isActive={isActive}
                        showZh={showZh}
                        masked={masked}
                        onWordTap={(word: ClipLineWord, lineData: ClipLine) => {
                          onRecordWordLookup(word.cefr, {
                            clip,
                            word: word.word,
                          });
                          triggerUiFeedback('card');
                          setPopup({
                            word,
                            contextEn: lineData.en,
                            contextZh: lineData.zh || '',
                            clipKey,
                            clipTitle: clip.title,
                          });
                        }}
                      />
                    ) : null}
                    {!showZh ? <View style={styles.translationBar} /> : null}
                    {isActive && errorMessage ? <Text style={styles.audioStateError}>{errorMessage}</Text> : null}
                    {isActive && !errorMessage && isLoading ? <Text style={styles.audioStateHint}>音频加载中...</Text> : null}
                  </View>
                </View>
              </PlayerLayout>
            </View>
          );
        }}
      />

      {popup ? (
        <WordPopup
          word={popup.word}
          contextEn={popup.contextEn}
          contextZh={popup.contextZh}
          isSaved={vocabWords.includes(popup.word.word.toLowerCase())}
          isKnown={knownWords.includes(popup.word.word.toLowerCase())}
          onSave={() => {
            onSaveVocab({
              word: popup.word.word.toLowerCase(),
              cefr: popup.word.cefr,
              context: popup.contextEn,
              contextZh: popup.contextZh,
              clipKey: popup.clipKey,
              clipTitle: popup.clipTitle,
              sourceType: 'feed',
              practiced: false,
            });
          }}
          onMarkKnown={() => onMarkKnown(popup.word.word.toLowerCase())}
          onDismiss={() => setPopup(null)}
        />
      ) : null}

      <Modal
        visible={Boolean(transcriptClip)}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setTranscriptIndex(null)}
      >
        <SafeAreaView style={styles.transcriptSafeArea}>
          <View style={styles.transcriptHeader}>
            <View style={styles.transcriptHeaderCopy}>
              <Text style={styles.transcriptTitle}>{transcriptClip?.title}</Text>
              <Text style={styles.transcriptMeta}>
                {transcriptClip ? getSourceLabel(transcriptClip.source) : ''}
              </Text>
            </View>
            <PillButton label="close" onPress={() => setTranscriptIndex(null)} />
          </View>

          <ScrollView contentContainerStyle={styles.transcriptBody}>
            {(transcriptClip?.lines || []).map((entry, idx) => (
              <GlassCard key={`${idx}-${entry.start}`} style={styles.transcriptLine}>
                <Text style={styles.transcriptEn}>{entry.en}</Text>
                <Text style={styles.transcriptZh}>{entry.zh}</Text>
              </GlassCard>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </ScreenSurface>
  );
}

const styles = StyleSheet.create({
  page: {
    justifyContent: 'space-between',
  },
  cardPage: {
    justifyContent: 'center',
    paddingHorizontal: spacing.page,
  },
  headerBlock: {
    width: layout.playerContentWidth,
    gap: spacing.sm,
  },
  headerActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  iconButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonPlaceholder: {
    width: 28,
    height: 28,
  },
  headerCopy: {
    alignItems: 'center',
    gap: 6,
  },
  clipTitle: {
    color: colors.textPrimary,
    fontSize: typography.title,
    fontWeight: '700',
    textAlign: 'center',
  },
  clipSource: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    textAlign: 'center',
  },
  clipReason: {
    color: colors.textSecondary,
    fontSize: typography.micro,
    lineHeight: 18,
    textAlign: 'center',
    maxWidth: 260,
  },
  topicBoostPill: {
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(139,156,247,0.28)',
    backgroundColor: 'rgba(139,156,247,0.12)',
  },
  topicBoostText: {
    color: colors.textPrimary,
    fontSize: typography.micro,
    fontWeight: '600',
  },
  controlsWrap: {
    width: layout.playerContentWidth,
    gap: spacing.sm,
  },
  contentStage: {
    width: layout.playerContentWidth,
    minHeight: 260,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  sideRail: {
    position: 'absolute',
    bottom: -18,
    gap: spacing.sm,
  },
  sideRailLeft: {
    left: 0,
  },
  sideRailRight: {
    right: 0,
  },
  sideButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineWrap: {
    width: 280,
    alignItems: 'center',
    gap: 12,
  },
  translationBar: {
    width: 190,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.bgSurface2,
    marginTop: 6,
  },
  audioStateError: {
    color: '#FCA5A5',
    fontSize: typography.caption,
    textAlign: 'center',
  },
  audioStateHint: {
    color: colors.textTertiary,
    fontSize: typography.caption,
    textAlign: 'center',
  },
  transcriptSafeArea: {
    flex: 1,
    backgroundColor: colors.bgApp,
  },
  transcriptHeader: {
    paddingHorizontal: spacing.page,
    paddingTop: 12,
    paddingBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  transcriptHeaderCopy: {
    flex: 1,
    gap: 4,
  },
  transcriptTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
  },
  transcriptMeta: {
    color: colors.textSecondary,
    fontSize: typography.caption,
  },
  transcriptBody: {
    paddingHorizontal: spacing.page,
    paddingBottom: 32,
    gap: spacing.sm,
  },
  transcriptLine: {
    gap: spacing.sm,
  },
  transcriptEn: {
    color: colors.textPrimary,
    fontSize: typography.bodyLg,
    lineHeight: 22,
  },
  transcriptZh: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    lineHeight: 18,
  },
});
