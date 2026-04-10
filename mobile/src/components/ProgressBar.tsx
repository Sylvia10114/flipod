import React, { useCallback, useRef } from 'react';
import { type GestureResponderEvent, Pressable, StyleSheet, View } from 'react-native';

type Props = {
  progress: number;
  onSeek: (ratio: number) => void;
};

export function ProgressBar({ progress, onSeek }: Props) {
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
      <View style={[styles.fill, { width: `${Math.max(0, Math.min(100, progress * 100))}%` }]} />
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
  fill: {
    position: 'absolute',
    left: 0,
    top: 13,
    height: 6,
    backgroundColor: '#8B9CF7',
    borderRadius: 999,
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
