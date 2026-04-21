import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Ionicons } from '@expo/vector-icons';
import { formatTime } from '../clip-utils';
import { radii, spacing, typography } from '../design';
import { triggerMediumHaptic } from '../feedback';
import { useAppTheme } from '../theme';
import type { DominantHand, PlaybackPhase, SubtitleSize } from '../types';

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const;

type Props = {
  playbackPhase: PlaybackPhase;
  disabled?: boolean;
  positionMillis: number;
  durationMillis: number;
  playbackRate: number;
  subtitleSize: SubtitleSize;
  dominantHand: DominantHand;
  showZh: boolean;
  masked: boolean;
  progressBar?: ReactNode;
  onTogglePlay: () => void;
  onSeekPrevSentence: () => void;
  onSeekNextSentence: () => void;
  onSetRate: (rate: number) => void;
  onCycleSubtitleSize: () => void;
  onToggleZh: () => void;
  onToggleMask: () => void;
};

type TransportButtonProps = {
  icon: React.ComponentProps<typeof Feather>['name'] | 'play' | 'pause';
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
};

function TransportButton({ icon, onPress, primary = false, disabled = false }: TransportButtonProps) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const iconColor = primary
    ? (disabled ? colors.textSecondary : colors.textOnAccent)
    : colors.textSecondary;
  const content = (() => {
    if (icon === 'play') {
      return (
        <Ionicons
          name="play"
          size={28}
          color={iconColor}
          style={styles.primaryPlayIcon}
        />
      );
    }

    if (icon === 'pause') {
      return <Ionicons name="pause" size={24} color={iconColor} />;
    }

    return (
      <Feather
        name={icon}
        size={primary ? 22 : 20}
        color={iconColor}
      />
    );
  })();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.transportButton,
        primary && styles.transportButtonPrimary,
        disabled && styles.transportButtonDisabled,
        disabled && primary && styles.transportButtonPrimaryDisabled,
      ]}
    >
      {content}
    </Pressable>
  );
}

function GoogleTranslateIcon({ active }: { active: boolean }) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.translateIcon}>
      <View style={[styles.translateCardBack, active && styles.translateCardBackActive]}>
        <Text style={[styles.translateBackText, active && styles.translateBackTextActive]}>文</Text>
      </View>
      <View style={[styles.translateCardFront, active && styles.translateCardFrontActive]}>
        <Text style={[styles.translateFrontText, active && styles.translateFrontTextActive]}>A</Text>
      </View>
    </View>
  );
}

function subtitleSizeLabel(size: SubtitleSize) {
  if (size === 'sm') return 'A-';
  if (size === 'lg') return 'A+';
  return 'A';
}

export function PlayerControls({
  playbackPhase,
  disabled = false,
  positionMillis,
  durationMillis,
  playbackRate,
  subtitleSize,
  dominantHand,
  showZh,
  masked,
  progressBar,
  onTogglePlay,
  onSeekPrevSentence,
  onSeekNextSentence,
  onSetRate,
  onCycleSubtitleSize,
  onToggleZh,
  onToggleMask,
}: Props) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const isPlaying = playbackPhase === 'playing';
  const transportDisabled = disabled || playbackPhase === 'loading';
  const nextRate = () => {
    const idx = SPEED_OPTIONS.indexOf(playbackRate as typeof SPEED_OPTIONS[number]);
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    onSetRate(next);
  };

  return (
    <View style={styles.container}>
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
          <GoogleTranslateIcon active={showZh} />
        </Pressable>
        <Pressable
          onPress={() => {
            triggerMediumHaptic();
            onCycleSubtitleSize();
          }}
          style={[styles.utilityButton, subtitleSize !== 'md' && styles.utilityButtonActive]}
        >
          <Text style={[styles.utilityButtonText, subtitleSize !== 'md' && styles.utilityButtonTextActive]}>
            {subtitleSizeLabel(subtitleSize)}
          </Text>
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

      <View style={styles.transportRow}>
        <TransportButton
          icon="rotate-ccw"
          disabled={transportDisabled}
          onPress={() => {
            triggerMediumHaptic();
            onSeekPrevSentence();
          }}
        />
        <TransportButton
          icon={isPlaying ? 'pause' : 'play'}
          disabled={transportDisabled}
          primary
          onPress={() => {
            triggerMediumHaptic();
            onTogglePlay();
          }}
        />
        <TransportButton
          icon="rotate-cw"
          disabled={transportDisabled}
          onPress={() => {
            triggerMediumHaptic();
            onSeekNextSentence();
          }}
        />
      </View>

      <View style={styles.progressSection}>
        {progressBar}
        <View style={styles.timeRow}>
          <Text style={styles.timeText}>{formatTime(positionMillis)}</Text>
          <Text style={styles.timeText}>{formatTime(durationMillis)}</Text>
        </View>
      </View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
  container: {
    width: '100%',
    gap: spacing.lg,
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
  transportButtonDisabled: {
    opacity: 0.45,
  },
  transportButtonPrimaryDisabled: {
    backgroundColor: colors.bgSurface2,
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
    alignItems: 'center',
    gap: spacing.md,
    paddingRight: spacing.xs,
  },
  utilityRowLeft: {
    flexDirection: 'row-reverse',
  },
  utilityButton: {
    minWidth: 48,
    minHeight: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.bgSurface1,
    borderWidth: 1,
    borderColor: colors.stroke,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  utilityButtonActive: {
    backgroundColor: colors.bgSurface2,
    borderColor: colors.strokeStrong,
  },
  utilityButtonText: {
    color: colors.textTertiary,
    fontSize: typography.body,
    fontWeight: '600',
  },
  utilityButtonTextActive: {
    color: colors.textPrimary,
  },
  progressSection: {
    width: '100%',
    gap: 2,
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
  translateIcon: {
    width: 22,
    height: 18,
  },
  translateCardBack: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: 13,
    height: 13,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.textTertiary,
    backgroundColor: colors.bgApp,
    alignItems: 'center',
    justifyContent: 'center',
  },
  translateCardBackActive: {
    borderColor: colors.textPrimary,
  },
  translateBackText: {
    color: colors.textTertiary,
    fontSize: 7,
    fontWeight: '700',
  },
  translateBackTextActive: {
    color: colors.textPrimary,
  },
  translateCardFront: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 13,
    height: 13,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.textTertiary,
    backgroundColor: colors.bgSurface1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  translateCardFrontActive: {
    borderColor: colors.textPrimary,
  },
  translateFrontText: {
    color: colors.textTertiary,
    fontSize: 8,
    fontWeight: '700',
  },
  translateFrontTextActive: {
    color: colors.textPrimary,
  },
  });
}
