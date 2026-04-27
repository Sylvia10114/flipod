import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  ActionButton,
  EmptyState,
  GlassCard,
  ScreenHeader,
  ScreenSurface,
} from '../components/AppChrome';
import { ChallengeWordPills } from '../components/ChallengeWordPills';
import { radii, spacing, typography } from '../design';
import {
  buildGeneratedPracticeReason,
  PRACTICE_MAX_PENDING,
  PRACTICE_UNLOCK_COUNT,
} from '../generated-practice';
import { useUiI18n } from '../i18n';
import { getLocalizedTopicLabel } from '../i18n/helpers';
import { useResponsiveLayout } from '../responsive';
import { useAppTheme } from '../theme';
import type {
  GeneratedPractice,
  GeneratedPracticeState,
  Profile,
  VocabEntry,
} from '../types';

type Props = {
  practiceState: GeneratedPracticeState;
  pendingPractices: GeneratedPractice[];
  completedPractices: GeneratedPractice[];
  profile: Profile;
  vocabList: VocabEntry[];
  showIntro: boolean;
  onDismissIntro: () => void;
  contentViewportHeight?: number;
  headerTitle?: string;
  headerSubtitle?: string;
  onBack?: (() => void) | null;
  onGenerateMore: () => void;
  onStartPractice: (practiceId: string) => void;
  onOpenCompletedPractice: (practiceId: string) => void;
};

function practiceDurationLabel(practice: GeneratedPractice) {
  const totalSeconds = practice.lines?.length
    ? Math.max(0, Math.round(practice.lines[practice.lines.length - 1].end))
    : 0;
  if (!totalSeconds) return '';
  return `${Math.floor(totalSeconds / 60)}:${String(Math.round(totalSeconds % 60)).padStart(2, '0')}`;
}

function toChallengeWords(practice: GeneratedPractice) {
  const byWord = new Map(
    (practice.target_word_contexts || []).map(item => [item.word.toLowerCase(), item])
  );
  return (practice.target_words || []).slice(0, 3).map((word, index) => {
    const context = byWord.get(word.toLowerCase());
    return {
      word,
      cefr: context?.cefr,
      lineIndex: context?.sentence_index ?? index,
    };
  });
}

function createProgressLabel(count: number, t: (key: string, params?: Record<string, string | number>) => string) {
  return t('practice.unlockProgress', { count, total: PRACTICE_UNLOCK_COUNT });
}

function buildPracticeMeta(
  practice: GeneratedPractice,
  t: (key: string, params?: Record<string, string | number>) => string
) {
  const pieces = [
    practice.tag ? getLocalizedTopicLabel(practice.tag, t) : getLocalizedTopicLabel('story', t),
    practice.cefr || '',
    practiceDurationLabel(practice),
  ].filter(Boolean);
  return pieces.join(' · ');
}

function buildPracticeReasonText(
  practice: GeneratedPractice,
  t: (key: string, params?: Record<string, string | number>) => string
) {
  return t('practice.generatedReason', {
    words: buildGeneratedPracticeReason((practice.target_words || []).map(word => ({ word } as VocabEntry))),
  });
}

