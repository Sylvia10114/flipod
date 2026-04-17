import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radii, spacing, typography } from '../design';
import { getNativeLanguageOptions } from '../i18n';
import { useResponsiveLayout } from '../responsive';
import { useAppTheme } from '../theme';
import type { NativeLanguage } from '../types';

type Props = {
  selectedLanguage?: NativeLanguage | null;
  onSelect: (language: NativeLanguage) => void;
  trailingMode?: 'chevron' | 'check';
};

export function LanguageSelectionList({
  selectedLanguage,
  onSelect,
  trailingMode = 'chevron',
}: Props) {
  const { colors } = useAppTheme();
  const metrics = useResponsiveLayout();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const languageOptions = React.useMemo(() => getNativeLanguageOptions(), []);

  return (
    <View style={[styles.list, { maxWidth: metrics.modalMaxWidth, alignSelf: 'center' }]}>
      {languageOptions.map(option => {
        const isSelected = option.code === selectedLanguage;
        return (
          <Pressable
            key={option.code}
            onPress={() => onSelect(option.code)}
            style={[
              styles.row,
              {
                minHeight: metrics.isTablet ? 80 : 72,
                paddingHorizontal: metrics.isTablet ? 22 : 18,
                paddingVertical: metrics.isTablet ? 18 : 16,
              },
              isSelected && styles.rowSelected,
            ]}
            hitSlop={6}
          >
            <View style={styles.copy}>
              <Text style={styles.primary}>{option.selfLabel}</Text>
              {option.englishLabel !== option.selfLabel ? (
                <Text style={styles.secondary}>{option.englishLabel}</Text>
              ) : null}
            </View>

            <View style={styles.trailingWrap}>
              {trailingMode === 'check' ? (
                <Text style={[styles.trailing, isSelected ? styles.trailingSelected : styles.trailingMuted]}>
                  {isSelected ? '✓' : ''}
                </Text>
              ) : (
                <Text style={styles.trailing}>›</Text>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    list: {
      width: '100%',
      gap: spacing.sm,
    },
    row: {
      width: '100%',
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 18,
      paddingVertical: 16,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.strokeStrong,
      backgroundColor: colors.bgSurface1,
    },
    rowSelected: {
      borderColor: `${colors.accentFeed}88`,
      backgroundColor: `${colors.accentFeed}12`,
    },
    copy: {
      flex: 1,
      gap: 4,
      paddingRight: spacing.md,
    },
    primary: {
      color: colors.textPrimary,
      fontSize: typography.bodyLg,
      fontWeight: '700',
    },
    secondary: {
      color: colors.textSecondary,
      fontSize: typography.caption,
    },
    trailingWrap: {
      width: 24,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    trailing: {
      color: colors.textTertiary,
      fontSize: 24,
      fontWeight: '500',
    },
    trailingSelected: {
      color: colors.accentFeed,
      fontSize: 20,
      fontWeight: '800',
    },
    trailingMuted: {
      color: colors.textFaint,
      fontSize: 20,
    },
  });
}
