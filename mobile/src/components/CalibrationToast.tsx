import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  visible: boolean;
  message: string;
  acceptLabel: string;
  dismissLabel: string;
  onAccept: () => void;
  onDismiss: () => void;
};

export function CalibrationToast({
  visible,
  message,
  acceptLabel,
  dismissLabel,
  onAccept,
  onDismiss,
}: Props) {
  if (!visible || !message) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.toast}>
        <Text style={styles.text}>{message}</Text>
        <View style={styles.actions}>
          <Pressable onPress={onDismiss} style={[styles.button, styles.buttonSecondary]}>
            <Text style={styles.buttonSecondaryText}>{dismissLabel}</Text>
          </Pressable>
          <Pressable onPress={onAccept} style={[styles.button, styles.buttonPrimary]}>
            <Text style={styles.buttonPrimaryText}>{acceptLabel}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 90,
    alignItems: 'center',
    zIndex: 320,
  },
  toast: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(18,18,28,0.98)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 14,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonPrimary: {
    backgroundColor: '#8B9CF7',
  },
  buttonSecondary: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  buttonPrimaryText: {
    color: '#09090B',
    fontSize: 13,
    fontWeight: '700',
  },
  buttonSecondaryText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