export function PracticeScreen({
  practiceState,
  pendingPractices,
  completedPractices,
  profile,
  vocabList,
  showIntro,
  onDismissIntro,
  contentViewportHeight = 0,
  headerTitle,
  headerSubtitle,
  onBack = null,
  onGenerateMore,
  onStartPractice,
  onOpenCompletedPractice,
}: Props) {
  const { colors } = useAppTheme();
  const { t } = useUiI18n();
  const metrics = useResponsiveLayout();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const vocabCount = vocabList.length;
  const isUnlocked = vocabCount >= PRACTICE_UNLOCK_COUNT;
  const canGenerateMore = isUnlocked && pendingPractices.length < PRACTICE_MAX_PENDING && !practiceState.generating;
  const introBody = profile.nativeLanguage === 'english'
    ? t('practice.generatedIntroBody')
    : t('practice.generatedIntroBodyLocalized');
  const featuredPractice = pendingPractices[0] || null;
  const queuePractices = pendingPractices.slice(1);
  const completedPreview = completedPractices.slice(-3).reverse();

  return (
    <ScreenSurface edges={headerTitle ? ['top', 'left', 'right', 'bottom'] : ['left', 'right', 'bottom']}>
      {headerTitle ? (
        <ScreenHeader
          title={headerTitle}
          subtitle={headerSubtitle}
          leading={onBack ? (
            <Pressable onPress={onBack} hitSlop={8} style={styles.backButton}>
              <Text style={styles.backButtonText}>{t('common.back')}</Text>
            </Pressable>
          ) : undefined}
        />
      ) : null}
      <ScrollView
        style={[styles.scroll, contentViewportHeight > 0 && { minHeight: contentViewportHeight }]}
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: metrics.pageHorizontalPadding,
            maxWidth: metrics.contentMaxWidth,
            alignSelf: 'center',
            width: '100%',
          },
        ]}
      >
        {showIntro ? (
          <GlassCard tone="practice" style={styles.introCard}>
            <Text style={styles.introTitle}>{t('practice.generatedIntroTitle')}</Text>
            <Text style={styles.introBody}>{introBody}</Text>
            <ActionButton
              label={t('practice.introAcknowledge')}
              onPress={onDismissIntro}
              variant="secondary"
              style={styles.introButton}
            />
          </GlassCard>
        ) : null}

        {!isUnlocked ? (
          <GlassCard tone="practice" style={styles.unlockCard}>
            <Text style={styles.unlockEyebrow}>{t('home.learnTab')}</Text>
            <Text style={styles.unlockTitle}>{t('practice.unlockTitle')}</Text>
            <Text style={styles.unlockBody}>{t('practice.unlockBody')}</Text>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.min(100, Math.round((vocabCount / PRACTICE_UNLOCK_COUNT) * 100))}%` },
                ]}
              />
            </View>
            <Text style={styles.progressLabel}>{createProgressLabel(vocabCount, t)}</Text>
          </GlassCard>
        ) : null}

        {isUnlocked && !featuredPractice && practiceState.generating ? (
          <GlassCard tone="practice" style={styles.loadingCard}>
            <ActivityIndicator size="small" color={colors.accentPractice} />
            <Text style={styles.loadingTitle}>{t('practice.generatingTitle')}</Text>
            <Text style={styles.loadingBody}>{t('practice.generatingBody')}</Text>
          </GlassCard>
        ) : null}

        {isUnlocked && featuredPractice ? (
          <GlassCard tone="practice" style={styles.featuredCard}>
            <View style={styles.featuredTopRow}>
              <View style={styles.featuredBadge}>
                <Text style={styles.featuredBadgeText}>{t('practice.pendingTitle')}</Text>
              </View>
              <Text style={styles.featuredCount}>{createProgressLabel(vocabCount, t)}</Text>
            </View>

            <Text style={styles.featuredTitle}>{featuredPractice.title}</Text>
            <Text style={styles.featuredMeta}>{buildPracticeMeta(featuredPractice, t)}</Text>

            <Text style={styles.featuredReason}>{buildPracticeReasonText(featuredPractice, t)}</Text>

            {toChallengeWords(featuredPractice).length > 0 ? (
              <View style={styles.challengeWrap}>
                <Text style={styles.challengeLabel}>{t('practiceSession.challengeWordsTitle')}</Text>
                <ChallengeWordPills words={toChallengeWords(featuredPractice)} tone="practice" />
              </View>
            ) : null}

            {practiceState.generating ? (
              <View style={styles.generatingRow}>
                <ActivityIndicator size="small" color={colors.accentPractice} />
                <Text style={styles.generatingText}>{t('practice.generatingBody')}</Text>
              </View>
            ) : null}

            <View style={styles.featuredActions}>
              <ActionButton
                label={t('practice.startGeneratedPractice')}
                onPress={() => onStartPractice(featuredPractice.id)}
                style={styles.featuredPrimaryAction}
              />
              {canGenerateMore ? (
                <ActionButton
                  label={t('practice.generateMore')}
                  onPress={onGenerateMore}
                  variant="secondary"
                  style={styles.featuredSecondaryAction}
                />
              ) : null}
            </View>
          </GlassCard>
        ) : null}

        {isUnlocked && !featuredPractice && !practiceState.generating ? (
          <EmptyState
            title={t('practice.pendingEmptyTitle')}
            body={
              practiceState.lastGenerationError?.msg
                ? `${t('practice.pendingEmptyBody')} ${practiceState.lastGenerationError.msg}`
                : t('practice.pendingEmptyBody')
            }
          />
        ) : null}

        {isUnlocked && queuePractices.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t('practice.pendingTitle')}</Text>
              <Text style={styles.sectionMeta}>{queuePractices.length}</Text>
            </View>

            {queuePractices.map(practice => {
              const challengeWords = toChallengeWords(practice);
              return (
                <GlassCard key={practice.id} style={styles.queueCard}>
                  <View style={styles.queueHead}>
                    <View style={styles.queueCopy}>
                      <Text style={styles.queueTitle}>{practice.title}</Text>
                      <Text style={styles.queueMeta}>{buildPracticeMeta(practice, t)}</Text>
                    </View>
                  </View>

                  <Text style={styles.queueReason}>{buildPracticeReasonText(practice, t)}</Text>

                  {challengeWords.length > 0 ? (
                    <View style={styles.queuePills}>
                      <ChallengeWordPills words={challengeWords.slice(0, 2)} tone="practice" />
                    </View>
                  ) : null}

                  <ActionButton
                    label={t('practice.startGeneratedPractice')}
                    onPress={() => onStartPractice(practice.id)}
                    variant="secondary"
                  />
                </GlassCard>
              );
            })}
          </View>
        ) : null}

        {completedPreview.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t('practice.completedTitle')}</Text>
              <Text style={styles.sectionMeta}>{completedPreview.length}</Text>
            </View>

            <GlassCard style={styles.completedPanel}>
              {completedPreview.map((practice, index) => (
                <Pressable
                  key={`completed-${practice.id}`}
                  onPress={() => onOpenCompletedPractice(practice.id)}
                  style={[
                    styles.completedRow,
                    index < completedPreview.length - 1 && styles.completedRowBorder,
                  ]}
                >
                  <View style={styles.completedCopy}>
                    <Text style={styles.completedTitle}>{practice.title}</Text>
                    <Text style={styles.completedMeta}>
                      {practice.tag ? getLocalizedTopicLabel(practice.tag, t) : ''}
                      {practice.completedAt ? ` · ${new Date(practice.completedAt).toLocaleDateString()}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.completedAction}>{t('practice.viewCompleted')}</Text>
                </Pressable>
              ))}
            </GlassCard>
          </View>
        ) : null}
      </ScrollView>
    </ScreenSurface>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    scroll: {
      flex: 1,
    },
    backButton: {
      minHeight: 40,
      justifyContent: 'center',
      paddingHorizontal: spacing.sm,
      borderRadius: radii.pill,
    },
    backButtonText: {
      color: colors.textPrimary,
      fontSize: typography.caption,
      fontWeight: '700',
    },
    content: {
      paddingTop: spacing.lg,
      paddingBottom: spacing.xxl,
      gap: spacing.lg,
    },
    introCard: {
      gap: spacing.md,
    },
    introTitle: {
      color: colors.textPrimary,
      fontSize: typography.title,
      fontWeight: '700',
    },
    introBody: {
      color: colors.textSecondary,
      fontSize: typography.body,
      lineHeight: 22,
    },
    introButton: {
      alignSelf: 'flex-start',
    },
    unlockCard: {
      gap: spacing.md,
    },
    unlockEyebrow: {
      color: colors.accentPractice,
      fontSize: typography.micro,
      fontWeight: '700',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
    unlockTitle: {
      color: colors.textPrimary,
      fontSize: typography.hero,
      fontWeight: '800',
    },
    unlockBody: {
      color: colors.textSecondary,
      fontSize: typography.body,
      lineHeight: 22,
    },
    progressTrack: {
      height: 10,
      borderRadius: 999,
      backgroundColor: colors.bgSurface2,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      borderRadius: 999,
      backgroundColor: colors.accentPractice,
    },
    progressLabel: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      fontWeight: '600',
    },
    loadingCard: {
      gap: spacing.md,
      alignItems: 'flex-start',
    },
    loadingTitle: {
      color: colors.textPrimary,
      fontSize: typography.title,
      fontWeight: '700',
    },
    loadingBody: {
      color: colors.textSecondary,
      fontSize: typography.body,
      lineHeight: 22,
    },
    featuredCard: {
      gap: spacing.md,
      backgroundColor: 'rgba(168,85,247,0.12)',
      borderColor: 'rgba(168,85,247,0.22)',
    },
    featuredTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: spacing.md,
    },
    featuredBadge: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: radii.pill,
      backgroundColor: 'rgba(168,85,247,0.16)',
      borderWidth: 1,
      borderColor: 'rgba(216,180,254,0.24)',
    },
    featuredBadgeText: {
      color: '#E9D5FF',
      fontSize: typography.micro,
      fontWeight: '700',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    featuredCount: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      fontWeight: '600',
    },
    featuredTitle: {
      color: colors.textPrimary,
      fontSize: 24,
      lineHeight: 30,
      fontWeight: '800',
    },
    featuredMeta: {
      color: colors.textSecondary,
      fontSize: typography.caption,
    },
    featuredReason: {
      color: colors.textPrimary,
      fontSize: typography.body,
      lineHeight: 21,
    },
    challengeWrap: {
      gap: spacing.sm,
    },
    challengeLabel: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    generatingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.xs,
    },
    generatingText: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      flex: 1,
    },
    featuredActions: {
      flexDirection: 'row',
      gap: spacing.md,
      alignItems: 'center',
    },
    featuredPrimaryAction: {
      flex: 1,
    },
    featuredSecondaryAction: {
      minWidth: 132,
    },
    section: {
      gap: spacing.md,
    },
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: spacing.md,
    },
    sectionTitle: {
      color: colors.textPrimary,
      fontSize: typography.title,
      fontWeight: '700',
    },
    sectionMeta: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      fontWeight: '600',
    },
    queueCard: {
      gap: spacing.md,
      backgroundColor: colors.bgSurface1,
    },
    queueHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: spacing.md,
    },
    queueCopy: {
      flex: 1,
      gap: spacing.xs,
    },
    queueTitle: {
      color: colors.textPrimary,
      fontSize: typography.title,
      fontWeight: '700',
    },
    queueMeta: {
      color: colors.textSecondary,
      fontSize: typography.caption,
    },
    queueReason: {
      color: colors.textSecondary,
      fontSize: typography.body,
      lineHeight: 20,
    },
    queuePills: {
      marginTop: -2,
    },
    completedPanel: {
      paddingVertical: 4,
      gap: 0,
    },
    completedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      gap: spacing.md,
    },
    completedRowBorder: {
      borderBottomWidth: 1,
      borderBottomColor: colors.stroke,
    },
    completedCopy: {
      gap: spacing.xs,
    },
    completedTitle: {
      color: colors.textPrimary,
      fontSize: typography.body,
      fontWeight: '600',
    },
    completedMeta: {
      color: colors.textSecondary,
      fontSize: typography.caption,
    },
    completedAction: {
      color: colors.accentPractice,
      fontSize: typography.caption,
      fontWeight: '600',
    },
  });
}
