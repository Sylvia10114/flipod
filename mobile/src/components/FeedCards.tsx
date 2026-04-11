import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { VocabEntry } from '../types';

type ReviewCardProps = {
  reviewWords: VocabEntry[];
  onDismiss: () => void;
};

export function ReviewCard({ reviewWords, onDismiss }: ReviewCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>QUICK REVIEW</Text>
      <Text style={styles.cardTitle}>快速回顾一下这些词</Text>
      <View style={styles.wordList}>
        {reviewWords.slice(0, 5).map(item => (
          <View key={item.word} style={styles.wordChip}>
            <Text style={styles.wordChipText}>{item.word}</Text>
            {item.cefr ? <Text style={styles.wordChipCefr}>{item.cefr}</Text> : null}
          </View>
        ))}
      </View>
      <Pressable onPress={onDismiss} style={styles.cardAction}>
        <Text style={styles.cardActionText}>都记住了，继续</Text>
      </Pressable>
    </View>
  );
}

type ProgressCardProps = {
  clipsPlayed: number;
  wordsLearned: number;
  minutesListened: number;
  onContinue: () => void;
};

export function ProgressCard({ clipsPlayed, wordsLearned, minutesListened, onContinue }: ProgressCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>TODAY'S PROGRESS</Text>
      <Text style={styles.cardTitle}>你正在稳步前进</Text>
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{clipsPlayed}</Text>
          <Text style={styles.statLabel}>个片段</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{wordsLearned}</Text>
          <Text style={styles.statLabel}>新词</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{minutesListened}</Text>
          <Text style={styles.statLabel}>分钟</Text>
        </View>
      </View>
      <Pressable onPress={onContinue} style={styles.cardAction}>
        <Text style={styles.cardActionText}>继续刷</Text>
      </Pressable>
    </View>
  );
}

type RecoCardProps = {
  interests: string[];
  recoTag: string | null;
  onAccept: (tag: string) => void;
  onDismiss: () => void;
};

export function RecoCard({ interests, recoTag, onAccept, onDismiss }: RecoCardProps) {
  const tagLabel = recoTag ? `${recoTag[0].toUpperCase()}${recoTag.slice(1)}` : '这个主题';

  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>WE NOTICED</Text>
      <Text style={styles.cardTitle}>你最近明显更喜欢 {tagLabel} 内容</Text>
      <Text style={styles.cardDesc}>
        当前偏好：{interests.join(' · ') || '未设置'}。要不要多推一些 {tagLabel} 方向？
      </Text>
      <View style={styles.actionsRow}>
        <Pressable onPress={onDismiss} style={styles.cardAction}>
          <Text style={styles.cardActionText}>保持现状</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            if (recoTag) onAccept(recoTag);
          }}
          style={[styles.cardAction, styles.cardActionPrimary]}
        >
          <Text style={[styles.cardActionText, styles.cardActionTextPrimary]}>好的，多推一些</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    borderRadius: 24,
    backgroundColor: 'rgba(139,156,247,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(139,156,247,0.24)',
    paddingHorizontal: 20,
    paddingVertical: 24,
    gap: 14,
  },
  kicker: {
    color: '#8B9CF7',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
  },
  cardDesc: {
    color: 'rgba(255,255,255,0.56)',
    fontSize: 14,
    lineHeight: 20,
  },
  wordList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  wordChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  wordChipText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  wordChipCefr: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 20,
  },
  stat: {
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
  },
  statLabel: {
    color: 'rgba(255,255,255,0.48)',
    fontSize: 12,
    fontWeight: '600',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  cardAction: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  cardActionPrimary: {
    backgroundColor: '#8B9CF7',
  },
  cardActionText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  cardActionTextPrimary: {
    color: '#09090B',
  },
});
