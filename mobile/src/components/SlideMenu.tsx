import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DominantHand, LinkedIdentity, Profile } from '../types';

export type MenuScreen = 'feed' | 'library' | 'practice' | 'vocab';

type Props = {
  visible: boolean;
  profile: Profile;
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
  onLinkPhone: () => void;
  onLinkApple: () => void;
  onLogout: () => void;
  onResetOnboarding: () => void;
};

type MenuItemProps = {
  label: string;
  count?: number;
  active?: boolean;
  onPress: () => void;
};

function MenuItem({ label, count, active, onPress }: MenuItemProps) {
  return (
    <Pressable onPress={onPress} style={[styles.menuItem, active && styles.menuItemActive]}>
      <Text style={[styles.menuItemText, active && styles.menuItemTextActive]}>{label}</Text>
      {typeof count === 'number' ? (
        <View style={[styles.badge, active && styles.badgeActive]}>
          <Text style={[styles.badgeText, active && styles.badgeTextActive]}>{count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function SlideMenu({
  visible,
  profile,
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
  onLinkPhone,
  onLinkApple,
  onLogout,
  onResetOnboarding,
}: Props) {
  const insets = useSafeAreaInsets();
  const hasPhone = linkedIdentities.some(item => item.provider === 'phone');
  const hasApple = linkedIdentities.some(item => item.provider === 'apple');
  const primaryIdentity = linkedIdentities[0];

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <SafeAreaView style={[styles.sheetWrap, dominantHand === 'left' ? styles.sheetWrapRight : styles.sheetWrapLeft]}>
          <View
            style={[
              styles.sheet,
              {
                paddingTop: Math.max(insets.top, 18) + 10,
                paddingBottom: Math.max(insets.bottom, 24),
              },
            ]}
          >
            <View style={styles.header}>
              <View>
                <Text style={styles.greeting}>
                  {primaryIdentity?.provider === 'phone' ? primaryIdentity.displayValue : 'Hi, Learner'}
                </Text>
                <Text style={styles.meta}>{profile.level || 'B1'} · 已听 {clipsPlayed} 个片段</Text>
              </View>
              <Pressable onPress={onClose} style={styles.closeButton}>
                <Text style={styles.closeButtonText}>关闭</Text>
              </Pressable>
            </View>

            <View style={styles.menuList}>
              <MenuItem
                label="继续听"
                active={activeScreen === 'feed'}
                onPress={() => onNavigate('feed')}
              />
              <MenuItem
                label="我的收藏"
                count={bookmarksCount}
                active={activeScreen === 'library'}
                onPress={() => onNavigate('library')}
              />
              <MenuItem
                label="听力练习"
                count={practiceCount}
                active={activeScreen === 'practice'}
                onPress={() => onNavigate('practice')}
              />
              <MenuItem
                label="词汇本"
                count={vocabCount}
                active={activeScreen === 'vocab'}
                onPress={() => onNavigate('vocab')}
              />
            </View>

            <View style={styles.profileCard}>
              <Text style={styles.profileLabel}>学习偏好</Text>
              <Text style={styles.profileValue}>等级：{profile.level || '--'}</Text>
              <Text style={styles.profileTags}>{profile.interests.join(' · ') || '未设置兴趣'}</Text>
            </View>

            <View style={styles.accountCard}>
              <Text style={styles.profileLabel}>账号</Text>
              <Text style={styles.accountMeta}>
                {linkedIdentities.length > 0
                  ? linkedIdentities.map(item => item.provider === 'phone' ? item.displayValue : 'Apple').join(' · ')
                  : '未绑定登录方式'}
              </Text>
              <View style={styles.accountActions}>
                {!hasPhone ? (
                  <Pressable onPress={onLinkPhone} style={styles.accountButton}>
                    <Text style={styles.accountButtonText}>绑定手机号</Text>
                  </Pressable>
                ) : null}
                {!hasApple ? (
                  <Pressable onPress={onLinkApple} style={styles.accountButton}>
                    <Text style={styles.accountButtonText}>绑定 Apple</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.logoutPanel}>
                <View style={styles.logoutCopy}>
                  <Text style={styles.logoutTitle}>退出当前账号</Text>
                  <Text style={styles.logoutHint}>会保留这台手机的设备标识和基础设置，重新登录后可以恢复学习进度。</Text>
                </View>
                <Pressable onPress={onLogout} style={styles.logoutButton}>
                  <Text style={styles.logoutButtonText}>退出登录</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.footer}>
              <Pressable onPress={onToggleHand} style={styles.footerButton}>
                <Text style={styles.footerButtonText}>{dominantHand === 'left' ? '切回右手模式' : '左手模式'}</Text>
              </Pressable>
              <Pressable onPress={onResetOnboarding} style={styles.footerButton}>
                <Text style={styles.footerButtonText}>重置引导</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.46)',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetWrap: {
    flex: 1,
    maxWidth: 360,
  },
  sheetWrapLeft: {
    alignSelf: 'flex-start',
  },
  sheetWrapRight: {
    alignSelf: 'flex-end',
  },
  sheet: {
    flex: 1,
    backgroundColor: '#101018',
    borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    paddingHorizontal: 18,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  greeting: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
  },
  meta: {
    color: 'rgba(255,255,255,0.56)',
    fontSize: 13,
    marginTop: 4,
  },
  closeButton: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  closeButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  menuList: {
    marginTop: 26,
    gap: 10,
  },
  menuItem: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  menuItemActive: {
    borderColor: '#8B9CF7',
    backgroundColor: 'rgba(139,156,247,0.14)',
  },
  menuItemText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  menuItemTextActive: {
    color: '#E7EAFF',
  },
  badge: {
    minWidth: 30,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  badgeActive: {
    backgroundColor: '#8B9CF7',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  badgeTextActive: {
    color: '#09090B',
  },
  profileCard: {
    marginTop: 22,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 18,
    backgroundColor: 'rgba(139,156,247,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(139,156,247,0.22)',
    gap: 8,
  },
  profileLabel: {
    color: '#8B9CF7',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  profileValue: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  profileTags: {
    color: 'rgba(255,255,255,0.56)',
    fontSize: 13,
    lineHeight: 18,
  },
  accountCard: {
    marginTop: 18,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 18,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 10,
  },
  accountMeta: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  accountActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  accountButton: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(139,156,247,0.16)',
  },
  accountButtonText: {
    color: '#E7EAFF',
    fontSize: 13,
    fontWeight: '600',
  },
  logoutPanel: {
    marginTop: 4,
    borderRadius: 18,
    padding: 14,
    backgroundColor: 'rgba(248,113,113,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.18)',
    gap: 12,
  },
  logoutCopy: {
    gap: 6,
  },
  logoutTitle: {
    color: '#FECACA',
    fontSize: 14,
    fontWeight: '700',
  },
  logoutHint: {
    color: 'rgba(255,255,255,0.58)',
    fontSize: 12,
    lineHeight: 18,
  },
  logoutButton: {
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: 'rgba(248,113,113,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.22)',
  },
  logoutButtonText: {
    color: '#FCA5A5',
    fontSize: 14,
    fontWeight: '700',
  },
  footer: {
    marginTop: 'auto',
    gap: 10,
  },
  footerButton: {
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  footerButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
