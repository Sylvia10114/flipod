import React, { useCallback, useRef } from 'react';
import { type GestureResponderEvent, StyleSheet, View } from 'react-native';

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
  const barRef = useRef<View>(null);
  const widthRef = useRef(0);
  const offsetRef = useRef(0);

  const measure = useCallback(() => {
    barRef.current?.measure((_x, _y, width, _height, pageX, _pageY) => {
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
      onStartShouldSetResponder={() => { measure(); return true; }}
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
            styles.segment,
            {
              left: `${Math.max(0, Math.min(100, range.start * 100))}%`,
              width: `${Math.max(0, Math.min(100, (range.end - range.start) * 100))}%`,
              backgroundColor: range.color || 'rgba(139,156,247,0.24)',
              opacity: range.opacity ?? 1,
            },
          ]}
        />
      ))}
      {currentSentenceRange ? (
        <View
          style={[
            styles.segment,
            styles.currentSentence,
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

const styles = StyleSheet.create({
  track: {
    height: 32,
    justifyContent: 'center',
    paddingVertical: 12,
  },
  rail: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 13,
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999,
  },
  segment: {
    position: 'absolute',
    top: 13,
    height: 6,
    borderRadius: 999,
  },
  currentSentence: {
    backgroundColor: 'rgba(139,156,247,0.5)',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 13,
    height: 6,
    backgroundColor: '#8B9CF7',
    borderRadius: 999,
  },
  marker: {
    position: 'absolute',
    top: 11,
    width: 1,
    height: 10,
    marginLeft: -0.5,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  thumb: {
    position: 'absolute',
    top: 8,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    marginLeft: -8,
  },
});
