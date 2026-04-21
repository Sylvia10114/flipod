import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActionButton } from './AppChrome';
import { radii, spacing, typography } from '../design';
import { triggerUiFeedback } from '../feedback';
import { useUiI18n } from '../i18n';
import { useResponsiveLayout } from '../responsive';
import { useAppTheme } from '../theme';

type Props = {
  visible: boolean;
  onClose: () => void;
};

const GUIDE_SECTIONS = [
  {
    titleKey: 'guide.feedTitle',
    bodyKey: 'guide.feedBody',
  },
  {
    titleKey: 'guide.wordsTitle',
    bodyKey: 'guide.wordsBody',
  },
  {
    titleKey: 'guide.vocabTitle',
    bodyKey: 'guide.vocabBody',
  },
  {
    titleKey: 'guide.practiceTitle',
    bodyKey: 'guide.practiceBody',
  },
] as const;

export function HowItWorksSheet({ visible, onClose }: Props) {
  const { colors, theme } = useAppTheme();
  const { t } = useUiI18n();
  const metrics = useResponsiveLayout();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(() => createStyles(colors, theme), [colors, theme]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <SafeAreaView
          edges={['bottom']}
          style={[
            styles.sheetWrap,
            {
              paddingBottom: Math.max(insets.bottom, 16),
              paddingHorizontal: metrics.pageHorizontalPadding,
            },
          ]}
        >
          <View style={[styles.sheet, { maxWidth: metrics.modalMaxWidth }]}>
            <View style={styles.header}>
              <Text style={styles.eyebrow}>{t('guide.eyebrow')}</Text>
              <Text style={styles.title}>{t('guide.title')}</Text>
              <Text style={styles.subtitle}>{t('guide.subtitle')}</Text>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.sectionList}
            >
              {GUIDE_SECTIONS.map(section => (
                <View key={section.titleKey} style={styles.section}>
                  <Text style={styles.sectionTitle}>{t(section.titleKey)}</Text>
                  <Text style={styles.sectionBody}>{t(section.bodyKey)}</Text>
                </View>
              ))}
            </ScrollView>

            <ActionButton
              label={t('common.close')}
              variant="secondary"
              onPress={() => {
                triggerUiFeedback('menu');
                onClose();
              }}
            />
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function createStyles(
  colors: ReturnType<typeof useAppTheme>['colors'],
  theme: ReturnType<typeof useAppTheme>['theme']
) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: theme === 'dark' ? 'rgba(2, 6, 23, 0.62)' : 'rgba(2, 6, 23, 0.22)',
    },
    sheetWrap: {
      width: '100%',
    },
    sheet: {
      width: '100%',
      alignSelf: 'center',
      gap: spacing.lg,
      paddingTop: spacing.xl,
      paddingBottom: spacing.lg,
      paddingHorizontal: spacing.lg,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.strokeStrong,
      backgroundColor: colors.bgOverlay,
      overflow: 'hidden',
    },
    header: {
      gap: spacing.sm,
    },
    eyebrow: {
      color: colors.textTertiary,
      fontSize: typography.micro,
      lineHeight: 18,
      fontWeight: '700',
      letterSpacing: 0.9,
      textTransform: 'uppercase',
    },
    title: {
      color: colors.textPrimary,
      fontSize: 24,
      lineHeight: 30,
      fontWeight: '700',
    },
    subtitle: {
      color: colors.textSecondary,
      fontSize: typography.body,
      lineHeight: 21,
    },
    sectionList: {
      gap: spacing.sm,
    },
    section: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderRadius: radii.lg,
      backgroundColor: theme === 'dark' ? 'rgba(255,255,255,0.04)' : colors.bgSurface2,
      gap: 6,
    },
    sectionTitle: {
      color: colors.textPrimary,
      fontSize: typography.bodyLg,
      lineHeight: 22,
      fontWeight: '700',
    },
    sectionBody: {
      color: colors.textSecondary,
      fontSize: typography.body,
      lineHeight: 21,
    },
  });
}
