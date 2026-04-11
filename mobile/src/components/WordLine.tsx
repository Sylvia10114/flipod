import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ClipLine, ClipLineWord } from '../types';

const CEFR_COLORS: Record<string, string> = {
  A1: 'rgba(255,255,255,0.92)',
  A2: 'rgba(255,255,255,0.92)',
  B1: '#7DD3FC',
  B2: '#A78BFA',
  C1: '#FB923C',
  C2: '#F87171',
};

function cefrColor(cefr?: string) {
  if (!cefr) return 'rgba(255,255,255,0.92)';
  return CEFR_COLORS[cefr.toUpperCase()] || 'rgba(255,255,255,0.92)';
}

type Props = {
  line: ClipLine;
  currentTime: number;
  isActive: boolean;
  showZh: boolean;
  masked?: boolean;
  practiced?: boolean;
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
  onWordTap,
}: Props) {
  if (!line.words || line.words.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.plainEn}>{line.en}</Text>
        {showZh && <Text style={styles.zh}>{line.zh || ''}</Text>}
      </View>
    );
  }

  const enriched = restorePunctuation(line.words, line.en || '');

  return (
    <View style={styles.container}>
      <View style={styles.wordRow}>
        {enriched.map((w, i) => {
          const active = isActive && currentTime >= w.start && currentTime <= w.end;
          const spoken = isActive && currentTime > w.end;
          const dimmed = masked && !active && !spoken;
          return (
            <Pressable key={`${w.word}-${i}`} onPress={() => onWordTap(w, line)}>
              <Text
                style={[
                  styles.word,
                  { color: dimmed ? 'rgba(255,255,255,0.20)' : cefrColor(w.cefr) },
                  spoken && styles.wordSpoken,
                  active && styles.wordActive,
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
    gap: 10,
  },
  wordRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  word: {
    fontSize: 24,
    lineHeight: 36,
    fontWeight: '500',
  },
  wordActive: {
    color: '#8B9CF7',
    backgroundColor: 'rgba(139,156,247,0.18)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  wordSpoken: {
    color: 'rgba(255,255,255,0.93)',
  },
  wordPracticed: {
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
    textDecorationColor: '#8B9CF7',
  },
  plainEn: {
    color: '#FFFFFF',
    fontSize: 24,
    lineHeight: 36,
    textAlign: 'center',
  },
  zh: {
    color: 'rgba(255,255,255,0.52)',
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
});
