import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { spacing, typography } from '../../design';
import { useAppTheme } from '../../theme';

type Props = {
  label: string;
  hint?: string | number | null;
  style?: StyleProp<ViewStyle>;
};

export function PracticeCardHeader({ label, hint, style }: Props) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={[styles.row, style]}>
      <Text style={styles.label}>{label}</Text>
      {hint !== undefined && hint !== null && hint !== '' ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: spacing.md,
    },
    label: {
      color: colors.accentPractice,
      fontSize: typography.micro,
      fontWeight: '700',
      letterSpacing: 0.9,
      textTransform: 'uppercase',
    },
    hint: {
      color: colors.textTertiary,
      fontSize: typography.caption,
      fontWeight: '500',
    },
  });
}
