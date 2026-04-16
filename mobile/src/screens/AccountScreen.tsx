import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionButton, GlassCard, PillButton, ScreenHeader, ScreenSurface } from '../components/AppChrome';
import { spacing, typography } from '../design';
import { triggerUiFeedback } from '../feedback';
import { getNativeLanguageOptions, useUiI18n } from '../i18n';
import { useAppTheme } from '../theme';
import type { LinkedIdentity, NativeLanguage, Profile } from '../types';

type Props = {
  profile: Profile;
  isGuest: boolean;
  linkedIdentities: LinkedIdentity[];
  onBack: () => void;
  onLinkPhone: () => void;
  onLinkApple: () => void;
  onLogout: () => void;
  onDeleteAccount: () => Promise<void> | void;
  onEndGuestMode: () => void;
  onChangeNativeLanguage: (nativeLanguage: NativeLanguage) => void;
};

function getIdentityLabel(identity: LinkedIdentity) {
  return identity.provider === 'phone' ? '手机号' : 'Apple';
}

export function AccountScreen({
  profile,
  isGuest,
  linkedIdentities,
  onBack,
  onLinkPhone,
  onLinkApple,
  onLogout,
  onDeleteAccount,
  onEndGuestMode,
  onChangeNativeLanguage,
}: Props) {
  const { colors } = useAppTheme();
  const { t } = useUiI18n();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const hasPhone = linkedIdentities.some(item => item.provider === 'phone');
  const hasApple = linkedIdentities.some(item => item.provider === 'apple');
  const languageOptions = React.useMemo(() => getNativeLanguageOptions(), []);

  const confirmLogout = React.useCallback(() => {
    Alert.alert('退出登录', '会退出当前账号，但不会删除云端资料。', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出登录',
        style: 'destructive',
        onPress: () => {
          triggerUiFeedback('error');
          onLogout();
        },
      },
    ]);
  }, [onLogout]);

  const confirmDeleteAccount = React.useCallback(() => {
    Alert.alert('注销账号', '会删除当前账号及云端学习资料，这个操作无法恢复。', [
      { text: '取消', style: 'cancel' },
      {
        text: '注销账号',
        style: 'destructive',
        onPress: () => {
          triggerUiFeedback('error');
          void onDeleteAccount();
        },
      },
    ]);
  }, [onDeleteAccount]);

  const confirmEndGuestMode = React.useCallback(() => {
    Alert.alert('返回登录页', '会退出当前 Guest 会话并回到登录页，本机数据会暂时保留。', [
      { text: '取消', style: 'cancel' },
      {
        text: '返回登录页',
        style: 'destructive',
        onPress: () => {
          triggerUiFeedback('menu');
          onEndGuestMode();
        },
      },
    ]);
  }, [onEndGuestMode]);

  return (
    <ScreenSurface>
      <ScreenHeader
        leading={<PillButton label="返回" onPress={() => {
          triggerUiFeedback('menu');
          onBack();
        }} />}
        title="账号"
        subtitle={isGuest ? '当前是 Guest 模式，可随时登录保存到云端' : '管理登录方式、主题偏好和账号动作'}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <GlassCard style={styles.heroCard}>
          <Text style={styles.heroTitle}>{isGuest ? 'Guest' : 'Hi, Learner'}</Text>
          <Text style={styles.heroBody}>
            {isGuest
              ? `当前等级 ${profile.level || 'B1'} · 收藏、词汇和练习会先保存在本机`
              : `当前等级 ${profile.level || 'B1'} · 已绑定 ${linkedIdentities.length} 种登录方式`}
          </Text>
        </GlassCard>

        <GlassCard style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>{t('account.languageSectionTitle')}</Text>
          <Text style={styles.sectionBody}>{t('account.languageSectionBody')}</Text>
          <View style={styles.languageWrap}>
            {languageOptions.map(option => {
              const selected = profile.nativeLanguage === option.code;
              return (
                <PillButton
                  key={option.code}
                  label={option.selfLabel}
                  subtle={!selected}
                  onPress={() => {
                    triggerUiFeedback('menu');
                    onChangeNativeLanguage(option.code);
                  }}
                />
              );
            })}
          </View>
        </GlassCard>

        <GlassCard style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>{isGuest ? '当前身份' : '已绑定登录方式'}</Text>
          {!isGuest && linkedIdentities.length > 0 ? (
            <View style={styles.identityList}>
              {linkedIdentities.map(identity => (
                <View key={`${identity.provider}-${identity.providerUserId}`} style={styles.identityRow}>
                  <View style={styles.identityCopy}>
                    <Text style={styles.identityLabel}>{getIdentityLabel(identity)}</Text>
                    <Text style={styles.identityValue}>{identity.displayValue}</Text>
                  </View>
                  <Text style={styles.identityStatus}>已绑定</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.sectionBody}>
              {isGuest
                ? '你现在以 Guest 身份使用 Flipod。登录后可以把当前本机进度并入正式账号。'
                : '当前还没有绑定额外登录方式。'}
            </Text>
          )}
        </GlassCard>

        <GlassCard style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>{isGuest ? '升级为正式账号' : '绑定新的方式'}</Text>
          <Text style={styles.sectionBody}>
            {isGuest
              ? '用手机号或 Apple 登录后，当前本机收藏、词汇和练习进度会并入账号。'
              : '绑定后，换设备登录会更稳，也更容易找回账号。'}
          </Text>
          <View style={styles.actionGroup}>
            {!hasPhone ? (
              <ActionButton
                label={isGuest ? 'Phone Login' : '绑定手机号'}
                variant="secondary"
                onPress={() => {
                  triggerUiFeedback('menu');
                  onLinkPhone();
                }}
              />
            ) : null}
            {!hasApple ? (
              <ActionButton
                label={isGuest ? 'Apple Login' : '绑定 Apple'}
                variant="secondary"
                onPress={() => {
                  triggerUiFeedback('menu');
                  onLinkApple();
                }}
              />
            ) : null}
            {hasPhone && hasApple ? (
              <Text style={styles.allBoundText}>
                {isGuest ? '当前设备已经准备好升级登录。' : '手机号和 Apple 都已经绑定好了。'}
              </Text>
            ) : null}
          </View>
        </GlassCard>

        <GlassCard style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>账号操作</Text>
          <View style={styles.actionGroup}>
            {isGuest ? (
              <ActionButton label="返回登录页" variant="secondary" onPress={confirmEndGuestMode} />
            ) : (
              <>
                <ActionButton label="退出登录" variant="secondary" onPress={confirmLogout} />
                <ActionButton label="注销账号" variant="danger" onPress={confirmDeleteAccount} />
              </>
            )}
          </View>
          <Text style={styles.warningText}>
            {isGuest
              ? 'Guest 模式下的数据会先保存在本机；登录后可以并入正式账号。'
              : '注销后会删除当前账号及云端学习记录，请谨慎操作。'}
          </Text>
        </GlassCard>
      </ScrollView>
    </ScreenSurface>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    content: {
      paddingHorizontal: spacing.page,
      paddingBottom: 40,
      gap: spacing.md,
    },
    heroCard: {
      gap: spacing.sm,
    },
    heroTitle: {
      color: colors.textPrimary,
      fontSize: 24,
      fontWeight: '700',
    },
    heroBody: {
      color: colors.textSecondary,
      fontSize: typography.body,
      lineHeight: 20,
    },
    sectionCard: {
      gap: spacing.md,
    },
    sectionLabel: {
      color: colors.textTertiary,
      fontSize: typography.micro,
      fontWeight: '700',
      letterSpacing: 1.1,
    },
    sectionBody: {
      color: colors.textSecondary,
      fontSize: typography.body,
      lineHeight: 20,
    },
    identityList: {
      gap: spacing.sm,
    },
    identityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingVertical: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.stroke,
    },
    identityCopy: {
      flex: 1,
      gap: 4,
    },
    identityLabel: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      fontWeight: '600',
    },
    identityValue: {
      color: colors.textPrimary,
      fontSize: typography.bodyLg,
      fontWeight: '700',
    },
    identityStatus: {
      color: colors.accentSuccess,
      fontSize: typography.caption,
      fontWeight: '700',
    },
    actionGroup: {
      gap: spacing.sm,
    },
    languageWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    allBoundText: {
      color: colors.textSecondary,
      fontSize: typography.caption,
    },
    warningText: {
      color: colors.textTertiary,
      fontSize: typography.caption,
      lineHeight: 18,
    },
  });
}
