import * as AppleAuthentication from 'expo-apple-authentication';
import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ImageBackground,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { triggerUiFeedback } from '../feedback';
import type { LinkedIdentity } from '../types';

const LOGIN_BG = require('../../assets/login.png');

type SmsRequestResult = {
  retryAfterSeconds?: number;
  debugCode?: string;
};

type LoginStage = 'landing' | 'phone';

type Props = {
  visible?: boolean;
  mode?: 'sign-in' | 'link';
  presentation?: 'screen' | 'modal';
  linkedIdentities?: LinkedIdentity[];
  loading?: boolean;
  errorMessage?: string;
  onRequestSms: (phoneNumber: string) => Promise<SmsRequestResult | void>;
  onVerifyPhone: (phoneNumber: string, code: string) => Promise<void>;
  onApplePress: () => Promise<void>;
  onTryGuest?: () => void;
  onCancel?: () => void;
};

function IdentitySummary({ linkedIdentities }: { linkedIdentities: LinkedIdentity[] }) {
  if (linkedIdentities.length === 0) return null;

  return (
    <View style={styles.identityCard}>
      <Text style={styles.identityLabel}>当前已绑定</Text>
      <View style={styles.identityWrap}>
        {linkedIdentities.map(identity => (
          <View key={`${identity.provider}:${identity.providerUserId}`} style={styles.identityChip}>
            <Text style={styles.identityChipText}>
              {identity.provider === 'phone' ? identity.displayValue : 'Apple'}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function LoginContent({
  mode = 'sign-in',
  presentation = 'screen',
  linkedIdentities = [],
  loading = false,
  errorMessage,
  onRequestSms,
  onVerifyPhone,
  onApplePress,
  onTryGuest,
  onCancel,
}: Omit<Props, 'visible'>) {
  const [stage, setStage] = useState<LoginStage>('landing');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [code, setCode] = useState('');
  const [requestedPhone, setRequestedPhone] = useState('');
  const [debugCode, setDebugCode] = useState('');
  const [localMessage, setLocalMessage] = useState('');
  const codeInputRef = useRef<TextInput>(null);

  const linkedProviders = useMemo(
    () => new Set(linkedIdentities.map(item => item.provider)),
    [linkedIdentities]
  );
  const canUsePhone = !linkedProviders.has('phone');
  const canUseApple = !linkedProviders.has('apple');
  const activeError = errorMessage || localMessage;
  const codeDigits = useMemo(
    () => Array.from({ length: 6 }, (_, index) => code.replace(/\D/g, '').slice(0, 6)[index] || ''),
    [code]
  );
  const maskedPhonePreview = useMemo(() => {
    const digits = (requestedPhone || phoneNumber).replace(/\D/g, '');
    if (digits.length < 11) return requestedPhone || phoneNumber;
    const local = digits.slice(-11);
    return `${local.slice(0, 3)} ${local.slice(3, 7)} ${local.slice(7)}`;
  }, [phoneNumber, requestedPhone]);

  const title = mode === 'sign-in' ? 'Flipod' : '绑定登录方式';
  const subtitle = mode === 'sign-in'
    ? '听懂真实世界，从一条播客开始。'
    : '给当前账号补绑另一种登录方式，方便以后恢复进度。';
  const showGuestEntry = mode === 'sign-in' && presentation === 'screen' && typeof onTryGuest === 'function';

  const resetPhoneFlow = () => {
    setStage('landing');
    setRequestedPhone('');
    setCode('');
    setDebugCode('');
    setLocalMessage('');
  };

  const handleRequestCode = async () => {
    try {
      triggerUiFeedback('primary');
      setLocalMessage('');
      const result = await onRequestSms(phoneNumber);
      setRequestedPhone(phoneNumber);
      setDebugCode(result?.debugCode || '');
      setCode('');
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : '验证码发送失败');
    }
  };

  const handleVerify = async () => {
    try {
      triggerUiFeedback('primary');
      setLocalMessage('');
      await onVerifyPhone(requestedPhone || phoneNumber, code);
      resetPhoneFlow();
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : '登录失败');
    }
  };

  const handleAppleButton = async () => {
    try {
      triggerUiFeedback('primary');
      setLocalMessage('');
      await onApplePress();
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : 'Apple 登录失败');
    }
  };

  const handleBack = () => {
    triggerUiFeedback('menu');
    if (requestedPhone || code) {
      setRequestedPhone('');
      setCode('');
      setDebugCode('');
      setLocalMessage('');
      return;
    }
    if (stage === 'phone') {
      setStage('landing');
      setLocalMessage('');
      return;
    }
    onCancel?.();
  };

  const landing = (
    <View style={styles.landingContent}>
      {showGuestEntry ? (
        <View style={styles.landingTopBar}>
          <Pressable
            style={styles.guestButton}
            onPress={() => {
              triggerUiFeedback('menu');
              onTryGuest?.();
            }}
          >
            <Text style={styles.guestButtonText}>Try as guest</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.landingSpacer} />
      <View style={styles.heroBlock}>
        <Text style={styles.heroEyebrow}>{mode === 'sign-in' ? 'LISTEN BETTER' : 'ACCOUNT'}</Text>
        <Text style={styles.heroTitle}>{title}</Text>
        <Text style={styles.heroSubtitle}>{subtitle}</Text>
      </View>

      <View style={styles.bottomSheet}>
        <IdentitySummary linkedIdentities={linkedIdentities} />

        {canUsePhone ? (
          <Pressable
            style={[styles.phoneEntryButton, loading && styles.buttonDisabled]}
            disabled={loading}
            onPress={() => {
              triggerUiFeedback('primary');
              setStage('phone');
              setLocalMessage('');
            }}
          >
            <Text style={styles.phoneEntryButtonText}>Phone Login</Text>
          </Pressable>
        ) : null}

        {canUseApple ? (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={
              mode === 'sign-in'
                ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
                : AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
            }
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
            cornerRadius={18}
            style={styles.appleButton}
            onPress={() => {
              void handleAppleButton();
            }}
          />
        ) : null}

        {!canUsePhone && !canUseApple ? (
          <View style={styles.boundState}>
            <Text style={styles.boundStateText}>当前账号已经绑定手机号和 Apple，无需重复绑定。</Text>
          </View>
        ) : null}

        {activeError ? <Text style={styles.errorTextCentered}>{activeError}</Text> : null}

        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#8B9CF7" />
            <Text style={styles.loadingText}>正在处理中...</Text>
          </View>
        ) : null}

        {mode === 'link' && onCancel ? (
          <Pressable style={styles.linkCancelButton} onPress={handleBack}>
            <Text style={styles.linkCancelButtonText}>稍后再说</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  const phonePage = (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoiding}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.phoneScrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.phonePage}>
            <View style={styles.phoneHeader}>
              <Pressable style={styles.backButton} onPress={handleBack}>
                <Text style={styles.backButtonText}>返回</Text>
              </Pressable>
            </View>

            <View style={styles.phoneCard}>
              <Text style={styles.phoneTitle}>{requestedPhone ? '输入验证码' : 'Phone Login'}</Text>
              <Text style={styles.phoneSubtitle}>
                {requestedPhone
                  ? `验证码已发送到 ${maskedPhonePreview}`
                  : '输入手机号获取短信验证码。默认按中国大陆手机号处理。'}
              </Text>

              <TextInput
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                style={styles.input}
                placeholder="请输入手机号"
                placeholderTextColor="rgba(255,255,255,0.32)"
                keyboardType="number-pad"
                editable={!loading}
                maxLength={11}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
              />

              {!requestedPhone ? (
                <Pressable
                  style={[styles.primaryButton, (!phoneNumber || loading) && styles.buttonDisabled]}
                  onPress={handleRequestCode}
                  disabled={!phoneNumber || loading}
                >
                  <Text style={styles.primaryButtonText}>发送验证码</Text>
                </Pressable>
              ) : (
                <View style={styles.codeSection}>
                  <Pressable
                    onPress={() => codeInputRef.current?.focus()}
                    style={styles.codeBoxes}
                    disabled={loading}
                  >
                    {codeDigits.map((digit, index) => (
                      <View
                        key={index}
                        style={[
                          styles.codeBox,
                          digit ? styles.codeBoxFilled : null,
                          !digit && index === Math.min(code.replace(/\D/g, '').length, 5) ? styles.codeBoxActive : null,
                        ]}
                      >
                        <Text style={styles.codeBoxText}>{digit || ''}</Text>
                      </View>
                    ))}
                  </Pressable>

                  <TextInput
                    ref={codeInputRef}
                    value={code}
                    onChangeText={value => setCode(value.replace(/\D/g, '').slice(0, 6))}
                    style={styles.hiddenCodeInput}
                    keyboardType="number-pad"
                    editable={!loading}
                    maxLength={6}
                    textContentType="oneTimeCode"
                    autoComplete="sms-otp"
                    caretHidden
                    returnKeyType="done"
                    onSubmitEditing={Keyboard.dismiss}
                  />

                  <View style={styles.inlineActions}>
                    <Pressable
                      style={styles.inlineButton}
                      onPress={handleRequestCode}
                      disabled={loading}
                    >
                      <Text style={styles.inlineButtonText}>重发验证码</Text>
                    </Pressable>
                  </View>

                  {debugCode ? <Text style={styles.debugCode}>开发验证码：{debugCode}</Text> : null}

                  <Pressable
                    style={[
                      styles.primaryButton,
                      (code.replace(/\D/g, '').length !== 6 || loading) && styles.buttonDisabled,
                    ]}
                    onPress={handleVerify}
                    disabled={code.replace(/\D/g, '').length !== 6 || loading}
                  >
                    <Text style={styles.primaryButtonText}>{mode === 'sign-in' ? '进入 Flipod' : '绑定手机号'}</Text>
                  </Pressable>
                </View>
              )}

              {activeError ? <Text style={styles.errorText}>{activeError}</Text> : null}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </TouchableWithoutFeedback>
  );

  const signInBody = stage === 'landing' ? landing : phonePage;

  if (mode === 'sign-in' && presentation === 'screen') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ImageBackground source={LOGIN_BG} style={styles.background} resizeMode="cover">
          <View style={styles.backgroundOverlay}>{signInBody}</View>
        </ImageBackground>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.linkSurface}>{signInBody}</View>
    </SafeAreaView>
  );
}

