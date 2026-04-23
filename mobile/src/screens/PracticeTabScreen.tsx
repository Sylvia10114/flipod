import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
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
import type { Clip, ClipQuestion, Level, PracticeTabState } from '../types';

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

function answerIndex(question: ClipQuestion) {
  const normalized = String(question.answer || '').trim().toUpperCase();
  if (/^[A-Z]$/.test(normalized)) {
    return Math.max(0, normalized.charCodeAt(0) - 65);
  }
  if (/^\d+$/.test(normalized)) {
    return Math.max(0, Number(normalized) - 1);
  }
  const optionIndex = (question.options || []).findIndex(option => option.trim().toUpperCase() === normalized);
  return optionIndex >= 0 ? optionIndex : 0;
}

function getStageZeroQuestion(clip: Clip) {
  const questions = Array.isArray(clip.questions) ? clip.questions : [];
  if (questions.some(question => typeof question.stage === 'number')) {
    return questions.find(question => question.stage === 0) || null;
  }
  return questions[0] || null;
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
  renderInlineSession,
}: Props) {
  const { colors } = useAppTheme();
  const { t } = useUiI18n();
  const metrics = useResponsiveLayout();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const listRef = useRef<FlatList<PracticePage> | null>(null);
  const currentPageIndexRef = useRef(0);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 75 });
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, number>>({});
  const [listViewportHeight, setListViewportHeight] = useState(0);

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
  const resolvedViewportHeight = Math.max(
    0,
    listViewportHeight || contentViewportHeight || metrics.windowHeight
  );
  const pageHeight = Math.max(440, Math.round(resolvedViewportHeight));
  const previewCardHeight = Math.max(360, pageHeight - spacing.sm - spacing.xs);

  const syncVisibleClip = useCallback((clipIndex: number) => {
    if (currentPageIndexRef.current === clipIndex) return;
    currentPageIndexRef.current = clipIndex;
    onVisibleClipChange?.(clipIndex);
  }, [onVisibleClipChange]);

  useEffect(() => {
    if (!pages.length) return;
    currentPageIndexRef.current = safeCursor;
    onVisibleClipChange?.(safeCursor);
  }, [onVisibleClipChange, pages.length, safeCursor]);

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
      listRef.current?.scrollToOffset({
        offset: snappedOffset,
        animated: false,
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

    const previewBody = buildPracticePreviewBody(item.clip);
    const challengeWords = deriveChallengeWords(item.clip, level, knownWords).slice(0, 3);
    const previewQuestion = getStageZeroQuestion(item.clip);
    const selectedPreviewAnswer = previewQuestion ? previewAnswers[item.key] : undefined;
    const previewQuestionAnswered = Number.isInteger(selectedPreviewAnswer);
    const correctPreviewAnswer = previewQuestion ? answerIndex(previewQuestion) : -1;
    const previewQuestionCorrect = previewQuestionAnswered && selectedPreviewAnswer === correctPreviewAnswer;
    const previewExplanation = previewQuestion
      ? String(previewQuestion.explanation_zh || '').trim()
      : '';
    const statusLabel = item.completedRecord
      ? t('practice.statusPracticed', { words: item.completedRecord.vocabPicked.length })
      : t('practice.statusFresh');
    const completedAtLabel = item.completedRecord
      ? new Date(item.completedRecord.completedAt).toLocaleDateString()
      : '';

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
            <ScrollView
              style={styles.previewScroll}
              contentContainerStyle={styles.previewScrollContent}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.eyebrow}>{t('home.learnTab')}</Text>
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

              {previewBody ? (
                <Text style={styles.body}>{previewBody}</Text>
              ) : null}

              {challengeWords.length > 0 ? (
                <View style={styles.challengeWrap}>
                  <Text style={styles.challengeLabel}>{t('practiceSession.challengeWordsTitle')}</Text>
                  <ChallengeWordPills words={challengeWords} tone="practice" />
                </View>
              ) : null}

              {previewQuestion && !item.completedRecord ? (
                <GlassCard tone="practice" style={styles.questionCard}>
                  <Text style={styles.challengeLabel}>{t('practiceSession.questionLabel')}</Text>
                  <Text style={styles.questionText}>{previewQuestion.question}</Text>
                  {previewQuestionAnswered ? (
                    <View
                      style={[
                        styles.feedbackSwap,
                        previewQuestionCorrect ? styles.feedbackSwapCorrect : styles.feedbackSwapWrong,
                      ]}
                    >
                      <Text
                        style={[
                          styles.feedbackTitle,
                          previewQuestionCorrect ? styles.feedbackTitleCorrect : styles.feedbackTitleWrong,
                        ]}
                      >
                        {previewQuestionCorrect
                          ? t('practiceSession.previewFeedbackCorrect')
                          : t('practiceSession.previewFeedbackChecked')}
                      </Text>
                      <Text style={styles.feedbackAnswer}>
                        {previewQuestion.options?.[correctPreviewAnswer] || ''}
                      </Text>
                      {previewExplanation ? (
                        <Text style={styles.explanationText}>{previewExplanation}</Text>
                      ) : null}
                    </View>
                  ) : (
                    <View style={styles.optionsWrap}>
                      {(previewQuestion.options || []).map((option, index) => {
                        const isSelected = selectedPreviewAnswer === index;
                        return (
                          <Pressable
                            key={`${item.key}-preview-opt-${index}`}
                            disabled={previewQuestionAnswered}
                            hitSlop={6}
                            onPressIn={() => {
                              if (previewQuestionAnswered) return;
                              setPreviewAnswers(prev => ({
                                ...prev,
                                [item.key]: index,
                              }));
                            }}
                            style={[
                              styles.optionButton,
                              styles.optionButtonCompact,
                              isSelected && styles.optionButtonSelected,
                            ]}
                          >
                            <Text style={styles.optionText}>{option}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </GlassCard>
              ) : null}

              {item.completedRecord ? (
                <Text style={styles.completedMeta}>{completedAtLabel}</Text>
              ) : null}
            </ScrollView>

            <View style={styles.actions}>
              <ActionButton
                label={item.completedRecord ? t('practice.viewCompleted') : t('common.continue')}
                onPress={() => (
                  item.completedRecord
                    ? onOpenCompletedClip(item.clipIndex)
                    : onStartPractice(item.clipIndex)
                )}
                disabled={Boolean(previewQuestion && !item.completedRecord && !previewQuestionAnswered)}
                style={styles.primaryAction}
              />
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
    previewAnswers,
    previewCardHeight,
    practiceState.practice_cursor,
    renderInlineSession,
    styles,
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
        extraData={previewAnswers}
        keyExtractor={item => item.key}
        renderItem={renderItem}
        style={styles.list}
        onLayout={event => {
          const nextHeight = event.nativeEvent.layout.height;
          setListViewportHeight(prev => (Math.abs(prev - nextHeight) > 0.5 ? nextHeight : prev));
        }}
        snapToInterval={pageHeight}
        snapToAlignment="start"
        disableIntervalMomentum
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
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
      minHeight: 0,
      overflow: 'hidden',
    },
    previewScroll: {
      flex: 1,
      minHeight: 0,
    },
    previewScrollContent: {
      flexGrow: 1,
      gap: spacing.md,
      paddingBottom: spacing.md,
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
    questionCard: {
      gap: spacing.xs,
      backgroundColor: colors.bgSurface1,
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
    optionText: {
      color: colors.textPrimary,
      fontSize: typography.caption,
      lineHeight: 20,
      fontWeight: '600',
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
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.stroke,
    },
    primaryAction: {
      width: '100%',
    },
  });
}
