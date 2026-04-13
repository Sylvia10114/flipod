import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { triggerUiFeedback } from '../feedback';

type Props = {
  preparing?: boolean;
  onBegin?: () => void;
};

export function StartScreen({ preparing = false, onBegin }: Props) {
  if (preparing) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.container, styles.centered]}>
          <Text style={styles.transitionText}>正在为你准备内容...</Text>
          <View style={styles.dotsRow}>
            <View style={styles.dot} />
            <View style={styles.dot} />
            <View style={styles.dot} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <Pressable
        style={[styles.container, styles.centered]}
        onPress={() => {
          triggerUiFeedback('primary');
          onBegin?.();
        }}
      >
        <View style={styles.ambient} />
        <Text style={styles.title}>先听这一条</Text>
        <Text style={styles.subtitle}>我挑了几段适合现在开始的内容</Text>
        <View style={styles.divider} />
        <Text style={styles.tapHint}>Tap to begin</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#09090B',
  },
  container: {
    flex: 1,
    paddingHorizontal: 28,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  ambient: {
    width: 80,
    height: 1,
    backgroundColor: '#8B9CF7',
    opacity: 0.15,
    marginBottom: 48,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '500',
    lineHeight: 36,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 10,
    color: 'rgba(255,255,255,0.30)',
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
  },
  divider: {
    width: 40,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginTop: 48,
  },
  tapHint: {
    position: 'absolute',
    bottom: 80,
    color: 'rgba(255,255,255,0.22)',
    fontSize: 13,
  },
  transitionText: {
    color: 'rgba(255,255,255,0.76)',
    fontSize: 16,
    fontWeight: '600',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
});
