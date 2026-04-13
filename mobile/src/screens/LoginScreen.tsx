import * as AppleAuthentication from 'expo-apple-authentication';
import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { LinkedIdentity } from '../types';

type SmsRequestResult = {
  retryAfterSeconds?: number;
  debugCode?: string;
};

type Props = {
  visible?: boolean;
  mode?: 'sign-in' | 'link';
  linkedIdentities?: LinkedIdentity[];
  loading?: boolean;
  errorMessage?: string;
  onRequestSms: (phoneNumber: string) => Promise<SmsRequestResult | void>;
  onVerifyPhone: (phoneNumber: string, code: string) => Promise<void>;
  onApplePress: () => Promise<void>;
  onCancel?: () => void;
};

function LoginContent({
  mode = 'sign-in',
  linkedIdentities = [],
  loading = false,
  errorMessage,
  onRequestSms,
  onVerifyPhone,
  onApplePress,
  onCancel,
}: Omit<Props, 'visible'>) {
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
  const maskedPhonePreview = useMemo(() => {
    const digits = (requestedPhone || phoneNumber).replace(/\D/g, '');
    if (digits.length < 11) return requestedPhone || phoneNumber;
    const local = digits.slice(-11);
    return `${local.slice(0, 3)} ${local.slice(3, 7)} ${local.slice(7)}`;
  }, [phoneNumber, requestedPhone]);
  const codeDigits = useMemo(
    () => Array.from({ length: 6 }, (_, index) => code.replace(/\D/g, '').slice(0, 6)[index] || ''),
    [code]
  );

  const title = mode === 'sign-in' ? '登录 Flipod' : '绑定登录方式';
  const subtitle = mode === 'sign-in'
    ? '使用手机号验证码或 Apple 登录后继续学习'
    : '给当前账号补绑另一种登录方式，方便以后恢复进度';

  const handleRequestCode = async () => {
    try {
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
      setLocalMessage('');
      await onVerifyPhone(requestedPhone || phoneNumber, code);
      setRequestedPhone('');
      setCode('');
      setDebugCode('');
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : '登录失败');
    }
  };

  const handleAppleButton = async () => {
    try {
      setLocalMessage('');
      await onApplePress();
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : 'Apple 登录失败');
    }
  };

  const activeError = errorMessage || localMessage;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>{mode === 'sign-in' ? 'AUTH' : 'ACCOUNT'}</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>

        {linkedIdentities.length > 0 ? (
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
        ) : null}

        {canUsePhone ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>手机号验证码</Text>
            <View style={styles.phoneRow}>
              <View style={styles.prefix}>
                <Text style={styles.prefixText}>+86</Text>
              </View>
              <TextInput
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                style={styles.input}
                placeholder="请输入手机号"
                placeholderTextColor="rgba(255,255,255,0.28)"
                keyboardType="number-pad"
                editable={!loading}
                maxLength={11}
              />
            </View>
            <Text style={styles.helperText}>仅支持中国大陆手机号，用短信验证码登录，不需要设置密码。</Text>

            <Pressable
              style={[styles.secondaryButton, (!phoneNumber || loading) && styles.buttonDisabled]}
              onPress={handleRequestCode}
              disabled={!phoneNumber || loading}
            >
              <Text style={styles.secondaryButtonText}>{requestedPhone ? '重新发送验证码' : '发送验证码'}</Text>
            </Pressable>

            {requestedPhone ? (
              <View style={styles.codeWrap}>
                <View style={styles.codeHeader}>
                  <View>
                    <Text style={styles.codeTitle}>输入验证码</Text>
                    <Text style={styles.codeHint}>已发送到 +86 {maskedPhonePreview}</Text>
                  </View>
                  <Pressable onPress={handleRequestCode} disabled={loading} style={styles.codeInlineButton}>
                    <Text style={styles.codeInlineButtonText}>重发</Text>
                  </Pressable>
                </View>

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
                />

                {debugCode ? <Text style={styles.debugCode}>开发验证码：{debugCode}</Text> : null}
                <Pressable
                  style={[styles.primaryButton, (code.replace(/\D/g, '').length !== 6 || loading) && styles.buttonDisabled]}
                  onPress={handleVerify}
                  disabled={code.replace(/\D/g, '').length !== 6 || loading}
                >
                  <Text style={styles.primaryButtonText}>{mode === 'sign-in' ? '完成登录' : '绑定手机号'}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}

        {canUseApple ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Apple 登录</Text>
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={
                mode === 'sign-in'
                  ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
                  : AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
              }
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
              cornerRadius={16}
              style={styles.appleButton}
              onPress={() => {
                void handleAppleButton();
              }}
            />
          </View>
        ) : null}

        {!canUsePhone && !canUseApple ? (
          <View style={styles.block}>
            <Text style={styles.emptyText}>当前账号已经绑定手机号和 Apple，无需重复绑定。</Text>
          </View>
        ) : null}

        {activeError ? <Text style={styles.errorText}>{activeError}</Text> : null}

        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#8B9CF7" />
            <Text style={styles.loadingText}>正在处理中...</Text>
          </View>
        ) : null}

        {mode === 'link' && onCancel ? (
          <Pressable style={styles.cancelButton} onPress={onCancel}>
            <Text style={styles.cancelButtonText}>稍后再说</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

export function LoginScreen({
  visible = true,
  ...props
}: Props) {
  if (!visible) return null;

  if (props.mode === 'link') {
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    padding: 14,
    justifyContent: 'flex-end',
  },
  modalCard: {
    minHeight: '85%',
    overflow: 'hidden',
    borderRadius: 26,
    backgroundColor: '#09090B',
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
  },
  hero: {
    marginTop: 10,
    marginBottom: 24,
  },
  eyebrow: {
    color: '#8B9CF7',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  title: {
    marginTop: 10,
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '700',
  },
  subtitle: {
    marginTop: 10,
    color: 'rgba(255,255,255,0.56)',
    fontSize: 15,
    lineHeight: 22,
  },
  identityCard: {
    borderRadius: 20,
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginBottom: 16,
  },
  identityLabel: {
    color: 'rgba(255,255,255,0.48)',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 10,
  },
  identityWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
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
  block: {
    borderRadius: 22,
    padding: 18,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginBottom: 16,
  },
  blockTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 14,
  },
  phoneRow: {
    flexDirection: 'row',
    gap: 10,
  },
  prefix: {
    width: 70,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  prefixText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  input: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: '#FFFFFF',
    fontSize: 16,
  },
  helperText: {
    marginTop: 10,
    color: 'rgba(255,255,255,0.44)',
    fontSize: 12,
    lineHeight: 18,
  },
  codeWrap: {
    marginTop: 14,
    gap: 12,
    borderRadius: 18,
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  codeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  codeTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  codeHint: {
    color: 'rgba(255,255,255,0.52)',
    fontSize: 13,
    marginTop: 4,
  },
  codeInlineButton: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  codeInlineButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  codeBoxes: {
    flexDirection: 'row',
    gap: 10,
  },
  codeBox: {
    flex: 1,
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeBoxActive: {
    borderColor: '#8B9CF7',
    backgroundColor: 'rgba(139,156,247,0.1)',
  },
  codeBoxFilled: {
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(255,255,255,0.09)',
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
  debugCode: {
    color: '#8B9CF7',
    fontSize: 12,
  },
  primaryButton: {
    marginTop: 12,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    backgroundColor: '#8B9CF7',
  },
  primaryButtonText: {
    color: '#09090B',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    marginTop: 12,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  secondaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  appleButton: {
    width: '100%',
    height: 52,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  errorText: {
    color: '#F87171',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 4,
  },
  emptyText: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 14,
    lineHeight: 22,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
  },
  loadingText: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 13,
  },
  cancelButton: {
    marginTop: 'auto',
    alignItems: 'center',
    paddingVertical: 16,
  },
  cancelButtonText: {
    color: 'rgba(255,255,255,0.48)',
    fontSize: 14,
    fontWeight: '600',
  },
});
