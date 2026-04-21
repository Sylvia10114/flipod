import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radii, spacing, typography } from '../design';
import { triggerUiFeedback } from '../feedback';
import { useUiI18n } from '../i18n';
import { useResponsiveLayout } from '../responsive';
import { useAppTheme } from '../theme';
import type { HomeMode } from '../types';

type Props = {
  mode: HomeMode;
  onChangeMode: (mode: HomeMode) => void;
};

export function HomeModeTabs({ mode, onChangeMode }: Props) {
  const { colors } = useAppTheme();
  const { t } = useUiI18n();
  const metrics = useResponsiveLayout();
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  const items: Array<{ key: HomeMode; label: string }> = [
    { key: 'listen', label: t('home.listenTab') },
    { key: 'learn', label: t('home.learnTab') },
  ];

  return (
    <View style={[styles.wrap, { paddingHorizontal: metrics.isTablet ? 8 : 4 }]}>
      {items.map(item => {
        const active = item.key === mode;
        return (
          <Pressable
            key={item.key}
            onPress={() => {
              if (active) return;
              triggerUiFeedback('menu');
              onChangeMode(item.key);
            }}
            style={({ pressed }) => [
              styles.tab,
              pressed && styles.tabPressed,
            ]}
          >
            <Text style={[styles.tabText, active && styles.tabTextActive]}>{item.label}</Text>
            <View style={[styles.tabUnderline, active && styles.tabUnderlineActive]} />
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    wrap: {
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingTop: 2,
    },
    tab: {
      flex: 1,
      minHeight: 34,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      gap: 6,
    },
    tabPressed: {
      opacity: 0.78,
    },
    tabText: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      fontWeight: '700',
    },
    tabTextActive: {
      color: colors.textPrimary,
    },
    tabUnderline: {
      width: '100%',
      height: 2,
      borderRadius: 999,
      backgroundColor: 'transparent',
    },
    tabUnderlineActive: {
      backgroundColor: colors.textPrimary,
    },
  });
}
