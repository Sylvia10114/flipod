import React from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { radii, spacing, typography } from '../design';
import { triggerUiFeedback } from '../feedback';
import { useUiI18n } from '../i18n';
import { useResponsiveLayout } from '../responsive';
import { useAppTheme } from '../theme';

type Props = {
  onOpenMenu: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
};

export function HomeTopChrome({ onOpenMenu, onLayout }: Props) {
  const { colors } = useAppTheme();
  const { t } = useUiI18n();
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
          <View style={styles.titleWrap}>
            <Text style={styles.title}>{t('home.learnTab')}</Text>
            <View style={styles.titleUnderline} />
          </View>
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
    titleWrap: {
      flex: 1,
      alignItems: 'center',
      gap: 6,
      paddingRight: 44,
    },
    title: {
      color: colors.textPrimary,
      fontSize: typography.body,
      fontWeight: '800',
    },
    titleUnderline: {
      width: 132,
      height: 3,
      borderRadius: 999,
      backgroundColor: colors.textPrimary,
    },
    menuButton: {
      width: 44,
      height: 44,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    menuButtonPressed: {
      backgroundColor: colors.bgSurface1,
    },
  });
}
