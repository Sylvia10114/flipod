import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

type Props = {
  message: string;
  visible: boolean;
};

export function AppToast({ message, visible }: Props) {
  if (!visible || !message) return null;

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View style={styles.toast}>
        <Text style={styles.text}>{message}</Text>
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
    zIndex: 300,
  },
  toast: {
    maxWidth: 320,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(18,18,28,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  text: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
});
