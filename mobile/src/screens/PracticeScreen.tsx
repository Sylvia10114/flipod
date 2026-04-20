import React, { useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  ActionButton,
  EmptyState,
  GlassCard,
  ScreenSurface,
} from '../components/AppChrome';
import { ChallengeWordPills } from '../components/ChallengeWordPills';
import { spacing, typography } from '../design';
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
  Level,
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
  onGenerateMore: () => void;
  onStartPractice: (practiceId: string) => void;
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

export function PracticeScreen({
  practiceState,
  pendingPractices,
  completedPractices,
  profile,
  vocabList,
  showIntro,
  onDismissIntro,
  contentViewportHeight = 0,
  onGenerateMore,
  onStartPractice,
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

  return (
    <ScreenSurface edges={['left', 'right', 'bottom']}>
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

        {isUnlocked && pendingPractices.length === 0 && practiceState.generating ? (
          <GlassCard tone="practice" style={styles.loadingCard}>
            <ActivityIndicator size="small" color={colors.accentPractice} />
            <Text style={styles.loadingTitle}>{t('practice.generatingTitle')}</Text>
            <Text style={styles.loadingBody}>{t('practice.generatingBody')}</Text>
          </GlassCard>
        ) : null}

        {isUnlocked ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t('practice.pendingTitle')}</Text>
              {canGenerateMore ? (
                <ActionButton
                  label={t('practice.generateMore')}
                  onPress={onGenerateMore}
                  variant="secondary"
                  style={styles.generateButton}
                />
              ) : null}
            </View>

            {pendingPractices.length > 0 ? (
              pendingPractices.map(practice => {
                const challengeWords = toChallengeWords(practice);
                return (
                  <GlassCard key={practice.id} tone="practice" style={styles.practiceCard}>
                    <View style={styles.practiceHead}>
                      <View style={styles.practiceCopy}>
                        <Text style={styles.cardTitle}>{practice.title}</Text>
                        <Text style={styles.cardMeta}>
                          {practice.tag ? getLocalizedTopicLabel(practice.tag, t) : getLocalizedTopicLabel('story', t)}
                          {practice.cefr ? ` · ${practice.cefr}` : ''}
                          {practiceDurationLabel(practice) ? ` · ${practiceDurationLabel(practice)}` : ''}
                        </Text>
                      </View>
                    </View>

                    {challengeWords.length > 0 ? (
                      <View style={styles.challengeWrap}>
                        <Text style={styles.challengeLabel}>{t('practiceSession.challengeWordsTitle')}</Text>
                        <ChallengeWordPills words={challengeWords} tone="practice" />
                      </View>
                    ) : null}

                    <Text style={styles.reason}>
                      {t('practice.generatedReason', { words: buildGeneratedPracticeReason(
                        (practice.target_words || []).map(word => ({ word } as VocabEntry))
                      ) })}
                    </Text>

                    <ActionButton
                      label={t('practice.startGeneratedPractice')}
                      onPress={() => onStartPractice(practice.id)}
                    />
                  </GlassCard>
                );
              })
            ) : (
              <EmptyState
                title={t('practice.pendingEmptyTitle')}
                body={
                  practiceState.lastGenerationError?.msg
                    ? `${t('practice.pendingEmptyBody')} ${practiceState.lastGenerationError.msg}`
                    : t('practice.pendingEmptyBody')
                }
              />
            )}
          </View>
        ) : null}

        {completedPractices.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('practice.completedTitle')}</Text>
            {completedPractices.slice(-3).reverse().map(practice => (
              <GlassCard key={`completed-${practice.id}`} style={styles.completedCard}>
                <Text style={styles.cardTitle}>{practice.title}</Text>
                <Text style={styles.cardMeta}>
                  {practice.tag ? getLocalizedTopicLabel(practice.tag, t) : ''}
                  {practice.completedAt ? ` · ${new Date(practice.completedAt).toLocaleDateString()}` : ''}
                </Text>
              </GlassCard>
            ))}
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
    generateButton: {
      minWidth: 124,
    },
    practiceCard: {
      gap: spacing.md,
    },
    practiceHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: spacing.md,
    },
    practiceCopy: {
      flex: 1,
      gap: spacing.xs,
    },
    cardTitle: {
      color: colors.textPrimary,
      fontSize: typography.title,
      fontWeight: '700',
    },
    cardMeta: {
      color: colors.textSecondary,
      fontSize: typography.caption,
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
    reason: {
      color: colors.textSecondary,
      fontSize: typography.body,
      lineHeight: 22,
    },
    completedCard: {
      gap: spacing.xs,
    },
  });
}
