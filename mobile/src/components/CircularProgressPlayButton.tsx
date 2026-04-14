import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../design';

type Props = {
  progress: number;
  isPlaying: boolean;
  onPress: () => void;
  size?: number;
  buttonSize?: number;
  color?: string;
};

export function CircularProgressPlayButton({
  progress,
  isPlaying,
  onPress,
  size = 80,
  buttonSize = 64,
  color = colors.accentPractice,
}: Props) {
  const segmentCount = 48;
  const segmentWidth = 3;
  const segmentLength = Math.max(8, Math.round(size * 0.11));
  const radius = useMemo(() => (size - segmentLength) / 2, [segmentLength, size]);
  const boundedProgress = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  const litSegmentCount = useMemo(
    () => Math.max(0, Math.min(segmentCount, Math.round(boundedProgress * segmentCount))),
    [boundedProgress]
  );
  const segments = useMemo(() => {
    const center = size / 2;
    return Array.from({ length: segmentCount }, (_unused, index) => {
      const angleDeg = (index / segmentCount) * 360 - 90;
      const angleRad = (angleDeg * Math.PI) / 180;
      const x = center + Math.cos(angleRad) * radius - segmentWidth / 2;
      const y = center + Math.sin(angleRad) * radius - segmentLength / 2;

      return {
        key: `segment-${index}`,
        left: x,
        top: y,
        rotation: `${angleDeg + 90}deg`,
        active: index < litSegmentCount,
      };
    });
  }, [litSegmentCount, radius, segmentLength, size]);

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <View pointerEvents="none" style={styles.ringLayer}>
        {segments.map(segment => (
          <View
            key={segment.key}
            style={[
              styles.segment,
              {
                left: segment.left,
                top: segment.top,
                width: segmentWidth,
                height: segmentLength,
                borderRadius: segmentWidth,
                backgroundColor: color,
                opacity: segment.active ? 0.72 : 0.16,
                transform: [{ rotate: segment.rotation }],
              },
            ]}
          />
        ))}
      </View>
      <Pressable
        onPress={onPress}
        style={[
          styles.button,
          {
            width: buttonSize,
            height: buttonSize,
            borderRadius: buttonSize / 2,
            backgroundColor: color,
          },
        ]}
      >
        <Feather
          name={isPlaying ? 'pause' : 'play'}
          size={buttonSize >= 64 ? 28 : 22}
          color={colors.textOnAccent}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  segment: {
    position: 'absolute',
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