export function LoginScreen({
  visible = true,
  ...props
}: Props) {
  if (!visible) return null;

  if (props.presentation === 'modal' || props.mode === 'link') {
    return (
      <Modal visible transparent animationType="slide" onRequestClose={props.onCancel}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <LoginContent {...props} />
          </View>
        </View>
      </Modal>
    );
  }

  return <LoginContent {...props} />;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#09090B',
  },
  background: {
    flex: 1,
  },
  backgroundOverlay: {
    flex: 1,
    backgroundColor: 'rgba(6,8,12,0.42)',
  },
  landingContent: {
    flex: 1,
    paddingHorizontal: 22,
    paddingBottom: 18,
  },
  landingTopBar: {
    paddingTop: 6,
    alignItems: 'flex-end',
  },
  landingSpacer: {
    flex: 1,
  },
  heroBlock: {
    paddingHorizontal: 8,
    marginBottom: 22,
  },
  heroEyebrow: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.6,
  },
  heroTitle: {
    marginTop: 12,
    color: '#FFFFFF',
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '800',
  },
  heroSubtitle: {
    marginTop: 10,
    color: 'rgba(255,255,255,0.78)',
    fontSize: 15,
    lineHeight: 22,
  },
  guestButton: {
    minHeight: 34,
    borderRadius: 999,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(12,12,16,0.58)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  guestButtonText: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 13,
    fontWeight: '700',
  },
  bottomSheet: {
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 20,
    backgroundColor: 'rgba(12,12,16,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 14,
  },
  identityCard: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  identityLabel: {
    color: 'rgba(255,255,255,0.54)',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  identityWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  identityChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(139,156,247,0.18)',
  },
  identityChipText: {
    color: '#E7EAFF',
    fontSize: 13,
    fontWeight: '600',
  },
  phoneEntryButton: {
    minHeight: 56,
    borderRadius: 18,
    backgroundColor: '#8B9CF7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  phoneEntryButtonText: {
    color: '#09090B',
    fontSize: 16,
    fontWeight: '800',
  },
  appleButton: {
    width: '100%',
    height: 56,
  },
  boundState: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  boundStateText: {
    color: 'rgba(255,255,255,0.74)',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  errorTextCentered: {
    color: '#F87171',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 13,
  },
  linkCancelButton: {
    alignItems: 'center',
    paddingTop: 4,
  },
  linkCancelButtonText: {
    color: 'rgba(255,255,255,0.54)',
    fontSize: 14,
    fontWeight: '600',
  },
  keyboardAvoiding: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  phoneScrollContent: {
    flexGrow: 1,
  },
  phonePage: {
    flexGrow: 1,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 32,
    justifyContent: 'flex-end',
  },
  phoneHeader: {
    marginBottom: 14,
    alignItems: 'flex-start',
  },
  backButton: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: 'rgba(8,10,16,0.58)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  phoneCard: {
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 22,
    backgroundColor: 'rgba(12,12,16,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  phoneTitle: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
  },
  phoneSubtitle: {
    marginTop: 10,
    color: 'rgba(255,255,255,0.70)',
    fontSize: 14,
    lineHeight: 21,
  },
  input: {
    marginTop: 18,
    width: '100%',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 16,
    paddingVertical: 15,
    color: '#FFFFFF',
    fontSize: 17,
  },
  primaryButton: {
    marginTop: 16,
    minHeight: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8B9CF7',
  },
  primaryButtonText: {
    color: '#09090B',
    fontSize: 16,
    fontWeight: '800',
  },
  codeSection: {
    marginTop: 16,
    gap: 14,
  },
  codeBoxes: {
    flexDirection: 'row',
    gap: 8,
  },
  codeBox: {
    flex: 1,
    minWidth: 0,
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeBoxActive: {
    borderColor: '#8B9CF7',
    backgroundColor: 'rgba(139,156,247,0.12)',
  },
  codeBoxFilled: {
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  codeBoxText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
  },
  hiddenCodeInput: {
    position: 'absolute',
    opacity: 0.02,
    pointerEvents: 'none',
  },
  inlineActions: {
    alignItems: 'flex-start',
  },
  inlineButton: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  inlineButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  debugCode: {
    color: '#8B9CF7',
    fontSize: 12,
  },
  errorText: {
    marginTop: 14,
    color: '#F87171',
    fontSize: 13,
    lineHeight: 20,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    padding: 14,
    justifyContent: 'flex-end',
  },
  modalCard: {
    minHeight: '72%',
    maxHeight: '92%',
    overflow: 'hidden',
    borderRadius: 28,
    backgroundColor: '#09090B',
  },
  linkSurface: {
    flex: 1,
    backgroundColor: '#09090B',
  },
});
