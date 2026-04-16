import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Ionicons } from '@expo/vector-icons';
import { formatTime } from '../clip-utils';
import { radii, spacing, typography } from '../design';
import { triggerMediumHaptic } from '../feedback';
import { useAppTheme } from '../theme';
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
  icon: React.ComponentProps<typeof Feather>['name'] | 'play' | 'pause';
  onPress: () => void;
  primary?: boolean;
};

function TransportButton({ icon, onPress, primary = false }: TransportButtonProps) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const content = (() => {
    if (icon === 'play') {
      return (
        <Ionicons
          name="play"
          size={28}
          color={colors.textOnAccent}
          style={styles.primaryPlayIcon}
        />
      );
    }

    if (icon === 'pause') {
      return <Ionicons name="pause" size={24} color={colors.textOnAccent} />;
    }

    return (
      <Feather
        name={icon}
        size={primary ? 22 : 20}
        color={primary ? colors.textOnAccent : colors.textSecondary}
      />
    );
  })();

  return (
    <Pressable onPress={onPress} style={[styles.transportButton, primary && styles.transportButtonPrimary]}>
      {content}
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
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
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
            onToggleMask();
          }}
          style={[styles.utilityButton, masked && styles.utilityButtonActive]}
        >
          <Feather name={masked ? 'eye-off' : 'eye'} size={18} color={masked ? colors.textPrimary : colors.textTertiary} />
        </Pressable>
        <Pressable
          onPress={() => {
            triggerMediumHaptic();
            onToggleZh();
          }}
          style={[styles.utilityButton, showZh && styles.utilityButtonActive]}
        >
          <Text style={[styles.utilityButtonText, showZh && styles.utilityButtonTextActive]}>A</Text>
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

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
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
  primaryPlayIcon: {
    transform: [{ translateX: 2 }],
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
    marginTop: 6,
    gap: spacing.lg,
  },
  utilityRowLeft: {
    flexDirection: 'row-reverse',
  },
  utilityButton: {
    minWidth: 42,
    minHeight: 36,
    borderRadius: radii.pill,
    backgroundColor: 'transparent',
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  utilityButtonActive: {
    opacity: 1,
  },
  utilityButtonText: {
    color: colors.textTertiary,
    fontSize: typography.body,
    fontWeight: '600',
  },
  utilityButtonTextActive: {
    color: colors.textPrimary,
  },
  });
}
