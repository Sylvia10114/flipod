import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActionButton, GlassCard } from './AppChrome';
import { radii, spacing, typography } from '../design';
import { triggerUiFeedback } from '../feedback';
import { useAppTheme } from '../theme';
import type { DominantHand, LinkedIdentity, Profile } from '../types';

export type MenuScreen = 'feed' | 'library' | 'practice' | 'vocab' | 'account';

type Props = {
  visible: boolean;
  profile: Profile;
  isGuest: boolean;
  dominantHand: DominantHand;
  activeScreen: MenuScreen;
  linkedIdentities: LinkedIdentity[];
  bookmarksCount: number;
  practiceCount: number;
  vocabCount: number;
  clipsPlayed: number;
  onClose: () => void;
  onNavigate: (screen: MenuScreen) => void;
  onToggleHand: () => void;
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
  dominantHand,
  activeScreen,
  linkedIdentities,
  bookmarksCount,
  practiceCount,
  vocabCount,
  clipsPlayed,
  onClose,
  onNavigate,
  onToggleHand,
  onToggleTheme,
  onResetOnboarding,
}: Props) {
  const { colors, theme } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const interestText = profile.interests.length > 0 ? profile.interests.join(', ') : '未设置兴趣';

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <SafeAreaView
          style={[
            styles.sheetWrap,
            dominantHand === 'left' ? styles.sheetWrapRight : styles.sheetWrapLeft,
            { paddingTop: Math.max(insets.top, 16), paddingBottom: Math.max(insets.bottom, 20) },
          ]}
        >
          <View style={styles.sheet}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
              <View style={styles.header}>
                <View style={styles.headerCopy}>
                  <Text style={styles.greeting}>
                    Hi, Learner
                  </Text>
                  <Text style={styles.meta}>{profile.level || 'B1'} · 已听 {clipsPlayed} 个片段</Text>
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
                  label="继续听"
                  active={activeScreen === 'feed'}
                  onPress={() => {
                    triggerUiFeedback('menu');
                    onNavigate('feed');
                  }}
                />
                <MenuItem
                  label="我的收藏"
                  count={bookmarksCount}
                  active={activeScreen === 'library'}
                  onPress={() => {
                    triggerUiFeedback('menu');
                    onNavigate('library');
                  }}
                />
                <MenuItem
                  label="听力练习"
                  count={practiceCount}
                  active={activeScreen === 'practice'}
                  onPress={() => {
                    triggerUiFeedback('menu');
                    onNavigate('practice');
                  }}
                />
                <MenuItem
                  label="词汇本"
                  count={vocabCount}
                  active={activeScreen === 'vocab'}
                  onPress={() => {
                    triggerUiFeedback('menu');
                    onNavigate('vocab');
                  }}
                />
              </View>

              <GlassCard style={styles.profileCard}>
                <Text style={styles.cardLabel}>学习偏好</Text>
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
                      <Text style={styles.cardLabel}>账号</Text>
                      <Text style={styles.cardValue}>进入账号页</Text>
                    </View>
                    <Text style={styles.accountChevron}>›</Text>
                  </View>
                  <Text style={styles.cardMeta}>
                    {isGuest
                      ? '当前为 Guest，可随时登录把本机进度保存到云端'
                      : linkedIdentities.length > 0
                      ? linkedIdentities.map(item => item.provider === 'phone' ? item.displayValue : 'Apple').join(' · ')
                      : '查看绑定方式、退出登录和注销账号'}
                  </Text>
                </GlassCard>
              </Pressable>

              <View style={styles.footer}>
                <ActionButton
                  label={theme === 'light' ? '切换深色' : '切换浅色'}
                  variant="secondary"
                  onPress={() => {
                    triggerUiFeedback('menu');
                    onToggleTheme();
                  }}
                />
                <ActionButton
                  label={dominantHand === 'left' ? '切回右手模式' : '左手模式'}
                  variant="secondary"
                  onPress={() => {
                    triggerUiFeedback('menu');
                    onToggleHand();
                  }}
                />
                <ActionButton
                  label="重置引导"
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
    maxWidth: 320,
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
    width: 30,
    height: 30,
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
