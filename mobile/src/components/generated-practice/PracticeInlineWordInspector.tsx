import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radii, spacing, typography } from '../../design';
import { useAppTheme } from '../../theme';
import { ActionButton, GlassCard } from '../AppChrome';

type Props = {
  word: string;
  cefr?: string;
  ipa?: string;
  definition: string;
  context: string;
  saved: boolean;
  known: boolean;
  saveLabel: string;
  savedLabel: string;
  markKnownLabel: string;
  knownLabel: string;
  onClose: () => void;
  onSave: () => void;
  onMarkKnown: () => void;
};

export function PracticeInlineWordInspector({
  word,
  cefr,
  ipa,
  definition,
  context,
  saved,
  known,
  saveLabel,
  savedLabel,
  markKnownLabel,
  knownLabel,
  onClose,
  onSave,
  onMarkKnown,
}: Props) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  return (
    <GlassCard style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.copy}>
          <View style={styles.titleRow}>
            <Text style={styles.word}>{word}</Text>
            {cefr ? <Text style={styles.badge}>{cefr}</Text> : null}
          </View>
          {ipa ? <Text style={styles.phonetic}>{ipa}</Text> : null}
        </View>
        <Pressable
          hitSlop={8}
          onPress={onClose}
          style={styles.closeButton}
        >
          <Text style={styles.closeButtonText}>×</Text>
        </Pressable>
      </View>
      <Text style={styles.definition}>{definition}</Text>
      <Text style={styles.context}>{context}</Text>
      <View style={styles.actions}>
        <ActionButton
          label={saved ? savedLabel : saveLabel}
          variant={saved ? 'secondary' : 'primary'}
          onPress={onSave}
          style={styles.action}
        />
        <ActionButton
          label={known ? knownLabel : markKnownLabel}
          variant={known ? 'secondary' : 'success'}
          onPress={onMarkKnown}
          style={styles.action}
        />
      </View>
    </GlassCard>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    card: {
      gap: spacing.md,
      backgroundColor: 'rgba(31,24,47,0.96)',
      borderColor: 'rgba(168,85,247,0.22)',
    },
    topRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: spacing.md,
    },
    copy: {
      flex: 1,
      gap: spacing.xs,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      flexWrap: 'wrap',
    },
    word: {
      color: colors.textPrimary,
      fontSize: 24,
      fontWeight: '700',
    },
    badge: {
      color: colors.accentPractice,
      fontSize: typography.caption,
      fontWeight: '700',
    },
    phonetic: {
      color: colors.textSecondary,
      fontSize: typography.caption,
    },
    closeButton: {
      width: 28,
      height: 28,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.bgSurface2,
    },
    closeButtonText: {
      color: colors.textSecondary,
      fontSize: typography.bodyLg,
      fontWeight: '700',
    },
    definition: {
      color: colors.textPrimary,
      fontSize: typography.body,
      lineHeight: 21,
      fontWeight: '600',
    },
    context: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      lineHeight: 18,
    },
    actions: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    action: {
      flex: 1,
    },
  });
}
