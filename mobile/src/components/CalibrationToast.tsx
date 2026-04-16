import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../theme';

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
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
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

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
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
    backgroundColor: colors.bgOverlay,
    borderWidth: 1,
    borderColor: colors.strokeStrong,
    gap: 14,
  },
  text: {
    color: colors.textPrimary,
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
    backgroundColor: colors.accentFeed,
  },
  buttonSecondary: {
    backgroundColor: colors.bgSurface2,
  },
  buttonPrimaryText: {
    color: colors.textOnAccent,
    fontSize: 13,
    fontWeight: '700',
  },
  buttonSecondaryText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  });
}
