import * as AppleAuthentication from 'expo-apple-authentication';
import React from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionButton, GlassCard, PillButton, ScreenHeader, ScreenSurface } from '../components/AppChrome';
import { LanguageSelectionList } from '../components/LanguageSelectionList';
import { spacing, typography } from '../design';
import { triggerUiFeedback } from '../feedback';
import { getNativeLanguageOptions, useUiI18n } from '../i18n';
import { joinLocalizedTopics } from '../i18n/helpers';
import { useResponsiveLayout } from '../responsive';
import { useAppTheme } from '../theme';
import type { LinkedIdentity, NativeLanguage, Profile } from '../types';

type Props = {
  profile: Profile;
  isGuest: boolean;
  linkedIdentities: LinkedIdentity[];
  bookmarksCount: number;
  vocabCount: number;
  practiceCount: number;
  onBack: () => void;
  onLinkPhone: () => void;
  onLinkApple: () => void;
  onLogout: () => void;
  onDeleteAccount: () => Promise<void> | void;
  onEndGuestMode: () => void;
  onChangeNativeLanguage: (nativeLanguage: NativeLanguage) => void;
};

export function AccountScreen({
  profile,
  isGuest,
  linkedIdentities,
  bookmarksCount,
  vocabCount,
  practiceCount,
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
  const linkedPhone = React.useMemo(
    () => linkedIdentities.find(item => item.provider === 'phone') || null,
    [linkedIdentities]
  );
  const linkedApple = React.useMemo(
    () => linkedIdentities.find(item => item.provider === 'apple') || null,
    [linkedIdentities]
  );
  const linkedMethodCount = linkedIdentities.length;
  const topicsValue = profile.interests.length > 0
    ? joinLocalizedTopics(profile.interests, t)
    : t('account.noTopicsSelected');
  const heroEyebrow = isGuest ? t('account.statusLabelGuest') : t('account.statusLabelRecovery');
  const heroBadge = isGuest ? (profile.level || 'B1') : `${linkedMethodCount} / 2`;
  const summaryTitle = isGuest
    ? t('account.heroGuest', { level: profile.level || 'B1' })
    : t('account.heroAccount', { count: linkedMethodCount, level: profile.level || 'B1' });
  const summaryBody = isGuest
    ? t('account.upgradeGuestBody')
    : linkedMethodCount < 2
      ? t('account.noExtraMethods')
      : t('account.subtitleAccount');
  const identityRows = React.useMemo(
    () => [
      {
        key: 'phone',
        label: t('account.phoneProvider'),
        value: linkedPhone?.displayValue || '',
        linked: Boolean(linkedPhone),
      },
      {
        key: 'apple',
        label: t('account.appleProvider'),
        value: linkedApple?.displayValue || '',
        linked: Boolean(linkedApple),
      },
    ],
    [linkedApple, linkedPhone, t]
  );
  const primaryLinkAction = !hasPhone ? 'phone' : !hasApple ? 'apple' : null;

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

  const renderAppleAction = React.useCallback((mode: 'sign-in' | 'link') => {
    if (Platform.OS === 'ios') {
      return (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={
            mode === 'sign-in'
              ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
              : AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
          }
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
          cornerRadius={16}
          style={styles.appleActionButton}
          onPress={() => {
            triggerUiFeedback('menu');
            onLinkApple();
          }}
        />
      );
    }

    return (
      <ActionButton
        label={mode === 'sign-in' ? t('account.appleProvider') : t('account.linkApple')}
        variant={mode === 'sign-in' ? 'primary' : 'secondary'}
        style={styles.primaryActionButton}
        onPress={() => {
          triggerUiFeedback('menu');
          onLinkApple();
        }}
      />
    );
  }, [onLinkApple, styles.appleActionButton, styles.primaryActionButton, t]);

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
          <GlassCard style={[styles.summaryCard, isGuest ? styles.summaryCardGuest : styles.summaryCardSignedIn]}>
            <View style={styles.summaryTopRow}>
              <Text style={styles.summaryEyebrow}>{heroEyebrow}</Text>
              <View style={styles.levelBadge}>
                <Text style={styles.levelBadgeText}>{heroBadge}</Text>
              </View>
            </View>

            <View style={styles.summaryCopy}>
              <Text style={styles.summaryTitle}>{summaryTitle}</Text>
              <Text style={styles.summaryBody}>{summaryBody}</Text>
            </View>

            <View style={styles.primaryActionGroup}>
              {isGuest ? (
                <>
                  {!hasPhone ? (
                    <ActionButton
                      label={t('login.phoneLogin')}
                      style={styles.primaryActionButton}
                      onPress={() => {
                        triggerUiFeedback('menu');
                        onLinkPhone();
                      }}
                    />
                  ) : null}
                  {!hasApple ? renderAppleAction('sign-in') : null}
                </>
              ) : primaryLinkAction === 'phone' ? (
                <ActionButton
                  label={t('account.linkPhone')}
                  style={styles.primaryActionButton}
                  onPress={() => {
                    triggerUiFeedback('menu');
                    onLinkPhone();
                  }}
                />
              ) : primaryLinkAction === 'apple' ? (
                renderAppleAction('link')
              ) : null}
            </View>
          </GlassCard>

          {isGuest ? (
            <GlassCard style={styles.sectionCard}>
              <Text style={styles.sectionLabel}>{t('account.deviceSectionTitle')}</Text>
              <View style={styles.statStack}>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>{t('account.recordBookmarks')}</Text>
                  <Text style={styles.statValue}>{bookmarksCount}</Text>
                </View>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>{t('account.recordVocab')}</Text>
                  <Text style={styles.statValue}>{vocabCount}</Text>
                </View>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>{t('account.recordPractice')}</Text>
                  <Text style={styles.statValue}>{practiceCount}</Text>
                </View>
              </View>
              <Text style={styles.sectionFootnote}>{t('account.warningGuest')}</Text>
            </GlassCard>
          ) : (
            <GlassCard style={styles.sectionCard}>
              <Text style={styles.sectionLabel}>{t('account.linkedMethods')}</Text>
              <Text style={styles.sectionBody}>
                {linkedMethodCount < 2
                  ? t('account.linkNewMethodBody')
                  : t('account.allMethodsLinked')}
              </Text>
              <View style={styles.identityList}>
                {identityRows.map(row => (
                  <View key={row.key} style={styles.identityRow}>
                    <View style={styles.identityCopy}>
                      <Text style={styles.identityLabel}>{row.label}</Text>
                      {row.value ? <Text style={styles.identityValue}>{row.value}</Text> : null}
                    </View>
                    <View style={[styles.identityStatusBadge, row.linked ? styles.identityStatusBadgeLinked : styles.identityStatusBadgeIdle]}>
                      <Text style={[styles.identityStatus, row.linked ? styles.identityStatusLinked : styles.identityStatusIdle]}>
                        {row.linked ? t('account.linkedStatus') : t('account.notLinked')}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </GlassCard>
          )}

          <GlassCard style={styles.sectionCard}>
            <Text style={styles.sectionLabel}>{t('account.setupSectionTitle')}</Text>
            <View style={styles.settingsList}>
              <Pressable
                onPress={openLanguagePicker}
                hitSlop={6}
                style={({ pressed }) => [
                  styles.settingRowCompact,
                  pressed && styles.settingRowPressed,
                ]}
              >
                <Text style={styles.settingTitle}>{t('account.languageSectionTitle')}</Text>
                <View style={styles.settingMeta}>
                  <Text style={styles.settingValue}>{currentLanguageOption.selfLabel}</Text>
                  <Text style={styles.settingChevron}>›</Text>
                </View>
              </Pressable>
              <View style={styles.settingRowCompact}>
                <Text style={styles.settingTitle}>{t('account.setupTopics')}</Text>
                <Text style={styles.settingValueMuted}>{topicsValue}</Text>
              </View>
            </View>
          </GlassCard>

          {isGuest ? (
            <GlassCard style={styles.sectionCard}>
              <Text style={styles.sectionLabel}>{t('account.sessionSectionTitle')}</Text>
              <ActionButton
                label={t('account.returnToLogin')}
                variant="secondary"
                style={styles.secondaryActionButton}
                onPress={confirmEndGuestMode}
              />
              <Text style={styles.sectionFootnote}>{t('account.sessionBody')}</Text>
            </GlassCard>
          ) : (
            <GlassCard style={styles.sectionCard}>
              <Text style={styles.sectionLabel}>{t('account.actions')}</Text>
              <ActionButton
                label={t('account.logout')}
                variant="secondary"
                style={styles.secondaryActionButton}
                onPress={confirmLogout}
              />
              <View style={styles.dangerZone}>
                <Text style={styles.dangerTitle}>{t('account.deleteAccount')}</Text>
                <Text style={styles.dangerBody}>{t('account.warningDelete')}</Text>
                <ActionButton
                  label={t('account.deleteAccount')}
                  variant="danger"
                  style={styles.secondaryActionButton}
                  onPress={confirmDeleteAccount}
                />
              </View>
            </GlassCard>
          )}
        </ScrollView>
      </ScreenSurface>

      <Modal
        visible={languagePickerVisible}
        transparent
        animationType="slide"
        onRequestClose={closeLanguagePicker}
      >
        <View style={styles.sheetOverlay}>
          <Pressable style={styles.sheetBackdrop} onPress={closeLanguagePicker} />
          <View style={[styles.sheetDock, { paddingBottom: Math.max(metrics.insets.bottom + 12, 20) }]}>
            <View
              style={[
                styles.sheetCard,
                {
                  marginHorizontal: metrics.pageHorizontalPadding,
                  maxWidth: metrics.modalMaxWidth,
                  maxHeight: Math.min(metrics.windowHeight * 0.76, 620),
                },
              ]}
            >
              <View style={styles.sheetHandle} />
              <View style={styles.sheetHeaderRow}>
                <View style={styles.sheetHeaderCopy}>
                  <Text style={styles.sheetTitle}>{t('account.languageSectionTitle')}</Text>
                  <Text style={styles.sheetSubtitle}>{t('account.languageSectionBody')}</Text>
                </View>
                <PillButton label={t('common.close')} subtle onPress={closeLanguagePicker} />
              </View>

              <ScrollView
                style={styles.sheetScroll}
                contentContainerStyle={styles.sheetScrollContent}
                showsVerticalScrollIndicator={false}
              >
                <LanguageSelectionList
                  selectedLanguage={profile.nativeLanguage}
                  trailingMode="check"
                  onSelect={handleLanguageSelect}
                />
              </ScrollView>
            </View>
          </View>
        </View>
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
      gap: spacing.lg,
      paddingTop: spacing.xl,
      paddingBottom: spacing.xl,
    },
    summaryCardGuest: {
      backgroundColor: `${colors.accentFeed}14`,
      borderColor: `${colors.accentFeed}38`,
    },
    summaryCardSignedIn: {
      backgroundColor: `${colors.accentFeed}14`,
      borderColor: `${colors.accentFeed}38`,
    },
    summaryTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    summaryEyebrow: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      fontWeight: '700',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    summaryCopy: {
      gap: spacing.sm,
    },
    summaryTitle: {
      color: colors.textPrimary,
      fontSize: typography.hero,
      fontWeight: '700',
      lineHeight: 30,
    },
    summaryBody: {
      color: colors.textSecondary,
      fontSize: typography.body,
      lineHeight: 20,
    },
    primaryActionGroup: {
      gap: spacing.sm,
    },
    primaryActionButton: {
      width: '100%',
    },
    appleActionButton: {
      width: '100%',
      height: 50,
    },
    sectionCard: {
      gap: spacing.md,
      paddingTop: spacing.lg,
      paddingBottom: spacing.lg,
    },
    sectionLabel: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      fontWeight: '700',
      letterSpacing: 0.8,
    },
    sectionBody: {
      color: colors.textSecondary,
      fontSize: typography.body,
      lineHeight: 20,
    },
    sectionFootnote: {
      color: colors.textTertiary,
      fontSize: typography.caption,
      lineHeight: 18,
    },
    statStack: {
      gap: spacing.sm,
    },
    statRow: {
      minHeight: 58,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.strokeStrong,
      backgroundColor: colors.bgSurface1,
      paddingHorizontal: spacing.lg,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    statLabel: {
      color: colors.textPrimary,
      fontSize: typography.bodyLg,
      fontWeight: '600',
      flex: 1,
    },
    statValue: {
      color: colors.textSecondary,
      fontSize: typography.bodyLg,
      fontWeight: '700',
    },
    settingsList: {
      gap: spacing.sm,
    },
    settingRowCompact: {
      minHeight: 58,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.strokeStrong,
      backgroundColor: colors.bgSurface1,
      paddingHorizontal: spacing.lg,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    settingRowPressed: {
      backgroundColor: colors.bgSurface2,
      borderColor: `${colors.accentFeed}55`,
    },
    settingTitle: {
      color: colors.textPrimary,
      fontSize: typography.bodyLg,
      fontWeight: '700',
      flex: 1,
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
    settingValueMuted: {
      color: colors.textSecondary,
      fontSize: typography.body,
      fontWeight: '600',
      flexShrink: 1,
      textAlign: 'right',
      maxWidth: '56%',
    },
    settingChevron: {
      color: colors.textTertiary,
      fontSize: 24,
      fontWeight: '500',
      marginTop: -1,
    },
    identityList: {
      gap: spacing.sm,
    },
    identityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: 14,
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
    identityStatusBadge: {
      minWidth: 84,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderWidth: 1,
    },
    identityStatusBadgeLinked: {
      backgroundColor: `${colors.accentSuccess}14`,
      borderColor: `${colors.accentSuccess}26`,
    },
    identityStatusBadgeIdle: {
      backgroundColor: colors.bgSurface2,
      borderColor: colors.strokeStrong,
    },
    identityStatus: {
      fontSize: typography.caption,
      fontWeight: '700',
    },
    identityStatusLinked: {
      color: colors.accentSuccess,
    },
    identityStatusIdle: {
      color: colors.textSecondary,
    },
    secondaryActionButton: {
      width: '100%',
    },
    dangerZone: {
      gap: spacing.sm,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: `${colors.accentError}24`,
      backgroundColor: `${colors.accentError}10`,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.lg,
    },
    dangerTitle: {
      color: colors.textPrimary,
      fontSize: typography.bodyLg,
      fontWeight: '700',
    },
    dangerBody: {
      color: `${colors.textPrimary}CC`,
      fontSize: typography.body,
      lineHeight: 20,
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
    sheetOverlay: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    sheetBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.bgDim,
    },
    sheetDock: {
      width: '100%',
      justifyContent: 'flex-end',
      alignItems: 'center',
    },
    sheetCard: {
      width: '100%',
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      backgroundColor: colors.bgOverlay,
      borderWidth: 1,
      borderColor: colors.strokeStrong,
      overflow: 'hidden',
      paddingTop: spacing.md,
    },
    sheetHandle: {
      alignSelf: 'center',
      width: 44,
      height: 5,
      borderRadius: 999,
      backgroundColor: colors.textFaint,
      marginBottom: spacing.md,
    },
    sheetHeaderRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
    },
    sheetHeaderCopy: {
      flex: 1,
      gap: 6,
      paddingTop: 2,
    },
    sheetTitle: {
      color: colors.textPrimary,
      fontSize: typography.hero,
      fontWeight: '700',
    },
    sheetSubtitle: {
      color: colors.textSecondary,
      fontSize: typography.body,
      lineHeight: 20,
    },
    sheetScroll: {
      flexGrow: 0,
    },
    sheetScrollContent: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
    },
  });
}
