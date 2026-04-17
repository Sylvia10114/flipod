import React from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionButton, GlassCard, PillButton, ScreenHeader, ScreenSurface } from '../components/AppChrome';
import { LanguageSelectionList } from '../components/LanguageSelectionList';
import { spacing, typography } from '../design';
import { triggerUiFeedback } from '../feedback';
import { getNativeLanguageOptions, useUiI18n } from '../i18n';
import { useResponsiveLayout } from '../responsive';
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

function getIdentityLabel(identity: LinkedIdentity, t: (key: string) => string) {
  return identity.provider === 'phone' ? t('account.phoneProvider') : t('account.appleProvider');
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
  const metrics = useResponsiveLayout();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const hasPhone = linkedIdentities.some(item => item.provider === 'phone');
  const hasApple = linkedIdentities.some(item => item.provider === 'apple');
  const languageOptions = React.useMemo(() => getNativeLanguageOptions(), []);
  const [languagePickerVisible, setLanguagePickerVisible] = React.useState(false);
  const currentLanguageOption = React.useMemo(
    () => languageOptions.find(option => option.code === profile.nativeLanguage) ?? languageOptions[0],
    [languageOptions, profile.nativeLanguage]
  );

  const confirmLogout = React.useCallback(() => {
    Alert.alert(t('account.alertLogoutTitle'), t('account.alertLogoutBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('account.logout'),
        style: 'destructive',
        onPress: () => {
          triggerUiFeedback('error');
          onLogout();
        },
      },
    ]);
  }, [onLogout, t]);

  const confirmDeleteAccount = React.useCallback(() => {
    Alert.alert(t('account.alertDeleteTitle'), t('account.alertDeleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('account.deleteAccount'),
        style: 'destructive',
        onPress: () => {
          triggerUiFeedback('error');
          void onDeleteAccount();
        },
      },
    ]);
  }, [onDeleteAccount, t]);

  const confirmEndGuestMode = React.useCallback(() => {
    Alert.alert(t('account.alertEndGuestTitle'), t('account.alertEndGuestBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('account.returnToLogin'),
        style: 'destructive',
        onPress: () => {
          triggerUiFeedback('menu');
          onEndGuestMode();
        },
      },
    ]);
  }, [onEndGuestMode, t]);

  const closeLanguagePicker = React.useCallback(() => {
    triggerUiFeedback('menu');
    setLanguagePickerVisible(false);
  }, []);

  const openLanguagePicker = React.useCallback(() => {
    triggerUiFeedback('menu');
    setLanguagePickerVisible(true);
  }, []);

  const handleLanguageSelect = React.useCallback((nativeLanguage: NativeLanguage) => {
    triggerUiFeedback('menu');
    if (nativeLanguage !== profile.nativeLanguage) {
      onChangeNativeLanguage(nativeLanguage);
    }
    setLanguagePickerVisible(false);
  }, [onChangeNativeLanguage, profile.nativeLanguage]);

  return (
    <>
      <ScreenSurface>
        <ScreenHeader
          leading={<PillButton label={t('common.back')} onPress={() => {
            triggerUiFeedback('menu');
            onBack();
          }} />}
          title={t('account.title')}
          subtitle={isGuest ? t('account.subtitleGuest') : t('account.subtitleAccount')}
        />

        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingHorizontal: metrics.pageHorizontalPadding,
              maxWidth: metrics.contentMaxWidth,
              alignSelf: 'center',
              width: '100%',
            },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <GlassCard style={styles.summaryCard}>
            <View style={styles.summaryTopRow}>
              <Text style={styles.summaryEyebrow}>{isGuest ? t('account.guestLabel') : t('account.title')}</Text>
              {profile.level ? (
                <View style={styles.levelBadge}>
                  <Text style={styles.levelBadgeText}>{profile.level}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.summaryTitle}>
              {isGuest ? t('account.heroGuest', { level: profile.level || 'B1' }) : t('account.heroAccount', { level: profile.level || 'B1', count: linkedIdentities.length })}
            </Text>
            <Text style={styles.summaryBody}>
              {isGuest ? t('account.subtitleGuest') : t('menu.accountManageBody')}
            </Text>
          </GlassCard>

          <GlassCard style={styles.sectionCard}>
            <Text style={styles.sectionLabel}>{t('menu.learningPreferences')}</Text>
            <Text style={styles.sectionBody}>{t('account.languageSectionBody')}</Text>
            <Pressable onPress={openLanguagePicker} style={styles.settingRow}>
              <Text style={styles.settingTitle}>{t('account.languageSectionTitle')}</Text>
              <View style={styles.settingMeta}>
                <Text style={styles.settingValue}>{currentLanguageOption.selfLabel}</Text>
                <Text style={styles.settingChevron}>›</Text>
              </View>
            </Pressable>
          </GlassCard>

          <GlassCard style={styles.sectionCard}>
            <Text style={styles.sectionLabel}>{isGuest ? t('account.currentIdentity') : t('account.linkedMethods')}</Text>
            <Text style={styles.sectionBody}>
              {isGuest
                ? t('account.guestIdentityBody')
                : linkedIdentities.length > 0
                  ? t('menu.accountManageBody')
                  : t('account.noExtraMethods')}
            </Text>

            {!isGuest && linkedIdentities.length > 0 ? (
              <View style={styles.identityList}>
                {linkedIdentities.map(identity => (
                  <View key={`${identity.provider}-${identity.providerUserId}`} style={styles.identityRow}>
                    <View style={styles.identityCopy}>
                      <Text style={styles.identityLabel}>{getIdentityLabel(identity, t)}</Text>
                      <Text style={styles.identityValue}>{identity.displayValue}</Text>
                    </View>
                    <Text style={styles.identityStatus}>{t('account.linkedStatus')}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </GlassCard>

          <GlassCard style={styles.sectionCard}>
            <Text style={styles.sectionLabel}>{isGuest ? t('account.upgradeGuest') : t('account.linkNewMethod')}</Text>
            <Text style={styles.sectionBody}>
              {isGuest
                ? t('account.upgradeGuestBody')
                : t('account.linkNewMethodBody')}
            </Text>
            <View style={styles.actionGroup}>
              {!hasPhone ? (
                <ActionButton
                  label={isGuest ? t('login.phoneLogin') : t('account.linkPhone')}
                  variant="secondary"
                  onPress={() => {
                    triggerUiFeedback('menu');
                    onLinkPhone();
                  }}
                />
              ) : null}
              {!hasApple ? (
                <ActionButton
                  label={isGuest ? t('account.appleProvider') : t('account.linkApple')}
                  variant="secondary"
                  onPress={() => {
                    triggerUiFeedback('menu');
                    onLinkApple();
                  }}
                />
              ) : null}
              {hasPhone && hasApple ? (
                <Text style={styles.allBoundText}>
                  {isGuest ? t('account.readyToUpgrade') : t('account.allMethodsLinked')}
                </Text>
              ) : null}
            </View>
          </GlassCard>

          <GlassCard style={[styles.sectionCard, styles.dangerCard]}>
            <Text style={styles.sectionLabel}>{t('account.actions')}</Text>
            <View style={styles.actionGroup}>
              {isGuest ? (
                <ActionButton label={t('account.returnToLogin')} variant="secondary" onPress={confirmEndGuestMode} />
              ) : (
                <>
                  <ActionButton label={t('account.logout')} variant="secondary" onPress={confirmLogout} />
                  <ActionButton label={t('account.deleteAccount')} variant="danger" onPress={confirmDeleteAccount} />
                </>
              )}
            </View>
            <Text style={styles.warningText}>
              {isGuest
                ? t('account.warningGuest')
                : t('account.warningDelete')}
            </Text>
          </GlassCard>
        </ScrollView>
      </ScreenSurface>

      <Modal
        visible={languagePickerVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={closeLanguagePicker}
      >
        <ScreenSurface edges={['bottom']}>
          <View style={[styles.languageModalSurface, { paddingTop: Math.max(metrics.insets.top + 6, 18) }]}>
            <ScreenHeader
              leading={<PillButton label={t('common.back')} onPress={closeLanguagePicker} />}
              title={t('account.languageSectionTitle')}
            />

            <ScrollView
              contentContainerStyle={[
                styles.languageModalContent,
                {
                  paddingHorizontal: metrics.pageHorizontalPadding,
                  maxWidth: metrics.modalMaxWidth,
                  alignSelf: 'center',
                  width: '100%',
                },
              ]}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.languageModalIntro}>
                <Text style={styles.languageModalTitle}>{t('onboarding.nativeLanguageTitle')}</Text>
                <Text style={styles.languageModalSubtitle}>{t('onboarding.languagePageSubtitle')}</Text>
              </View>

              <LanguageSelectionList
                selectedLanguage={profile.nativeLanguage}
                trailingMode="check"
                onSelect={handleLanguageSelect}
              />

              <Text style={styles.languageModalHint}>{t('onboarding.languagePageHint')}</Text>
            </ScrollView>
          </View>
        </ScreenSurface>
      </Modal>
    </>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    content: {
      paddingHorizontal: spacing.page,
      paddingBottom: 40,
      gap: spacing.lg,
    },
    summaryCard: {
      gap: spacing.md,
      paddingTop: spacing.xl,
      paddingBottom: spacing.xl,
    },
    summaryTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    summaryEyebrow: {
      color: colors.textTertiary,
      fontSize: typography.micro,
      fontWeight: '700',
      letterSpacing: 1.1,
      textTransform: 'uppercase',
    },
    summaryTitle: {
      color: colors.textPrimary,
      fontSize: 22,
      fontWeight: '700',
      lineHeight: 30,
    },
    summaryBody: {
      color: colors.textSecondary,
      fontSize: typography.body,
      lineHeight: 20,
    },
    sectionCard: {
      gap: spacing.md,
      paddingTop: spacing.lg,
      paddingBottom: spacing.lg,
    },
    dangerCard: {
      borderColor: `${colors.accentError}22`,
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
    settingRow: {
      minHeight: 60,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.strokeStrong,
      backgroundColor: colors.bgSurface1,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    settingTitle: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: typography.bodyLg,
      fontWeight: '700',
    },
    settingMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      flexShrink: 1,
      maxWidth: '48%',
    },
    settingValue: {
      color: colors.textSecondary,
      fontSize: typography.body,
      fontWeight: '600',
      flexShrink: 1,
      textAlign: 'right',
    },
    settingChevron: {
      color: colors.textTertiary,
      fontSize: 24,
      fontWeight: '500',
      marginTop: -1,
    },
    identityList: {
      gap: spacing.md,
    },
    identityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.strokeStrong,
      backgroundColor: colors.bgSurface1,
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
    allBoundText: {
      color: colors.textSecondary,
      fontSize: typography.caption,
    },
    warningText: {
      color: colors.textTertiary,
      fontSize: typography.caption,
      lineHeight: 18,
    },
    levelBadge: {
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: `${colors.accentFeed}18`,
      borderWidth: 1,
      borderColor: `${colors.accentFeed}42`,
    },
    levelBadgeText: {
      color: colors.accentFeed,
      fontSize: typography.caption,
      fontWeight: '700',
    },
    languageModalContent: {
      flexGrow: 1,
      paddingHorizontal: spacing.page,
      paddingTop: spacing.md,
      paddingBottom: 40,
    },
    languageModalSurface: {
      flex: 1,
    },
    languageModalIntro: {
      alignItems: 'center',
      gap: spacing.md,
      marginBottom: spacing.xl,
    },
    languageModalTitle: {
      color: colors.textPrimary,
      fontSize: 24,
      fontWeight: '700',
      textAlign: 'center',
    },
    languageModalSubtitle: {
      color: colors.textSecondary,
      fontSize: typography.bodyLg,
      lineHeight: 22,
      textAlign: 'center',
      paddingHorizontal: 18,
    },
    languageModalHint: {
      marginTop: spacing.lg,
      color: colors.textSecondary,
      fontSize: typography.caption,
      lineHeight: 18,
      textAlign: 'center',
    },
  });
}
