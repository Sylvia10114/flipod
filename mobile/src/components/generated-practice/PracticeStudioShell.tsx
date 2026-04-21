import React, { type ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, radii } from '../../design';
import { useResponsiveLayout } from '../../responsive';
import { useAppTheme } from '../../theme';
import { ActionButton, GlassCard } from '../AppChrome';
import { StepDots } from '../AppChrome';

type Props = {
  visible: boolean;
  step: number;
  stepCount?: number;
  onClose: () => void;
  closeLabel: string;
  children: ReactNode;
};

export function PracticeStudioShell({
  visible,
  step,
  stepCount = 4,
  onClose,
  closeLabel,
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
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.body,
            {
              paddingTop: Math.max(insets.top + 18, 24),
              paddingHorizontal: metrics.pageHorizontalPadding,
              paddingBottom: Math.max(insets.bottom + 28, 36),
              maxWidth: metrics.modalMaxWidth,
              alignSelf: 'center',
              width: '100%',
            },
          ]}
        >
          {stepCount > 1 ? (
            <View style={styles.dotsWrap}>
              <StepDots active={step} count={stepCount} accent={colors.accentPractice} />
            </View>
          ) : null}

          {children}
        </ScrollView>

        <View
          style={[
            styles.footer,
            {
              paddingHorizontal: metrics.pageHorizontalPadding,
              paddingBottom: Math.max(insets.bottom + 12, 16),
              paddingTop: spacing.sm,
            },
          ]}
        >
          <GlassCard style={[styles.footerCard, { maxWidth: metrics.modalMaxWidth }]}>
            <ActionButton
              label={closeLabel}
              onPress={onClose}
              variant="secondary"
              style={styles.closeAction}
            />
          </GlassCard>
        </View>
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
    scroll: {
      flex: 1,
    },
    body: {
      gap: spacing.lg,
    },
    dotsWrap: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    footer: {
      alignItems: 'center',
      borderTopWidth: 1,
      borderTopColor: colors.stroke,
      backgroundColor: colors.bgApp,
    },
    footerCard: {
      width: '100%',
      padding: spacing.xs,
      borderRadius: radii.xl,
      backgroundColor: colors.bgSurface1,
      borderColor: colors.strokeStrong,
    },
    closeAction: {
      width: '100%',
    },
  });
}
