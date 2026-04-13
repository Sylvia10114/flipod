import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatTime } from '../clip-utils';
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
  onOpenMenu,
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
        <Pressable onPress={() => {
          triggerMediumHaptic();
          onSeekPrevSentence();
        }} style={styles.smallButton}>
          <Text style={styles.smallButtonText}>上句</Text>
        </Pressable>

        <Pressable onPress={() => {
          triggerMediumHaptic();
          onTogglePlay();
        }} style={[styles.playButton, isPlaying && styles.playButtonActive]}>
          <Text style={styles.playButtonText}>{isLoading ? '...' : isPlaying ? '暂停' : '播放'}</Text>
        </Pressable>

        <Pressable onPress={() => {
          triggerMediumHaptic();
          onSeekNextSentence();
        }} style={styles.smallButton}>
          <Text style={styles.smallButtonText}>下句</Text>
        </Pressable>
      </View>

      <View style={styles.bottomRow}>
        <View style={[styles.extraRow, dominantHand === 'left' && styles.extraRowLeft]}>
          <Pressable onPress={() => {
            triggerMediumHaptic();
            onToggleMask();
          }} style={[styles.chipButton, masked && styles.chipButtonActive]}>
            <Text style={[styles.chipText, masked && styles.chipTextActive]}>{masked ? '遮罩开' : '遮罩'}</Text>
          </Pressable>
          <Pressable onPress={() => {
            triggerMediumHaptic();
            onToggleZh();
          }} style={[styles.chipButton, showZh && styles.chipButtonActive]}>
            <Text style={[styles.chipText, showZh && styles.chipTextActive]}>{showZh ? '中文开' : '中文'}</Text>
          </Pressable>
          <Pressable onPress={() => {
            triggerMediumHaptic();
            nextRate();
          }} style={[styles.chipButton, playbackRate !== 1 && styles.chipButtonActive]}>
            <Text style={[styles.chipText, playbackRate !== 1 && styles.chipTextActive]}>{playbackRate}x</Text>
          </Pressable>
          <Pressable onPress={() => {
            triggerMediumHaptic();
            onOpenMenu();
          }} style={styles.menuButton}>
            <Text style={styles.menuButtonText}>···</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
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
    minWidth: 68,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  smallButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
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
  bottomRow: {
    alignItems: 'stretch',
  },
  extraRow: {
    flexDirection: 'row',
    gap: 10,
    flex: 1,
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  extraRowLeft: {
    flexDirection: 'row-reverse',
  },
  chipButton: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  chipButtonActive: {
    backgroundColor: 'rgba(139,156,247,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(139,156,247,0.28)',
  },
  chipText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#DDE3FF',
  },
  menuButton: {
    minWidth: 44,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  menuButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    lineHeight: 18,
    fontWeight: '700',
  },
});
