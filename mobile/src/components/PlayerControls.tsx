import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { formatTime } from '../clip-utils';
import { colors, radii, spacing, typography } from '../design';
import { triggerMediumHaptic } from '../feedback';
import type { DominantHand } from '../types';

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const;

type Props = {
  isPlaying: boolean;
  isLoading: boolean;
  positionMillis: number;
  durationMillis: number;
  playbackRate: number;
  dominantHand: DominantHand;
  showZh: boolean;
  masked: boolean;
  onTogglePlay: () => void;
  onSeekPrevSentence: () => void;
  onSeekNextSentence: () => void;
  onSetRate: (rate: number) => void;
  onToggleZh: () => void;
  onToggleMask: () => void;
  onOpenMenu: () => void;
};

type TransportButtonProps = {
  icon: React.ComponentProps<typeof Feather>['name'];
  onPress: () => void;
  primary?: boolean;
};

function TransportButton({ icon, onPress, primary = false }: TransportButtonProps) {
  return (
    <Pressable onPress={onPress} style={[styles.transportButton, primary && styles.transportButtonPrimary]}>
      <Feather
        name={icon}
        size={primary ? 22 : 20}
        color={primary ? colors.textOnAccent : colors.textSecondary}
      />
    </Pressable>
  );
}

export function PlayerControls({
  isPlaying,
  isLoading,
  positionMillis,
  durationMillis,
  playbackRate,
  dominantHand,
  showZh,
  masked,
  onTogglePlay,
  onSeekPrevSentence,
  onSeekNextSentence,
  onSetRate,
  onToggleZh,
  onToggleMask,
}: Props) {
  const nextRate = () => {
    const idx = SPEED_OPTIONS.indexOf(playbackRate as typeof SPEED_OPTIONS[number]);
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    onSetRate(next);
  };

  return (
    <View style={styles.container}>
      <View style={styles.timeRow}>
        <Text style={styles.timeText}>{formatTime(positionMillis)}</Text>
        <Text style={styles.timeText}>{formatTime(durationMillis)}</Text>
      </View>

      <View style={styles.transportRow}>
        <TransportButton
          icon="rotate-ccw"
          onPress={() => {
            triggerMediumHaptic();
            onSeekPrevSentence();
          }}
        />
        <TransportButton
          icon={isLoading ? 'minus' : isPlaying ? 'pause' : 'play'}
          primary
          onPress={() => {
            triggerMediumHaptic();
            onTogglePlay();
          }}
        />
        <TransportButton
          icon="rotate-cw"
          onPress={() => {
            triggerMediumHaptic();
            onSeekNextSentence();
          }}
        />
      </View>

      <View style={[styles.utilityRow, dominantHand === 'left' && styles.utilityRowLeft]}>
        <Pressable
          onPress={() => {
            triggerMediumHaptic();
            onToggleZh();
          }}
          style={[styles.utilityButton, showZh && styles.utilityButtonActive]}
        >
          <Feather name="eye" size={14} color={showZh ? colors.textPrimary : colors.textTertiary} />
        </Pressable>
        <Pressable
          onPress={() => {
            triggerMediumHaptic();
            onToggleMask();
          }}
          style={[styles.utilityButton, masked && styles.utilityButtonActive]}
        >
          <Text style={[styles.utilityButtonText, masked && styles.utilityButtonTextActive]}>A</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            triggerMediumHaptic();
            nextRate();
          }}
          style={[styles.utilityButton, playbackRate !== 1 && styles.utilityButtonActive]}
        >
          <Text style={[styles.utilityButtonText, playbackRate !== 1 && styles.utilityButtonTextActive]}>
            {playbackRate}x
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: spacing.md,
  },
  timeRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timeText: {
    color: colors.textTertiary,
    fontSize: typography.micro,
    fontWeight: '600',
  },
  transportRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xl,
  },
  transportButton: {
    width: 42,
    height: 42,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transportButtonPrimary: {
    width: 58,
    height: 58,
    backgroundColor: colors.accentFeed,
  },
  transportButtonText: {
    color: colors.textSecondary,
    fontSize: typography.title,
    fontWeight: '700',
  },
  transportButtonTextPrimary: {
    color: colors.textOnAccent,
    fontSize: 18,
  },
  utilityRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  utilityRowLeft: {
    flexDirection: 'row-reverse',
  },
  utilityButton: {
    minWidth: 24,
    borderRadius: radii.pill,
    backgroundColor: 'transparent',
    paddingVertical: 2,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  utilityButtonActive: {
    opacity: 1,
  },
  utilityButtonText: {
    color: colors.textTertiary,
    fontSize: typography.micro,
    fontWeight: '600',
  },
  utilityButtonTextActive: {
    color: colors.textPrimary,
  },
});
