import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radii, typography } from '../../design';
import { useAppTheme } from '../../theme';

type Props = {
  total: number;
  activeIndex?: number;
  completedIndexes?: number[];
  warningIndexes?: number[];
  caption?: string | null;
};

export function PracticeSegmentMeter({
  total,
  activeIndex,
  completedIndexes = [],
  warningIndexes = [],
  caption,
}: Props) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  if (total <= 0) return null;

  return (
    <>
      <View style={styles.row}>
        {Array.from({ length: total }).map((_, index) => (
          <View
            key={`segment-${index}`}
            style={[
              styles.segment,
              completedIndexes.includes(index) && styles.segmentDone,
              warningIndexes.includes(index) && styles.segmentWarning,
              index === activeIndex && styles.segmentActive,
            ]}
          />
        ))}
      </View>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      gap: 6,
    },
    segment: {
      flex: 1,
      height: 6,
      borderRadius: radii.pill,
      backgroundColor: colors.bgSurface3,
    },
    segmentDone: {
      backgroundColor: `${colors.accentPractice}66`,
    },
    segmentActive: {
      backgroundColor: colors.accentPractice,
    },
    segmentWarning: {
      backgroundColor: 'rgba(245,158,11,0.68)',
    },
    caption: {
      color: colors.textTertiary,
      fontSize: typography.caption,
      textAlign: 'right',
    },
  });
}
