import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { triggerUiFeedback } from '../feedback';
import type { VocabEntry } from '../types';

type ReviewCardProps = {
  entry: VocabEntry;
  onRemember: () => void;
  onForgot: () => void;
};

export function ReviewCard({ entry, onRemember, onForgot }: ReviewCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>QUICK REVIEW</Text>
      <Text style={styles.cardTitle}>{entry.word}</Text>
      {entry.cefr ? <Text style={styles.inlineMeta}>{entry.cefr}</Text> : null}
      {entry.context ? <Text style={styles.contextEn}>{entry.context}</Text> : null}
      {entry.contextZh ? <Text style={styles.contextZh}>{entry.contextZh}</Text> : null}
      <View style={styles.actionsRow}>
        <Pressable onPress={() => {
          triggerUiFeedback('error');
          onForgot();
        }} style={styles.cardAction}>
          <Text style={styles.cardActionText}>忘了</Text>
        </Pressable>
        <Pressable onPress={() => {
          triggerUiFeedback('correct');
          onRemember();
        }} style={[styles.cardAction, styles.cardActionPrimary]}>
          <Text style={[styles.cardActionText, styles.cardActionTextPrimary]}>记得</Text>
        </Pressable>
      </View>
      <Text style={styles.skipHint}>上滑跳过，下次还会出现</Text>
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
        <Pressable onPress={() => {
          triggerUiFeedback('menu');
          onDismiss();
        }} style={styles.cardAction}>
          <Text style={styles.cardActionText}>保持现状</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            if (recoTag) {
              triggerUiFeedback('like');
              onAccept(recoTag);
            }
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
  inlineMeta: {
    alignSelf: 'flex-start',
    color: 'rgba(255,255,255,0.54)',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  cardDesc: {
    color: 'rgba(255,255,255,0.56)',
    fontSize: 14,
    lineHeight: 20,
  },
  contextEn: {
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 24,
  },
  contextZh: {
    color: 'rgba(255,255,255,0.52)',
    fontSize: 14,
    lineHeight: 22,
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
  skipHint: {
    color: 'rgba(255,255,255,0.36)',
    fontSize: 12,
    textAlign: 'center',
  },
});
