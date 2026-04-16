import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radii, spacing } from '../design';
import { useAppTheme } from '../theme';
import type { ClipLine, ClipLineWord, SubtitleSize } from '../types';

function spokenWordStyle(cefr: string | undefined, styles: ReturnType<typeof createStyles>) {
  const normalized = (cefr || '').toUpperCase();
  if (normalized === 'A1' || normalized === 'A2') return styles.wordSpokenA;
  if (normalized === 'B1') return styles.wordSpokenB1;
  if (normalized === 'B2') return styles.wordSpokenB2;
  if (normalized === 'C1') return styles.wordSpokenC1;
  if (normalized === 'C2') return styles.wordSpokenC2;
  return styles.wordSpokenBase;
}

type Props = {
  line: ClipLine;
  currentTime: number;
  isActive: boolean;
  showZh: boolean;
  masked?: boolean;
  practiced?: boolean;
  compact?: boolean;
  subtitleSize?: SubtitleSize;
  onWordTap: (word: ClipLineWord, line: ClipLine) => void;
};

function restorePunctuation(words: ClipLineWord[], fullText: string) {
  let searchPos = 0;
  return words.map(w => {
    const bare = w.word.trim();
    const idx = fullText.toLowerCase().indexOf(bare.toLowerCase(), searchPos);
    let trailing = '';
    if (idx >= 0) {
      const after = idx + bare.length;
      searchPos = after;
      const match = fullText.slice(after).match(/^([^a-zA-Z0-9\s]*)/);
      if (match && match[1]) trailing = match[1];
    }
    return { ...w, display: bare + trailing };
  });
}

export function WordLine({
  line,
  currentTime,
  isActive,
  showZh,
  masked = false,
  practiced = false,
  compact = false,
  subtitleSize = 'md',
  onWordTap,
}: Props) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const englishScale = subtitleSize === 'sm' ? 0.9 : subtitleSize === 'lg' ? 1.12 : 1;
  const zhScale = subtitleSize === 'sm' ? 0.92 : subtitleSize === 'lg' ? 1.08 : 1;
  const wordScaleStyle = compact
    ? { fontSize: 18 * englishScale, lineHeight: 28 * englishScale }
    : { fontSize: 22 * englishScale, lineHeight: 33 * englishScale };
  const plainScaleStyle = compact
    ? { fontSize: 18 * englishScale, lineHeight: 28 * englishScale }
    : { fontSize: 22 * englishScale, lineHeight: 33 * englishScale };
  const zhScaleStyle = { fontSize: 14 * zhScale, lineHeight: 20 * zhScale };

  if (!line.words || line.words.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={[styles.plainEn, compact && styles.plainEnCompact, masked && styles.plainEnMasked, plainScaleStyle]}>
          {line.en}
        </Text>
        {showZh && <Text style={[styles.zh, zhScaleStyle]}>{line.zh || ''}</Text>}
      </View>
    );
  }

  const enriched = restorePunctuation(line.words, line.en || '');

  return (
    <View style={styles.container}>
      <View style={styles.wordRow}>
        {enriched.map((w, i) => {
          const active = isActive && currentTime >= w.start && currentTime < w.end;
          const spoken = isActive && currentTime >= w.end;
          return (
            <Pressable key={`${w.word}-${i}`} onPress={() => onWordTap(w, line)}>
              <Text
                style={[
                  styles.word,
                  compact && styles.wordCompact,
                  wordScaleStyle,
                  !masked && styles.wordDim,
                  !masked && spoken && spokenWordStyle(w.cefr, styles),
                  !masked && active && styles.wordActive,
                  masked && styles.wordMasked,
                  masked && (spoken || active) && styles.wordMaskedProgress,
                  practiced && styles.wordPracticed,
                ]}
              >
                {w.display || w.word}{' '}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {showZh && <Text style={[styles.zh, zhScaleStyle]}>{line.zh || ''}</Text>}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  wordRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  word: {
    fontSize: 22,
    lineHeight: 33,
    fontWeight: '400',
    textAlign: 'center',
  },
  wordDim: {
    color: colors.wordDim,
  },
  wordCompact: {
    fontSize: 18,
    lineHeight: 28,
  },
  wordMasked: {
    color: 'transparent',
    backgroundColor: colors.maskBg,
    borderRadius: radii.sm,
    paddingHorizontal: 3,
    paddingVertical: 2,
    marginHorizontal: 1,
    marginVertical: 2,
  },
  wordMaskedProgress: {
    backgroundColor: colors.maskBgSpoken,
  },
  wordActive: {
    color: colors.wordActive,
  },
  wordSpokenBase: {
    color: colors.wordSpoken,
  },
  wordSpokenA: {
    color: colors.cefrA,
  },
  wordSpokenB1: {
    color: colors.cefrB1,
    fontWeight: '700',
  },
  wordSpokenB2: {
    color: colors.cefrB2,
    fontWeight: '700',
  },
  wordSpokenC1: {
    color: colors.cefrC1,
    fontWeight: '700',
  },
  wordSpokenC2: {
    color: colors.cefrC2,
    fontWeight: '700',
  },
  wordPracticed: {
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
    textDecorationColor: colors.accentPractice,
  },
  plainEn: {
    color: colors.textPrimary,
    fontSize: 22,
    lineHeight: 33,
    textAlign: 'center',
  },
  plainEnCompact: {
    fontSize: 18,
    lineHeight: 28,
  },
  plainEnMasked: {
    color: 'transparent',
    backgroundColor: colors.bgSurface2,
    borderRadius: radii.md,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  zh: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  });
}
