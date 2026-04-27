import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ActionButton, GlassCard, ScreenSurface } from '../components/AppChrome';
import { radii, spacing, typography } from '../design';
import { triggerUiFeedback } from '../feedback';
import { useUiI18n } from '../i18n';
import { useResponsiveLayout } from '../responsive';
import { useAppTheme } from '../theme';

type Props = {
  onContinue: () => void;
};

const GUIDE_CARDS = [
  {
    icon: 'headphones',
    titleKey: 'starterGuide.cardListenTitle',
    bodyKey: 'starterGuide.cardListenBody',
  },
  {
    icon: 'book-open',
    titleKey: 'starterGuide.cardTapTitle',
    bodyKey: 'starterGuide.cardTapBody',
  },
  {
    icon: 'layers',
    titleKey: 'starterGuide.cardPracticeTitle',
    bodyKey: 'starterGuide.cardPracticeBody',
  },
] as const;

export function FirstUseBridgeScreen({ onContinue }: Props) {
  const { colors } = useAppTheme();
  const { t } = useUiI18n();
  const metrics = useResponsiveLayout();
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  return (
    <ScreenSurface edges={['top', 'left', 'right', 'bottom']} style={styles.surface}>
      <View
        style={[
          styles.content,
          {
            paddingHorizontal: metrics.pageHorizontalPadding,
            maxWidth: metrics.contentMaxWidth,
          },
        ]}
      >
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>{t('starterGuide.eyebrow')}</Text>
          <Text style={styles.title}>{t('starterGuide.title')}</Text>
          <Text style={styles.subtitle}>{t('starterGuide.subtitle')}</Text>
        </View>

        <View style={styles.cardList}>
          {GUIDE_CARDS.map(card => (
            <GlassCard key={card.titleKey} style={styles.card}>
              <View style={styles.cardIconWrap}>
                <Feather name={card.icon} size={18} color={colors.textPrimary} />
              </View>
              <View style={styles.cardCopy}>
                <Text style={styles.cardTitle}>{t(card.titleKey)}</Text>
                <Text style={styles.cardBody}>{t(card.bodyKey)}</Text>
              </View>
            </GlassCard>
          ))}
        </View>

        <ActionButton
          label={t('starterGuide.primaryCta')}
          onPress={() => {
            triggerUiFeedback('primary');
            onContinue();
          }}
          style={styles.cta}
        />
      </View>
    </ScreenSurface>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    surface: {
      backgroundColor: colors.bgApp,
    },
    content: {
      flex: 1,
      width: '100%',
      alignSelf: 'center',
      justifyContent: 'center',
      gap: spacing.xl,
      paddingVertical: spacing.xxl,
    },
    hero: {
      gap: spacing.md,
      alignItems: 'center',
    },
    eyebrow: {
      color: colors.textTertiary,
      fontSize: typography.micro,
      lineHeight: 18,
      letterSpacing: 1.1,
      fontWeight: '700',
      textTransform: 'uppercase',
      textAlign: 'center',
    },
    title: {
      color: colors.textPrimary,
      fontSize: 28,
      lineHeight: 34,
      fontWeight: '700',
      textAlign: 'center',
    },
    subtitle: {
      color: colors.textSecondary,
      fontSize: typography.body,
      lineHeight: 22,
      textAlign: 'center',
      maxWidth: 360,
    },
    cardList: {
      gap: spacing.md,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      paddingVertical: spacing.lg,
    },
    cardIconWrap: {
      width: 42,
      height: 42,
      borderRadius: radii.lg,
      backgroundColor: colors.bgSurface2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardCopy: {
      flex: 1,
      gap: 6,
    },
    cardTitle: {
      color: colors.textPrimary,
      fontSize: typography.bodyLg,
      lineHeight: 22,
      fontWeight: '700',
    },
    cardBody: {
      color: colors.textSecondary,
      fontSize: typography.body,
      lineHeight: 21,
    },
    cta: {
      marginTop: spacing.sm,
    },
  });
}
