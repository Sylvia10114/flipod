import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { buildClipKey, getClipDurationSeconds, getSourceLabel } from '../clip-utils';
import { ActionButton, EmptyState, GlassCard, ScreenSurface } from '../components/AppChrome';
import { ChallengeWordPills } from '../components/ChallengeWordPills';
import { deriveChallengeWords } from '../learning-scaffold';
import { getLocalizedTopicLabel } from '../i18n/helpers';
import { useUiI18n } from '../i18n';
import { radii, spacing, typography } from '../design';
import { useResponsiveLayout } from '../responsive';
import { useAppTheme } from '../theme';
import type { Clip, Level, PracticeTabState } from '../types';

const PRIMING_SECONDS = 3;

type Props = {
  clips: Clip[];
  clipKeys?: string[];
  practiceState: PracticeTabState;
  level: Level | null;
  knownWords: string[];
  contentViewportHeight?: number;
  onStartPractice: (clipIndex: number) => void;
  onOpenCompletedClip: (clipIndex: number) => void;
  onVisibleClipChange?: (clipIndex: number) => void;
  isPracticeSessionActive?: boolean;
  renderInlineSession?: (args: {
    clip: Clip;
    clipIndex: number;
    completedRecord: PracticeTabState['completed_clips'][number] | null;
    isVisible: boolean;
  }) => React.ReactNode | null;
};

type PracticePage = {
  key: string;
  clip: Clip;
  clipIndex: number;
  completedRecord: PracticeTabState['completed_clips'][number] | null;
};

