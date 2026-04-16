import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ActionButton, GlassCard } from './AppChrome';
import { spacing, typography } from '../design';
import { triggerUiFeedback } from '../feedback';
import { useUiI18n } from '../i18n';
import { useAppTheme } from '../theme';
import type { VocabEntry } from '../types';

type ReviewCardProps = {
  entry: VocabEntry;
  onRemember: () => void;
  onForgot: () => void;
};

export function ReviewCard({ entry, onRemember, onForgot }: ReviewCardProps) {
  const { colors } = useAppTheme();
  const { t } = useUiI18n();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  return (
    <GlassCard tone="feed" style={styles.card}>
      <Text style={styles.kicker}>{t('cards.quickReview')}</Text>
      <Text style={styles.word}>{entry.word}</Text>
      {entry.cefr ? <Text style={styles.level}>{entry.cefr}</Text> : null}
      {entry.context ? <Text style={styles.contextEn}>{entry.context}</Text> : null}
      {entry.contextZh ? <Text style={styles.contextZh}>{entry.contextZh}</Text> : null}
      <View style={styles.reviewRow}>
        <Pressable
          onPress={() => {
            triggerUiFeedback('error');
            onForgot();
          }}
          style={[styles.reviewButton, styles.reviewButtonGhost]}
        >
          <Text style={styles.reviewButtonGhostText}>{t('cards.forgot')}</Text>
        </Pressable>
        <ActionButton label={t('cards.takeAnotherLook')} onPress={onRemember} style={styles.reviewPrimaryButton} />
      </View>
    </GlassCard>
  );
}

type ProgressCardProps = {
  clipsPlayed: number;
  minutesListened: number;
  newWordsCount: number;
  cefrSegments: { label: string; value: number; color: string; labelColor?: string }[];
  onDismiss: () => void;
};

export function ProgressCard({
  clipsPlayed,
  minutesListened,
  newWordsCount,
  cefrSegments,
  onDismiss,
}: ProgressCardProps) {
  const { colors } = useAppTheme();
  const { t } = useUiI18n();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const total = cefrSegments.reduce((sum, item) => sum + item.value, 0);
  return (
    <View style={styles.progressWrap}>
      <Text style={styles.kicker}>{t('cards.todayProgress')}</Text>
      <View style={styles.primaryStatRow}>
        <Text style={styles.primaryValue}>{clipsPlayed}</Text>
        <Text style={styles.primaryLabel}>{t('cards.clips')}</Text>
      </View>
      <Text style={styles.subtleLabel}>{t('cards.listened')}</Text>
      <View style={styles.secondaryStatRow}>
        <Text style={styles.minutesText}>{t('cards.minutes', { count: minutesListened })}</Text>
        <Text style={styles.wordsText}>{`${newWordsCount} ${t('cards.newWords')}`}</Text>
      </View>
      <View style={styles.segmentBar}>
        {cefrSegments.map(segment => (
          <View
            key={segment.label}
            style={[
              styles.segment,
              {
                backgroundColor: segment.color,
                flex: total > 0 ? Math.max(1, segment.value) : 1,
              },
            ]}
          />
        ))}
      </View>
      <View style={styles.legendRow}>
        {cefrSegments.map(segment => (
          <Text key={`legend-${segment.label}`} style={[styles.legendLabel, { color: segment.labelColor || segment.color }]}>
            {segment.label}
          </Text>
        ))}
      </View>
      <ActionButton label={t('cards.continueSwipe')} onPress={onDismiss} style={styles.progressButton} />
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  kicker: {
    color: colors.textTertiary,
    fontSize: typography.micro,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  word: {
    color: colors.textPrimary,
    fontSize: 30,
    fontWeight: '700',
    textAlign: 'center',
  },
  level: {
    alignSelf: 'center',
    color: colors.textSecondary,
    fontSize: typography.micro,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: colors.bgSurface2,
  },
  contextEn: {
    color: colors.textPrimary,
    fontSize: typography.bodyLg,
    lineHeight: 22,
    textAlign: 'center',
  },
  contextZh: {
    color: colors.textSecondary,
    fontSize: typography.body,
    lineHeight: 20,
    textAlign: 'center',
  },
  reviewRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  reviewButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewButtonGhost: {
    backgroundColor: colors.bgSurface2,
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  reviewButtonGhostText: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  reviewPrimaryButton: {
    flex: 1,
  },
  progressWrap: {
    width: '100%',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 8,
  },
  primaryStatRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  primaryValue: {
    color: colors.accentFeed,
    fontSize: 28,
    fontWeight: '700',
  },
  primaryLabel: {
    color: colors.textSecondary,
    fontSize: typography.body,
  },
  subtleLabel: {
    color: colors.textTertiary,
    fontSize: 13,
  },
  secondaryStatRow: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'center',
  },
  minutesText: {
    color: colors.textSecondary,
    fontSize: typography.body,
  },
  wordsText: {
    color: colors.accentGold,
    fontSize: typography.body,
    fontWeight: '600',
  },
  segmentBar: {
    width: '100%',
    height: 4,
    borderRadius: 999,
    flexDirection: 'row',
    overflow: 'hidden',
    marginTop: 4,
  },
  segment: {
    height: '100%',
  },
  legendRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  legendLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
  progressButton: {
    marginTop: 12,
    width: '100%',
    borderRadius: 24,
    minHeight: 50,
  },
  });
}
