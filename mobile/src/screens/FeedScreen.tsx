import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
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
  getClipSourceExternalUrl,
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
import { radii, spacing, typography } from '../design';
import { triggerUiFeedback } from '../feedback';
import { useFeedPlayer } from '../hooks/useFeedPlayer';
import { useUiI18n } from '../i18n';
import { getLocalizedTopicLabel } from '../i18n/helpers';
import { useResponsiveLayout } from '../responsive';
import { useAppTheme } from '../theme';
import type {
  Clip,
  ClipLine,
  ClipLineWord,
  DominantHand,
  Profile,
  ReviewState,
  SubtitleSize,
  VocabEntry,
} from '../types';

const ONE_DAY = 24 * 60 * 60 * 1000;
const AUTOPLAY_DEBOUNCE_MS = 180;

type Props = {
  clips: Clip[];
  visibleClipCount: number;
  hasMoreClips: boolean;
  profile: Profile;
  dominantHand: DominantHand;
  playbackRate: number;
  subtitleSize: SubtitleSize;
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
  onLoadMoreClips: () => void;
  onPlaybackRateChange: (rate: number) => void;
  onSubtitleSizeChange: () => void;
  onClipStarted: (clip: Clip, index: number) => void;
  onClipCompleted: (clip: Clip, index: number, progressRatio: number) => void;
  onClipSkipped: (clip: Clip, index: number, progressRatio: number, dwellMs: number) => void;
  onVisibleClipChange?: (clip: Clip, index: number) => void;
};

