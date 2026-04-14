import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../design';
import type { ClipLine, ClipLineWord } from '../types';

function spokenWordStyle(cefr?: string) {
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
  onWordTap,
}: Props) {
  if (!line.words || line.words.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={[styles.plainEn, compact && styles.plainEnCompact, masked && styles.plainEnMasked]}>{line.en}</Text>
        {showZh && <Text style={styles.zh}>{line.zh || ''}</Text>}
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
                  !masked && styles.wordDim,
                  !masked && spoken && spokenWordStyle(w.cefr),
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
      {showZh && <Text style={styles.zh}>{line.zh || ''}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
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
    color: 'rgba(255,255,255,0.20)',
  },
  wordCompact: {
    fontSize: 18,
    lineHeight: 28,
  },
  wordMasked: {
    color: 'transparent',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: radii.sm,
    paddingHorizontal: 3,
    paddingVertical: 2,
    marginHorizontal: 1,
    marginVertical: 2,
  },
  wordMaskedProgress: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  wordActive: {
    color: colors.accentFeed,
  },
  wordSpokenBase: {
    color: 'rgba(255,255,255,0.93)',
  },
  wordSpokenA: {
    color: 'rgba(255,255,255,0.87)',
  },
  wordSpokenB1: {
    color: '#7AAFC4',
    fontWeight: '700',
  },
  wordSpokenB2: {
    color: '#C4A96E',
    fontWeight: '700',
  },
  wordSpokenC1: {
    color: '#C47A6E',
    fontWeight: '700',
  },
  wordSpokenC2: {
    color: '#C97BDB',
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
