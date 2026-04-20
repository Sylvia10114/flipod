import React, { type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, radii, typography } from '../../design';
import { useResponsiveLayout } from '../../responsive';
import { useAppTheme } from '../../theme';
import { StepDots } from '../AppChrome';

type Props = {
  visible: boolean;
  title: string;
  cefr?: string | null;
  step: number;
  stepCount?: number;
  stepLabel: string;
  stepTitle: string;
  stepBody: string;
  onClose: () => void;
  children: ReactNode;
};

export function PracticeStudioShell({
  visible,
  title,
  cefr,
  step,
  stepCount = 4,
  stepLabel,
  stepTitle,
  stepBody,
  onClose,
  children,
}: Props) {
  const { colors } = useAppTheme();
  const metrics = useResponsiveLayout();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
        <View
          style={[
            styles.header,
            {
              paddingTop: Math.max(insets.top + 8, 16),
              paddingHorizontal: metrics.pageHorizontalPadding,
            },
          ]}
        >
          <View style={[styles.headerInner, { maxWidth: metrics.modalMaxWidth }]}>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={styles.closeButton}
            >
              <Text style={styles.closeButtonText}>×</Text>
            </Pressable>
            <View style={styles.headerCopy}>
              <Text style={styles.headerLabel}>{stepLabel}</Text>
              <Text numberOfLines={1} style={styles.headerTitle}>{title}</Text>
            </View>
            <Text style={styles.headerMeta}>{cefr || ''}</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={[
            styles.body,
            {
              paddingHorizontal: metrics.pageHorizontalPadding,
              paddingBottom: Math.max(insets.bottom + 32, 32),
              maxWidth: metrics.modalMaxWidth,
              alignSelf: 'center',
              width: '100%',
            },
          ]}
        >
          <StepDots active={step} count={stepCount} accent={colors.accentPractice} />

          <View style={styles.stepIntro}>
            <Text style={styles.stepEyebrow}>{stepLabel}</Text>
            <Text style={styles.stepTitle}>{stepTitle}</Text>
            <Text style={styles.stepBody}>{stepBody}</Text>
          </View>

          {children}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.bgApp,
    },
    header: {
      zIndex: 2,
      paddingBottom: spacing.sm,
    },
    headerInner: {
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      alignSelf: 'center',
    },
    closeButton: {
      width: 44,
      height: 44,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.bgSurface2,
      borderWidth: 1,
      borderColor: colors.strokeStrong,
    },
    closeButtonText: {
      color: colors.textPrimary,
      fontSize: 26,
      lineHeight: 28,
      fontWeight: '500',
    },
    headerCopy: {
      flex: 1,
      gap: 3,
      minWidth: 0,
    },
    headerLabel: {
      color: colors.textSecondary,
      fontSize: typography.micro,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    headerTitle: {
      color: colors.textPrimary,
      fontSize: typography.body,
      fontWeight: '600',
    },
    headerMeta: {
      minWidth: 44,
      color: colors.textSecondary,
      fontSize: typography.caption,
      fontWeight: '600',
      textAlign: 'right',
    },
    body: {
      gap: spacing.lg,
    },
    stepIntro: {
      gap: spacing.xs,
    },
    stepEyebrow: {
      color: colors.accentPractice,
      fontSize: typography.micro,
      fontWeight: '700',
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    stepTitle: {
      color: colors.textPrimary,
      fontSize: 30,
      lineHeight: 34,
      fontWeight: '800',
    },
    stepBody: {
      color: colors.textSecondary,
      fontSize: typography.body,
      lineHeight: 22,
    },
  });
}