function formatClipDuration(clip: Clip) {
  const totalSeconds = Math.max(0, Math.round(getClipDurationSeconds(clip)));
  if (!totalSeconds) return '';
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function buildPracticePreviewBody(clip: Clip) {
  if (clip.info_takeaway) return clip.info_takeaway;
  if (clip.lines?.[0]?.zh) return clip.lines[0].zh;
  if (clip.lines?.[0]?.en) return clip.lines[0].en;
  return '';
}

export function PracticeTabScreen({
  clips,
  clipKeys = [],
  practiceState,
  level,
  knownWords,
  contentViewportHeight = 0,
  onStartPractice,
  onOpenCompletedClip,
  onVisibleClipChange,
  isPracticeSessionActive = false,
  renderInlineSession,
}: Props) {
  const { colors } = useAppTheme();
  const { t } = useUiI18n();
  const metrics = useResponsiveLayout();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const listRef = useRef<FlatList<PracticePage> | null>(null);
  const currentPageIndexRef = useRef(0);
  const cursorHydratedRef = useRef(false);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 75 });
  const [listViewportHeight, setListViewportHeight] = useState(0);
  const longPressConsumedRef = useRef(false);
  const startedPrimingKeyRef = useRef<string | null>(null);

  const completedByKey = useMemo(() => {
    const map = new Map<string, PracticeTabState['completed_clips'][number]>();
    for (const item of practiceState.completed_clips || []) {
      map.set(item.clipKey, item);
    }
    return map;
  }, [practiceState.completed_clips]);

  const pages = useMemo<PracticePage[]>(() => {
    return clips.map((clip, clipIndex) => {
      const key = clipKeys[clipIndex] || buildClipKey(clip, clipIndex);
      return {
        key,
        clip,
        clipIndex,
        completedRecord: completedByKey.get(key) || null,
      };
    });
  }, [clipKeys, clips, completedByKey]);

  const safeCursor = Math.max(0, Math.min(practiceState.practice_cursor || 0, Math.max(0, pages.length - 1)));
  const [primingState, setPrimingState] = useState({
    clipIndex: safeCursor,
    remaining: PRIMING_SECONDS,
    paused: false,
  });
  const resolvedViewportHeight = Math.max(
    0,
    listViewportHeight || contentViewportHeight || metrics.windowHeight
  );
  const pageHeight = Math.max(440, Math.floor(resolvedViewportHeight));
  const previewCardHeight = Math.max(360, pageHeight - spacing.sm - spacing.xs);

  const syncVisibleClip = useCallback((clipIndex: number) => {
    if (currentPageIndexRef.current === clipIndex) return;
    currentPageIndexRef.current = clipIndex;
    onVisibleClipChange?.(clipIndex);
  }, [onVisibleClipChange]);

  const startPrimingPage = useCallback((page: PracticePage) => {
    if (isPracticeSessionActive) return;
    if (startedPrimingKeyRef.current === page.key) return;
    startedPrimingKeyRef.current = page.key;
    if (page.completedRecord) {
      onOpenCompletedClip(page.clipIndex);
      return;
    }
    onStartPractice(page.clipIndex);
  }, [isPracticeSessionActive, onOpenCompletedClip, onStartPractice]);

  useEffect(() => {
    if (!pages.length) {
      cursorHydratedRef.current = false;
      currentPageIndexRef.current = 0;
      return;
    }
    if (cursorHydratedRef.current && currentPageIndexRef.current < pages.length) return;
    cursorHydratedRef.current = true;
    currentPageIndexRef.current = safeCursor;
    onVisibleClipChange?.(safeCursor);
  }, [onVisibleClipChange, pages.length, safeCursor]);

  useEffect(() => {
    if (!pages.length || isPracticeSessionActive) return;
    startedPrimingKeyRef.current = null;
    setPrimingState({
      clipIndex: safeCursor,
      remaining: PRIMING_SECONDS,
      paused: false,
    });
  }, [isPracticeSessionActive, pages.length, safeCursor]);

  useEffect(() => {
    if (!pages.length || isPracticeSessionActive) return;
    if (primingState.clipIndex !== safeCursor || primingState.paused) return;
    const page = pages[primingState.clipIndex];
    if (!page) return;
    if (primingState.remaining <= 0) {
      startPrimingPage(page);
      return;
    }
    const timer = setTimeout(() => {
      setPrimingState(prev => {
        if (prev.clipIndex !== primingState.clipIndex || prev.paused) return prev;
        return {
          ...prev,
          remaining: Math.max(0, prev.remaining - 1),
        };
      });
    }, 1000);
    return () => clearTimeout(timer);
  }, [isPracticeSessionActive, pages, primingState, safeCursor, startPrimingPage]);

  useEffect(() => {
    if (!pages.length) return;
    if (currentPageIndexRef.current === safeCursor) return;
    const frame = requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({
        index: safeCursor,
        animated: false,
      });
      currentPageIndexRef.current = safeCursor;
    });
    return () => cancelAnimationFrame(frame);
  }, [pages.length, safeCursor]);

  const onMomentumScrollEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!pages.length) return;
    const nextPageIndex = Math.max(
      0,
      Math.min(pages.length - 1, Math.round(event.nativeEvent.contentOffset.y / pageHeight))
    );
    const snappedOffset = nextPageIndex * pageHeight;
    if (Math.abs(event.nativeEvent.contentOffset.y - snappedOffset) > 0.5) {
      listRef.current?.scrollToIndex({
        index: nextPageIndex,
        animated: false,
        viewPosition: 0,
      });
    }
    syncVisibleClip(pages[nextPageIndex].clipIndex);
  }, [pageHeight, pages, syncVisibleClip]);

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const firstVisible = viewableItems.find(item => item.isViewable && typeof item.index === 'number');
    if (!firstVisible || typeof firstVisible.index !== 'number') return;
    const page = pages[firstVisible.index];
    if (!page) return;
    syncVisibleClip(page.clipIndex);
  }, [pages, syncVisibleClip]);

  const renderItem = useCallback(({ item }: ListRenderItemInfo<PracticePage>) => {
    const isVisible = practiceState.practice_cursor === item.clipIndex;
    const inlineSession = renderInlineSession?.({
      clip: item.clip,
      clipIndex: item.clipIndex,
      completedRecord: item.completedRecord,
      isVisible,
    }) || null;

    if (inlineSession) {
      return (
        <View style={[styles.page, styles.pageSession, { height: pageHeight }]}>
          <View
            style={[
              styles.pageInner,
              styles.pageInnerSession,
              {
                paddingHorizontal: metrics.pageHorizontalPadding,
                maxWidth: metrics.contentMaxWidth,
              },
            ]}
          >
            {inlineSession}
          </View>
        </View>
      );
    }

    const hookBody = buildPracticePreviewBody(item.clip);
    const challengeWords = deriveChallengeWords(item.clip, level, knownWords).slice(0, 3);
    const statusLabel = item.completedRecord
      ? t('practice.statusPracticed', { words: item.completedRecord.vocabPicked.length })
      : t('practice.statusFresh');
    const completedAtLabel = item.completedRecord
      ? new Date(item.completedRecord.completedAt).toLocaleDateString()
      : '';
    const isPrimingVisible = isVisible && !isPracticeSessionActive;
    const primingRemaining = isPrimingVisible && primingState.clipIndex === item.clipIndex
      ? primingState.remaining
      : PRIMING_SECONDS;
    const primingPaused = isPrimingVisible
      && primingState.clipIndex === item.clipIndex
      && primingState.paused;
    const primingProgress = (PRIMING_SECONDS - primingRemaining) / PRIMING_SECONDS;
    const startCurrentPage = () => startPrimingPage(item);

    return (
      <View style={[styles.page, { height: pageHeight }]}>
        <View
          style={[
            styles.pageInner,
            styles.pageInnerPreview,
            {
              paddingHorizontal: metrics.pageHorizontalPadding,
              maxWidth: metrics.contentMaxWidth,
            },
          ]}
        >
          <GlassCard
            tone="practice"
            style={[
              styles.heroCard,
              styles.heroCardPreview,
              { height: previewCardHeight },
            ]}
          >
            <View style={styles.previewContent}>
              <Text style={styles.eyebrow}>{t('practicePriming.eyebrow')}</Text>
              <View style={styles.progressRow}>
                <Text style={styles.progressText}>
                  {`${item.clipIndex + 1} / ${pages.length}`}
                </Text>
                <View style={[styles.statusBadge, item.completedRecord ? styles.statusBadgeCompleted : null]}>
                  <Text style={styles.statusBadgeText}>{statusLabel}</Text>
                </View>
              </View>

              <Text style={styles.title}>{item.clip.title}</Text>
              <Text style={styles.meta}>
                {[
                  getSourceLabel(item.clip.source),
                  item.clip.tag ? getLocalizedTopicLabel(item.clip.tag, t) : '',
                  formatClipDuration(item.clip),
                ].filter(Boolean).join(' · ')}
              </Text>

              {hookBody ? (
                <Text style={styles.body}>{hookBody}</Text>
              ) : null}

              {challengeWords.length > 0 ? (
                <View style={styles.challengeWrap}>
                  <Text style={styles.challengeLabel}>{t('practicePriming.keywords')}</Text>
                  <ChallengeWordPills words={challengeWords} tone="practice" />
                </View>
              ) : null}

              <View style={styles.primingSpacer} />

              {item.completedRecord ? (
                <Text style={styles.completedMeta}>{completedAtLabel}</Text>
              ) : null}
            </View>

            <View style={styles.actions}>
              <Text style={styles.swipeHint}>{t('practicePriming.swipeHint')}</Text>
              <Pressable
                hitSlop={10}
                onPressIn={() => {
                  longPressConsumedRef.current = false;
                }}
                onLongPress={() => {
                  longPressConsumedRef.current = true;
                  setPrimingState(prev => (
                    prev.clipIndex === item.clipIndex
                      ? { ...prev, paused: true }
                      : prev
                  ));
                }}
                onPressOut={() => {
                  setPrimingState(prev => (
                    prev.clipIndex === item.clipIndex && prev.paused
                      ? { ...prev, paused: false }
                      : prev
                  ));
                }}
                onPress={() => {
                  if (longPressConsumedRef.current) {
                    longPressConsumedRef.current = false;
                    return;
                  }
                  startCurrentPage();
                }}
                style={[
                  styles.primingRing,
                  { borderColor: primingPaused ? colors.textSecondary : colors.accentPractice },
                ]}
              >
                <View
                  style={[
                    styles.primingRingFill,
                    { opacity: Math.max(0.12, Math.min(0.42, primingProgress * 0.42)) },
                  ]}
                />
                <Text style={styles.primingNumber}>
                  {primingPaused
                    ? t('practicePriming.paused')
                    : String(Math.max(1, primingRemaining))}
                </Text>
              </Pressable>
              <Text style={styles.primingHint}>
                {item.completedRecord ? t('practice.viewCompleted') : t('practicePriming.holdHint')}
              </Text>
            </View>
          </GlassCard>
        </View>
      </View>
    );
  }, [
    level,
    knownWords,
    metrics.contentMaxWidth,
    metrics.pageHorizontalPadding,
    onOpenCompletedClip,
    onStartPractice,
    pageHeight,
    pages.length,
    previewCardHeight,
    primingState,
    practiceState.practice_cursor,
    renderInlineSession,
    isPracticeSessionActive,
    startPrimingPage,
    styles,
    colors.accentPractice,
    colors.textSecondary,
    t,
  ]);

  if (!pages.length) {
    return (
      <ScreenSurface edges={['left', 'right', 'bottom']}>
        <EmptyState title={t('home.learnTab')} body={t('app.initializing')} />
      </ScreenSurface>
    );
  }

  return (
    <ScreenSurface edges={['left', 'right', 'bottom']}>
      <FlatList
        ref={listRef}
        data={pages}
        extraData={primingState}
        keyExtractor={item => item.key}
        renderItem={renderItem}
        style={styles.list}
        nestedScrollEnabled
        onLayout={event => {
          const nextHeight = event.nativeEvent.layout.height;
          setListViewportHeight(prev => (Math.abs(prev - nextHeight) > 0.5 ? nextHeight : prev));
        }}
        pagingEnabled
        snapToInterval={pageHeight}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        directionalLockEnabled
        initialScrollIndex={safeCursor}
        getItemLayout={(_, index) => ({
          length: pageHeight,
          offset: pageHeight * index,
          index,
        })}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig.current}
        onMomentumScrollEnd={onMomentumScrollEnd}
        onScrollToIndexFailed={info => {
          requestAnimationFrame(() => {
            listRef.current?.scrollToOffset({
              offset: info.averageItemLength * info.index,
              animated: false,
            });
          });
        }}
      />
    </ScreenSurface>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    list: {
      flex: 1,
    },
    page: {
      width: '100%',
      justifyContent: 'flex-start',
      overflow: 'hidden',
    },
    pageSession: {
      justifyContent: 'flex-start',
    },
    pageInner: {
      width: '100%',
      alignSelf: 'center',
      minHeight: 0,
    },
    pageInnerPreview: {
      flex: 1,
      height: '100%',
      minHeight: 0,
      justifyContent: 'flex-start',
      paddingTop: spacing.xs,
      paddingBottom: spacing.sm,
    },
    pageInnerSession: {
      flex: 1,
      height: '100%',
      minHeight: 0,
      overflow: 'hidden',
    },
    heroCard: {
      gap: spacing.md,
      paddingVertical: spacing.xl,
      paddingHorizontal: spacing.xl,
      borderRadius: radii.xl,
    },
    heroCardPreview: {
      flex: 1,
      minHeight: 0,
      overflow: 'hidden',
    },
    previewContent: {
      flex: 1,
      minHeight: 0,
      gap: spacing.md,
    },
    eyebrow: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      fontWeight: '700',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    progressRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    progressText: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      fontWeight: '600',
    },
    statusBadge: {
      borderRadius: radii.pill,
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: colors.bgSurface2,
      borderWidth: 1,
      borderColor: colors.stroke,
    },
    statusBadgeCompleted: {
      backgroundColor: 'rgba(34,197,94,0.14)',
      borderColor: 'rgba(34,197,94,0.28)',
    },
    statusBadgeText: {
      color: colors.textPrimary,
      fontSize: typography.micro,
      fontWeight: '700',
    },
    title: {
      color: colors.textPrimary,
      fontSize: typography.title,
      fontWeight: '700',
    },
    meta: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      lineHeight: 18,
    },
    body: {
      color: colors.textSecondary,
      fontSize: typography.body,
      lineHeight: 24,
    },
    challengeWrap: {
      gap: spacing.sm,
    },
    challengeLabel: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      fontWeight: '700',
    },
    primingSpacer: {
      flex: 1,
      minHeight: spacing.lg,
    },
    questionCard: {
      gap: spacing.xs,
      backgroundColor: colors.bgSurface1,
      flex: 1,
      minHeight: 0,
      overflow: 'hidden',
    },
    questionRegion: {
      flex: 1,
      minHeight: 0,
    },
    questionScroll: {
      flex: 1,
      minHeight: 0,
    },
    questionScrollContent: {
      gap: spacing.xs,
      paddingBottom: spacing.xs,
    },
    questionText: {
      color: colors.textPrimary,
      fontSize: typography.body,
      lineHeight: 22,
      fontWeight: '700',
    },
    optionsWrap: {
      gap: spacing.xs,
    },
    optionButton: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.stroke,
      backgroundColor: colors.bgSurface1,
      paddingHorizontal: 14,
      paddingVertical: 14,
    },
    optionButtonCompact: {
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    optionButtonSelected: {
      borderColor: colors.accentPractice,
      backgroundColor: `${colors.accentPractice}18`,
    },
    optionButtonCorrect: {
      borderColor: 'rgba(34,197,94,0.28)',
      backgroundColor: 'rgba(34,197,94,0.12)',
    },
    optionButtonIncorrect: {
      borderColor: 'rgba(239,68,68,0.3)',
      backgroundColor: 'rgba(239,68,68,0.12)',
    },
    optionButtonIdleLocked: {
      opacity: 0.74,
    },
    optionText: {
      color: colors.textPrimary,
      fontSize: typography.caption,
      lineHeight: 20,
      fontWeight: '600',
    },
    optionTextCorrect: {
      color: '#15803d',
    },
    optionTextIncorrect: {
      color: '#b91c1c',
    },
    feedbackSwap: {
      borderRadius: 14,
      borderWidth: 1,
      paddingHorizontal: 12,
      paddingVertical: 12,
      gap: spacing.xs,
    },
    feedbackSwapCorrect: {
      borderColor: 'rgba(34,197,94,0.28)',
      backgroundColor: 'rgba(34,197,94,0.12)',
    },
    feedbackSwapWrong: {
      borderColor: `${colors.accentPractice}22`,
      backgroundColor: `${colors.accentPractice}12`,
    },
    feedbackTitle: {
      fontSize: typography.micro,
      fontWeight: '800',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    feedbackTitleCorrect: {
      color: '#15803d',
    },
    feedbackTitleWrong: {
      color: colors.accentPractice,
    },
    feedbackAnswer: {
      color: colors.textPrimary,
      fontSize: typography.caption,
      lineHeight: 20,
      fontWeight: '700',
    },
    explanationText: {
      color: colors.textSecondary,
      fontSize: typography.micro,
      lineHeight: 18,
    },
    completedMeta: {
      color: colors.textFaint,
      fontSize: typography.micro,
    },
    actions: {
      alignItems: 'center',
      gap: spacing.sm,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.stroke,
    },
    swipeHint: {
      color: colors.textTertiary,
      fontSize: typography.micro,
      fontWeight: '700',
    },
    primingRing: {
      width: 112,
      height: 112,
      borderRadius: 56,
      borderWidth: 3,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      backgroundColor: colors.bgSurface1,
    },
    primingRingFill: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.accentPractice,
    },
    primingNumber: {
      color: colors.textPrimary,
      fontSize: 30,
      lineHeight: 34,
      fontWeight: '800',
      textAlign: 'center',
    },
    primingHint: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      fontWeight: '700',
      textAlign: 'center',
    },
    primaryAction: {
      width: '100%',
    },
  });
}
