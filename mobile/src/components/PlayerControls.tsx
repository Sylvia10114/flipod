import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatTime } from '../clip-utils';

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const;

type Props = {
  isPlaying: boolean;
  isLoading: boolean;
  positionMillis: number;
  durationMillis: number;
  playbackRate: number;
  showZh: boolean;
  onTogglePlay: () => void;
  onSeekBy: (deltaMs: number) => void;
  onSetRate: (rate: number) => void;
  onToggleZh: () => void;
};

export function PlayerControls({
  isPlaying,
  isLoading,
  positionMillis,
  durationMillis,
  playbackRate,
  showZh,
  onTogglePlay,
  onSeekBy,
  onSetRate,
  onToggleZh,
}: Props) {
  const nextRate = () => {
    const idx = SPEED_OPTIONS.indexOf(playbackRate as typeof SPEED_OPTIONS[number]);
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    onSetRate(next);
  };

  return (
    <View style={styles.container}>
      <View style={styles.timeRow}>
        <Text style={styles.time}>{formatTime(positionMillis)}</Text>
        <Text style={styles.time}>{formatTime(durationMillis)}</Text>
      </View>

      <View style={styles.mainRow}>
        <Pressable onPress={() => onSeekBy(-5000)} style={styles.smallButton}>
          <Text style={styles.smallButtonText}>-5s</Text>
        </Pressable>

        <Pressable onPress={onTogglePlay} style={[styles.playButton, isPlaying && styles.playButtonActive]}>
          <Text style={styles.playButtonText}>
            {isLoading ? '...' : isPlaying ? '暂停' : '播放'}
          </Text>
        </Pressable>

        <Pressable onPress={() => onSeekBy(5000)} style={styles.smallButton}>
          <Text style={styles.smallButtonText}>+5s</Text>
        </Pressable>
      </View>

      <View style={styles.extraRow}>
        <Pressable onPress={nextRate} style={styles.chipButton}>
          <Text style={styles.chipText}>{playbackRate}x</Text>
        </Pressable>
        <Pressable onPress={onToggleZh} style={[styles.chipButton, !showZh && styles.chipButtonDim]}>
          <Text style={styles.chipText}>{showZh ? '中文' : '遮罩'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  time: {
    color: 'rgba(255,255,255,0.48)',
    fontSize: 12,
    fontWeight: '600',
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  smallButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButtonActive: {
    backgroundColor: '#8B9CF7',
  },
  playButtonText: {
    color: '#09090B',
    fontSize: 16,
    fontWeight: '700',
  },
  extraRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
  },
  chipButton: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  chipButtonDim: {
    opacity: 0.5,
  },
  chipText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
});