type PopupState = {
  word: ClipLineWord;
  contextEn: string;
  contextZh: string;
  clipKey: string;
  clipTitle: string;
  contentKey?: string;
  lineIndex?: number;
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
  subtitleSize,
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
  onLoadMoreClips,
  onPlaybackRateChange,
  onSubtitleSizeChange,
  onClipStarted,
  onClipCompleted,
  onClipSkipped,
  onVisibleClipChange,
}: Props) {
  const { colors } = useAppTheme();
  const { t } = useUiI18n();
  const metrics = useResponsiveLayout();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const data = useMemo(() => clips.slice(0, visibleClipCount), [clips, visibleClipCount]);
  const pageHeight = Math.max(480, metrics.windowHeight - insets.top - insets.bottom);
  const [showZh, setShowZh] = useState(false);
  const [masked, setMasked] = useState(false);
  const [popup, setPopup] = useState<PopupState>(null);
  const [dismissedCards, setDismissedCards] = useState<Set<string>>(new Set());
  const [transcriptIndex, setTranscriptIndex] = useState<number | null>(null);
  const [visibleClipIndex, setVisibleClipIndex] = useState<number | null>(null);
  const [visibleRequestId, setVisibleRequestId] = useState<number | null>(null);
  const [pendingAutoplayIndex, setPendingAutoplayIndex] = useState<number | null>(null);
  const startedRef = useRef<Set<string>>(new Set());
  const completedRef = useRef<Set<string>>(new Set());
  const loadTriggerRef = useRef(0);
  const autoplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoplayTargetRef = useRef<number | null>(null);
  const visibleRequestIdRef = useRef<number | null>(null);
  const requestCounterRef = useRef(0);
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
    currentRequestId,
    durationMillis,
    errorMessage,
    pendingClipIndex,
    playbackRate: currentPlaybackRate,
    playbackPhase,
    positionMillis,
    playIndex,
    pause,
    requestAutoplay,
    seekNextSentence,
    seekPrevSentence,
    seekToRatio,
    setRate,
    stop,
  } = useFeedPlayer(clips, playbackRate);
  const isCurrentlyPlaying = playbackPhase === 'playing';

  const dismissCard = useCallback((key: string) => {
    setDismissedCards(prev => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const clearAutoplayTimer = useCallback(() => {
    if (!autoplayTimerRef.current) return;
    clearTimeout(autoplayTimerRef.current);
    autoplayTimerRef.current = null;
  }, []);

  const setCurrentVisibleRequestId = useCallback((requestId: number | null) => {
    visibleRequestIdRef.current = requestId;
    setVisibleRequestId(requestId);
  }, []);

  const createRequestId = useCallback(() => {
    requestCounterRef.current += 1;
    return requestCounterRef.current;
  }, []);

  const handleOpenSource = useCallback(async (clip: Clip) => {
    const url = getClipSourceExternalUrl(clip);
    if (!url) return;
    triggerUiFeedback('menu');
    try {
      await Linking.openURL(url);
    } catch {
    }
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
      { label: 'A1/A2', value: buckets.a12, color: colors.cefrB1, labelColor: colors.textPrimary },
      { label: 'B1', value: buckets.b1, color: colors.cefrB2, labelColor: colors.cefrB1 },
      { label: 'B2+', value: buckets.b2plus, color: colors.cefrC1, labelColor: colors.cefrB2 },
    ];
  }, [vocabEntries]);
  const playerWidth = metrics.playerContentWidth;
  const lineWrapWidth = Math.min(
    Math.max(playerWidth - (metrics.isTablet ? 120 : 72), 240),
    metrics.isTablet ? 560 : 320
  );

  const finalizeSession = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;

    const dwellMs = Date.now() - session.startedAt;
    if (session.lastProgress < 0.3 && dwellMs >= 3000) {
      onClipSkipped(session.clip, session.clipIndex, session.lastProgress, dwellMs);
    }

    sessionRef.current = null;
  }, [onClipSkipped]);

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const firstVisible = viewableItems.find(viewable => viewable.isViewable && typeof viewable.index === 'number');
    if (!firstVisible || typeof firstVisible.index !== 'number') return;

    const page = feedPages[firstVisible.index];
    if (!page) return;

    if (page.type === 'clip') {
      setVisibleClipIndex(page.clipIndex);
      onVisibleClipChange?.(page.clip, page.clipIndex);
      const loadThreshold = Math.max(0, data.length - 3);
      if (hasMoreClips && page.clipIndex >= loadThreshold && loadTriggerRef.current < data.length) {
        loadTriggerRef.current = data.length;
        onLoadMoreClips();
      }

      const sameClipAlreadyStable = page.clipIndex === activeIndex
        && (playbackPhase === 'playing' || playbackPhase === 'loading');
      if (sameClipAlreadyStable) {
        autoplayTargetRef.current = page.clipIndex;
        setPendingAutoplayIndex(null);
        clearAutoplayTimer();
        setCurrentVisibleRequestId(currentRequestId);
        return;
      }

      if (autoplayTargetRef.current === page.clipIndex && pendingAutoplayIndex === page.clipIndex) {
        return;
      }

      finalizeSession();
      autoplayTargetRef.current = page.clipIndex;
      const requestId = createRequestId();
      setCurrentVisibleRequestId(requestId);
      setPendingAutoplayIndex(page.clipIndex);
      clearAutoplayTimer();
      void stop();
      autoplayTimerRef.current = setTimeout(() => {
        if (autoplayTargetRef.current !== page.clipIndex) return;
        if (visibleRequestIdRef.current !== requestId) return;
        void requestAutoplay(page.clipIndex, requestId);
      }, AUTOPLAY_DEBOUNCE_MS);
      return;
    }

    autoplayTargetRef.current = null;
    setVisibleClipIndex(null);
    setCurrentVisibleRequestId(null);
    setPendingAutoplayIndex(null);
    clearAutoplayTimer();
    finalizeSession();
    void stop();
  }, [
    activeIndex,
    clearAutoplayTimer,
    createRequestId,
    currentRequestId,
    data.length,
    feedPages,
    finalizeSession,
    hasMoreClips,
    onLoadMoreClips,
    onVisibleClipChange,
    pendingAutoplayIndex,
    playbackPhase,
    requestAutoplay,
    setCurrentVisibleRequestId,
    stop,
  ]);

  React.useEffect(() => {
    if (loadTriggerRef.current > data.length || visibleClipCount <= 10) {
      loadTriggerRef.current = 0;
    }
  }, [data.length, visibleClipCount]);

  React.useEffect(() => {
    if (pendingAutoplayIndex === null) return;
    if (activeIndex !== pendingAutoplayIndex) return;
    if (currentRequestId === null || currentRequestId !== visibleRequestIdRef.current) return;
    if (
      playbackPhase !== 'loading'
      && playbackPhase !== 'playing'
      && playbackPhase !== 'paused'
      && playbackPhase !== 'error'
    ) {
      return;
    }
    setPendingAutoplayIndex(null);
  }, [activeIndex, currentRequestId, pendingAutoplayIndex, playbackPhase]);

  React.useEffect(() => {
    if (!isCurrentlyPlaying) return;

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
  }, [activeIndex, clips, finalizeSession, isCurrentlyPlaying, onClipStarted, progress]);

  React.useEffect(() => {
    if (!isCurrentlyPlaying) return;
    const clip = clips[activeIndex];
    if (!clip || progress < 0.8) return;

    const clipKey = buildClipKey(clip, activeIndex);
    if (completedRef.current.has(clipKey)) return;
    completedRef.current.add(clipKey);
    onClipCompleted(clip, activeIndex, progress);
  }, [activeIndex, clips, isCurrentlyPlaying, onClipCompleted, progress]);

  React.useEffect(() => {
    return () => {
      clearAutoplayTimer();
      finalizeSession();
    };
  }, [clearAutoplayTimer, finalizeSession]);

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
              <View
                style={[
                  styles.cardPage,
                  {
                    minHeight: pageHeight,
                    paddingBottom: 18 + insets.bottom,
                    paddingHorizontal: metrics.pageHorizontalPadding,
                  },
                ]}
              >
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
              <View
                style={[
                  styles.cardPage,
                  {
                    minHeight: pageHeight,
                    paddingBottom: 18 + insets.bottom,
                    paddingHorizontal: metrics.pageHorizontalPadding,
                  },
                ]}
              >
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
          const isVisible = index === visibleClipIndex;
          const isPreparingAutoplay = index === pendingAutoplayIndex;
          const showLoadingOverlay = isVisible
            && isActive
            && playbackPhase === 'loading'
            && pendingClipIndex === index
            && (visibleRequestId === null || currentRequestId === visibleRequestId);
          const line = isActive ? clip.lines?.[activeLineIndex] : clip.lines?.[0];
          const clipKey = item.key;
          const liked = likedKeys.includes(clipKey);
          const saved = bookmarkedKeys.includes(clipKey);
          const sourceUrl = getClipSourceExternalUrl(clip);

          return (
            <View style={[styles.page, { minHeight: pageHeight, paddingBottom: 18 + insets.bottom }]}>
              <PlayerLayout
                header={
                  <View style={[styles.headerBlock, { width: playerWidth }]}>
                    <View style={styles.headerActions}>
                      <Pressable onPress={() => {
                        triggerUiFeedback('menu');
                        onOpenMenu();
                      }} style={styles.iconButton}>
                        <Feather name="menu" size={18} color={colors.textSecondary} />
                      </Pressable>
                      {sourceUrl ? (
                        <Pressable
                          onPress={() => {
                            void handleOpenSource(clip);
                          }}
                          style={styles.iconButton}
                        >
                          <Feather name="external-link" size={18} color={colors.textSecondary} />
                        </Pressable>
                      ) : (
                        <View style={styles.iconButtonPlaceholder} />
                      )}
                    </View>
                    <View style={styles.headerCopy}>
                      <Text style={styles.clipTitle}>{clip.title}</Text>
                      <Pressable
                        onPress={() => {
                          triggerUiFeedback('menu');
                          setTranscriptIndex(index);
                        }}
                      >
                        <Text style={styles.clipSource}>
                          {getSourceLabel(clip.source)}
                          {clip.tag ? ` · ${getLocalizedTopicLabel(clip.tag, t)}` : ''}
                        </Text>
                      </Pressable>
                      {clip._aiReason ? <Text style={styles.clipReason}>{clip._aiReason}</Text> : null}
                    </View>
                  </View>
                }
                controls={
                  <View style={[styles.controlsWrap, { width: playerWidth }]}>
                    <PlayerControls
                      playbackPhase={isActive ? playbackPhase : 'idle'}
                      disabled={isActive && playbackPhase === 'loading'}
                      positionMillis={isActive ? positionMillis : 0}
                      durationMillis={isActive ? durationMillis : 0}
                      playbackRate={currentPlaybackRate}
                      subtitleSize={subtitleSize}
                      dominantHand={dominantHand}
                      showZh={showZh}
                      masked={masked}
                      progressBar={(
                        <ProgressBar
                          progress={isActive ? progress : 0}
                          markers={[]}
                          currentSentenceRange={isActive ? currentSentenceRange : null}
                          onSeek={ratio => {
                            if (!isActive) return;
                            void seekToRatio(ratio);
                          }}
                        />
                      )}
                      onTogglePlay={() => {
                        autoplayTargetRef.current = index;
                        setVisibleClipIndex(index);
                        clearAutoplayTimer();
                        if (isActive && playbackPhase === 'loading') {
                          return;
                        }
                        if (isActive && playbackPhase === 'playing') {
                          void pause();
                          return;
                        }
                        const requestId = isPreparingAutoplay && visibleRequestIdRef.current
                          ? visibleRequestIdRef.current
                          : createRequestId();
                        setCurrentVisibleRequestId(requestId);
                        setPendingAutoplayIndex(null);
                        void playIndex(index, requestId);
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
                      onCycleSubtitleSize={onSubtitleSizeChange}
                      onToggleZh={() => setShowZh(prev => !prev)}
                      onToggleMask={() => setMasked(prev => !prev)}
                      onOpenMenu={onOpenMenu}
                    />
                  </View>
                }
              >
                <View style={[styles.contentStage, { width: playerWidth }]}>
                  {showLoadingOverlay ? (
                    <View style={styles.loadingOverlay}>
                      <View style={styles.loadingOverlayCard}>
                        <ActivityIndicator size="small" color={colors.textPrimary} />
                        <Text style={styles.loadingOverlayText}>{t('feed.preparingPlayback')}</Text>
                      </View>
                    </View>
                  ) : null}
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

                  <View style={[styles.lineWrap, { width: lineWrapWidth }]}>
                    {line ? (
                      <WordLine
                        line={line}
                        currentTime={isActive ? currentTime : 0}
                        isActive={isActive}
                        showZh={showZh}
                        masked={masked}
                        subtitleSize={subtitleSize}
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
                            contentKey: clip.contentKey,
                            lineIndex: isActive ? activeLineIndex : 0,
                          });
                        }}
                      />
                    ) : null}
                    {!showZh ? <View style={styles.translationBar} /> : null}
                    {isVisible && errorMessage ? <Text style={styles.audioStateError}>{errorMessage}</Text> : null}
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
              contentKey: popup.contentKey,
              lineIndex: popup.lineIndex,
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
          <View style={[styles.transcriptHeader, { paddingHorizontal: metrics.pageHorizontalPadding }]}>
            <View style={[styles.transcriptHeaderInner, { maxWidth: metrics.modalMaxWidth }]}>
              <View style={styles.transcriptHeaderCopy}>
                <Text style={styles.transcriptTitle}>{transcriptClip?.title}</Text>
                <Text style={styles.transcriptMeta}>
                  {transcriptClip ? getSourceLabel(transcriptClip.source) : ''}
                </Text>
              </View>
              <PillButton label={t('common.close')} onPress={() => setTranscriptIndex(null)} />
            </View>
          </View>

          <ScrollView
            contentContainerStyle={[
              styles.transcriptBody,
              {
                paddingHorizontal: metrics.pageHorizontalPadding,
                maxWidth: metrics.modalMaxWidth,
                alignSelf: 'center',
                width: '100%',
              },
            ]}
          >
            {(transcriptClip?.lines || []).map((entry, idx) => (
              <GlassCard key={`${idx}-${entry.start}`} style={styles.transcriptLine}>
                <Text
                  style={[
                    styles.transcriptEn,
                    subtitleSize === 'sm' && styles.transcriptEnSmall,
                    subtitleSize === 'lg' && styles.transcriptEnLarge,
                  ]}
                >
                  {entry.en}
                </Text>
                <Text
                  style={[
                    styles.transcriptZh,
                    subtitleSize === 'sm' && styles.transcriptZhSmall,
                    subtitleSize === 'lg' && styles.transcriptZhLarge,
                  ]}
                >
                  {entry.zh}
                </Text>
              </GlassCard>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </ScreenSurface>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
return StyleSheet.create({
  page: {
    justifyContent: 'space-between',
  },
  cardPage: {
    justifyContent: 'center',
    paddingHorizontal: spacing.page,
  },
  headerBlock: {
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
  controlsWrap: {
    gap: spacing.md,
  },
  contentStage: {
    minHeight: 260,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.18)',
    borderRadius: radii.xl,
  },
  loadingOverlayCard: {
    minWidth: 168,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: radii.lg,
    backgroundColor: colors.bgSurface1,
    borderWidth: 1,
    borderColor: colors.strokeStrong,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  loadingOverlayText: {
    color: colors.textPrimary,
    fontSize: typography.caption,
    fontWeight: '600',
    textAlign: 'center',
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
  transcriptSafeArea: {
    flex: 1,
    backgroundColor: colors.bgApp,
  },
  transcriptHeader: {
    paddingTop: 12,
    paddingBottom: 12,
    alignItems: 'center',
  },
  transcriptHeaderInner: {
    width: '100%',
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
  transcriptEnSmall: {
    fontSize: 14,
    lineHeight: 20,
  },
  transcriptEnLarge: {
    fontSize: 17,
    lineHeight: 25,
  },
  transcriptZh: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  transcriptZhSmall: {
    fontSize: 11,
    lineHeight: 16,
  },
  transcriptZhLarge: {
    fontSize: 13,
    lineHeight: 20,
  },
});
}
