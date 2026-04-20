import React, { type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { radii, spacing } from '../../design';
import { useAppTheme } from '../../theme';
import type { ClipLine } from '../../types';

type RenderArgs = {
  line: ClipLine;
  index: number;
  isActive: boolean;
};

type Props = {
  lines: ClipLine[];
  currentTime: number;
  renderLine: (args: RenderArgs) => ReactNode;
  maxHeight?: number;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
};

function findActiveLineIndex(lines: ClipLine[], currentTime: number) {
  if (!Number.isFinite(currentTime) || currentTime <= 0 || lines.length === 0) {
    return -1;
  }
  const activeIndex = lines.findIndex(line => currentTime >= line.start && currentTime < line.end);
  if (activeIndex >= 0) return activeIndex;
  if (currentTime >= lines[lines.length - 1].end) return lines.length - 1;
  return -1;
}

export function PracticeTranscriptPanel({
  lines,
  currentTime,
  renderLine,
  maxHeight = 340,
  style,
  contentContainerStyle,
}: Props) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const scrollRef = React.useRef<ScrollView | null>(null);
  const lineOffsetsRef = React.useRef<Record<number, number>>({});
  const activeLineIndex = React.useMemo(
    () => findActiveLineIndex(lines, currentTime),
    [currentTime, lines]
  );

  React.useEffect(() => {
    if (activeLineIndex < 0) return;
    const nextY = lineOffsetsRef.current[activeLineIndex];
    if (typeof nextY !== 'number') return;
    scrollRef.current?.scrollTo({
      y: Math.max(0, nextY - 20),
      animated: true,
    });
  }, [activeLineIndex]);

  return (
    <View style={[styles.panel, { maxHeight }, style]}>
      <ScrollView
        ref={scrollRef}
        nestedScrollEnabled
        showsVerticalScrollIndicator
        contentContainerStyle={[styles.content, contentContainerStyle]}
      >
        {lines.map((line, index) => {
          const isActive = index === activeLineIndex;
          return (
            <View
              key={`transcript-${index}-${line.start}`}
              onLayout={event => {
                lineOffsetsRef.current[index] = event.nativeEvent.layout.y;
              }}
              style={[
                styles.lineShell,
                isActive && styles.lineShellActive,
              ]}
            >
              {renderLine({ line, index, isActive })}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    panel: {
      borderRadius: radii.xl,
      backgroundColor: colors.bgSurface2,
      overflow: 'hidden',
    },
    content: {
      padding: spacing.md,
      gap: spacing.sm,
    },
    lineShell: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      borderRadius: radii.lg,
      backgroundColor: 'transparent',
    },
    lineShellActive: {
      backgroundColor: colors.bgSurface1,
      borderWidth: 1,
      borderColor: colors.strokeStrong,
    },
  });
}
