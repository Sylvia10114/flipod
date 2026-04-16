import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../theme';

type Props = {
  message: string;
  visible: boolean;
};

export function AppToast({ message, visible }: Props) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  if (!visible || !message) return null;

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View style={styles.toast}>
        <Text style={styles.text}>{message}</Text>
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
    zIndex: 300,
  },
  toast: {
    maxWidth: 320,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: colors.bgOverlay,
    borderWidth: 1,
    borderColor: colors.strokeStrong,
  },
  text: {
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  });
}
