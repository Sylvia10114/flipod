import React from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { radii, spacing } from '../design';
import { triggerUiFeedback } from '../feedback';
import { useResponsiveLayout } from '../responsive';
import { useAppTheme } from '../theme';
import type { HomeMode } from '../types';
import { HomeModeTabs } from './HomeModeTabs';

type Props = {
  mode: HomeMode;
  onChangeMode: (mode: HomeMode) => void;
  onOpenMenu: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
};

export function HomeTopChrome({ mode, onChangeMode, onOpenMenu, onLayout }: Props) {
  const { colors } = useAppTheme();
  const metrics = useResponsiveLayout();
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  return (
    <View onLayout={onLayout} style={styles.outer}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View
          style={[
            styles.inner,
            {
              paddingHorizontal: metrics.pageHorizontalPadding,
              maxWidth: metrics.contentMaxWidth,
            },
          ]}
        >
          <View style={styles.tabsWrap}>
            <HomeModeTabs mode={mode} onChangeMode={onChangeMode} />
          </View>
          <Pressable
            hitSlop={8}
            onPress={() => {
              triggerUiFeedback('menu');
              onOpenMenu();
            }}
            style={({ pressed }) => [
              styles.menuButton,
              pressed && styles.menuButtonPressed,
            ]}
          >
            <Feather name="menu" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    outer: {
      width: '100%',
      zIndex: 3,
      backgroundColor: colors.bgApp,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.stroke,
    },
    safeArea: {
      width: '100%',
    },
    inner: {
      width: '100%',
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
    },
    tabsWrap: {
      flex: 1,
    },
    menuButton: {
      width: 44,
      height: 44,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.bgSurface1,
      borderWidth: 1,
      borderColor: colors.stroke,
    },
    menuButtonPressed: {
      backgroundColor: colors.bgSurface2,
    },
  });
}
