import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActionButton, GlassCard } from './AppChrome';
import { radii, spacing, typography } from '../design';
import { triggerUiFeedback } from '../feedback';
import { useUiI18n } from '../i18n';
import { joinLocalizedTopics } from '../i18n/helpers';
import { useResponsiveLayout } from '../responsive';
import { useAppTheme } from '../theme';
import type { LinkedIdentity, Profile } from '../types';

export type MenuScreen = 'feed' | 'library' | 'practice' | 'vocab' | 'account';

type Props = {
  visible: boolean;
  profile: Profile;
  isGuest: boolean;
  activeScreen: MenuScreen;
  linkedIdentities: LinkedIdentity[];
  bookmarksCount: number;
  vocabCount: number;
  clipsPlayed: number;
  onClose: () => void;
  onNavigate: (screen: MenuScreen) => void;
  onOpenGuide: () => void;
  onToggleTheme: () => void;
  onResetOnboarding: () => void;
};

type MenuItemProps = {
  label: string;
  count?: number;
  active?: boolean;
  onPress: () => void;
};

function MenuItem({ label, count, active, onPress }: MenuItemProps) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable onPress={onPress} style={[styles.menuItem, active && styles.menuItemActive]}>
      <Text style={[styles.menuItemText, active && styles.menuItemTextActive]}>{label}</Text>
      {typeof count === 'number' ? <Text style={[styles.menuItemCount, active && styles.menuItemTextActive]}>{count}</Text> : null}
    </Pressable>
  );
}

