import React, { useCallback, useRef } from 'react';
import { type GestureResponderEvent, StyleSheet, View } from 'react-native';
import { useAppTheme } from '../theme';

type Range = {
  start: number;
  end: number;
  color?: string;
  opacity?: number;
};

type Props = {
  progress: number;
  markers?: number[];
  currentSentenceRange?: Range | null;
  highlightRanges?: Range[];
  onSeek: (ratio: number) => void;
};

export function ProgressBar({ progress, markers = [], currentSentenceRange, highlightRanges = [], onSeek }: Props) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const barRef = useRef<View>(null);
  const widthRef = useRef(0);
  const offsetRef = useRef(0);

  const measure = useCallback(() => {
    barRef.current?.measure((_x, _y, width, _height, pageX) => {
      widthRef.current = width;
      offsetRef.current = pageX;
    });
  }, []);

  const ratioFromEvent = useCallback((evt: GestureResponderEvent) => {
    const x = evt.nativeEvent.pageX - offsetRef.current;
    return Math.max(0, Math.min(1, x / (widthRef.current || 1)));
  }, []);

  return (
    <View
      ref={barRef}
      style={styles.track}
      onLayout={measure}
      onStartShouldSetResponder={() => {
        measure();
        return true;
      }}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={evt => onSeek(ratioFromEvent(evt))}
      onResponderMove={evt => onSeek(ratioFromEvent(evt))}
      onResponderRelease={evt => onSeek(ratioFromEvent(evt))}
    >
      <View style={styles.rail} />
      {highlightRanges.map((range, index) => (
        <View
          key={`highlight-${index}`}
          style={[
            styles.range,
            {
              left: `${Math.max(0, Math.min(100, range.start * 100))}%`,
              width: `${Math.max(0, Math.min(100, (range.end - range.start) * 100))}%`,
              backgroundColor: range.color || 'rgba(168,85,247,0.18)',
              opacity: range.opacity ?? 1,
            },
          ]}
        />
      ))}
      {currentSentenceRange ? (
        <View
          style={[
            styles.range,
            styles.currentRange,
            {
              left: `${Math.max(0, Math.min(100, currentSentenceRange.start * 100))}%`,
              width: `${Math.max(0, Math.min(100, (currentSentenceRange.end - currentSentenceRange.start) * 100))}%`,
            },
          ]}
        />
      ) : null}
      <View style={[styles.fill, { width: `${Math.max(0, Math.min(100, progress * 100))}%` }]} />
      {markers.map((marker, index) => (
        <View
          key={`marker-${index}`}
          style={[styles.marker, { left: `${Math.max(0, Math.min(100, marker * 100))}%` }]}
        />
      ))}
      <View style={[styles.thumb, { left: `${Math.max(0, Math.min(100, progress * 100))}%` }]} />
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
  track: {
    width: '100%',
    height: 22,
    justifyContent: 'center',
  },
  rail: {
    position: 'absolute',
    top: 9,
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.progressBg,
  },
  range: {
    position: 'absolute',
    top: 9,
    height: 4,
    borderRadius: 999,
  },
  currentRange: {
    backgroundColor: `${colors.progressFill}73`,
  },
  fill: {
    position: 'absolute',
    top: 9,
    left: 0,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.progressFill,
  },
  marker: {
    position: 'absolute',
    top: 7,
    width: 1,
    height: 8,
    marginLeft: -0.5,
    backgroundColor: colors.textTertiary,
  },
  thumb: {
    position: 'absolute',
    top: 6,
    width: 10,
    height: 10,
    borderRadius: 999,
    marginLeft: -5,
    backgroundColor: colors.textPrimary,
  },
  });
}