export function SlideMenu({
  visible,
  profile,
  isGuest,
  activeScreen,
  linkedIdentities,
  bookmarksCount,
  vocabCount,
  clipsPlayed,
  onClose,
  onNavigate,
  onOpenGuide,
  onToggleTheme,
  onResetOnboarding,
}: Props) {
  const { colors, theme } = useAppTheme();
  const { t } = useUiI18n();
  const metrics = useResponsiveLayout();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const interestText = profile.interests.length > 0
    ? joinLocalizedTopics(profile.interests, t)
    : t('menu.noInterests');
  const linkedIdentityLabels = linkedIdentities.map(item => (
    item.provider === 'phone' ? item.displayValue : t('account.appleProvider')
  ));

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <SafeAreaView
          style={[
            styles.sheetWrap,
            styles.sheetWrapLeft,
            { width: metrics.menuWidth, maxWidth: metrics.menuWidth },
            { paddingTop: Math.max(insets.top, 16), paddingBottom: Math.max(insets.bottom, 20) },
          ]}
        >
          <View style={[styles.sheet, { paddingHorizontal: metrics.isTablet ? spacing.xl : spacing.lg }]}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
              <View style={styles.header}>
                <View style={styles.headerCopy}>
                  <Text style={styles.greeting}>{t('menu.greeting')}</Text>
                  <Text style={styles.meta}>
                    {profile.level || 'B1'} · {t('menu.listenedCount', { count: clipsPlayed })}
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    triggerUiFeedback('menu');
                    onClose();
                  }}
                  style={styles.closeButton}
                >
                  <Text style={styles.closeButtonText}>x</Text>
                </Pressable>
              </View>

              <View style={styles.menuList}>
                <MenuItem
                  label={t('menu.continueListening')}
                  active={activeScreen === 'feed'}
                  onPress={() => {
                    triggerUiFeedback('menu');
                    onNavigate('feed');
                  }}
                />
                <MenuItem
                  label={t('menu.practice')}
                  active={activeScreen === 'practice'}
                  onPress={() => {
                    triggerUiFeedback('menu');
                    onNavigate('practice');
                  }}
                />
                <MenuItem
                  label={t('menu.savedClips')}
                  count={bookmarksCount}
                  active={activeScreen === 'library'}
                  onPress={() => {
                    triggerUiFeedback('menu');
                    onNavigate('library');
                  }}
                />
                <MenuItem
                  label={t('menu.vocab')}
                  count={vocabCount}
                  active={activeScreen === 'vocab'}
                  onPress={() => {
                    triggerUiFeedback('menu');
                    onNavigate('vocab');
                  }}
                />
                <MenuItem
                  label={t('menu.howItWorks')}
                  onPress={() => {
                    triggerUiFeedback('menu');
                    onOpenGuide();
                  }}
                />
              </View>

              <GlassCard style={styles.profileCard}>
                <Text style={styles.cardLabel}>{t('menu.learningPreferences')}</Text>
                <Text style={styles.cardValue}>CEFR: {profile.level || 'B1'}</Text>
                <Text style={styles.cardMeta}>{interestText}</Text>
              </GlassCard>

              <Pressable
                onPress={() => {
                  triggerUiFeedback('menu');
                  onNavigate('account');
                }}
              >
                <GlassCard style={styles.accountCard}>
                  <View style={styles.accountCardTop}>
                    <View style={styles.accountCardCopy}>
                      <Text style={styles.cardLabel}>{t('menu.account')}</Text>
                      <Text style={styles.cardValue}>{t('menu.openAccount')}</Text>
                    </View>
                    <Text style={styles.accountChevron}>›</Text>
                  </View>
                  <Text style={styles.cardMeta}>
                    {isGuest
                      ? t('menu.accountGuestBody')
                      : linkedIdentities.length > 0
                        ? linkedIdentityLabels.join(' · ')
                        : t('menu.accountManageBody')}
                  </Text>
                </GlassCard>
              </Pressable>

              <View style={styles.footer}>
                <ActionButton
                  label={theme === 'light' ? t('menu.switchToDarkMode') : t('menu.switchToLightMode')}
                  variant="secondary"
                  onPress={() => {
                    triggerUiFeedback('menu');
                    onToggleTheme();
                  }}
                />
                <ActionButton
                  label={t('menu.resetOnboarding')}
                  variant="secondary"
                  onPress={() => {
                    triggerUiFeedback('menu');
                    onResetOnboarding();
                  }}
                />
              </View>
            </ScrollView>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.bgDim,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetWrap: {
    flex: 1,
  },
  sheetWrapLeft: {
    alignSelf: 'flex-start',
  },
  sheetWrapRight: {
    alignSelf: 'flex-end',
  },
  sheet: {
    flex: 1,
    backgroundColor: colors.bgOverlay,
    borderRightWidth: 1,
    borderRightColor: colors.stroke,
    paddingHorizontal: spacing.lg,
  },
  scrollContent: {
    gap: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingTop: 12,
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  greeting: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
  },
  meta: {
    color: colors.textSecondary,
    fontSize: typography.caption,
  },
  closeButton: {
    width: 44,
    height: 44,
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
  menuList: {
    gap: spacing.xs,
  },
  menuItem: {
    minHeight: 46,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  menuItemActive: {
    backgroundColor: colors.bgSurface2,
  },
  menuItemText: {
    color: colors.textSecondary,
    fontSize: typography.body,
    fontWeight: '600',
  },
  menuItemTextActive: {
    color: colors.textPrimary,
  },
  menuItemCount: {
    color: colors.textTertiary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  profileCard: {
    gap: spacing.sm,
  },
  accountCard: {
    gap: spacing.sm,
  },
  accountCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  accountCardCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  accountChevron: {
    color: colors.textTertiary,
    fontSize: 24,
    fontWeight: '600',
    lineHeight: 24,
  },
  cardLabel: {
    color: colors.textTertiary,
    fontSize: typography.micro,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  cardValue: {
    color: colors.textPrimary,
    fontSize: typography.title,
    fontWeight: '700',
  },
  cardMeta: {
    color: colors.textSecondary,
    fontSize: typography.body,
    lineHeight: 20,
  },
  footer: {
    gap: spacing.sm,
    paddingBottom: spacing.lg,
  },
  });
}
