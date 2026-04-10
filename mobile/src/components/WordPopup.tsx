import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ClipLineWord } from '../types';

type Props = {
  word: ClipLineWord;
  contextEn: string;
  contextZh: string;
  isSaved: boolean;
  isKnown: boolean;
  onSave: () => void;
  onMarkKnown: () => void;
  onDismiss: () => void;
};

const CEFR_LABEL: Record<string, string> = {
  A1: 'A1 基础',
  A2: 'A2 初级',
  B1: 'B1 中级',
  B2: 'B2 中高',
  C1: 'C1 高级',
  C2: 'C2 精通/专名',
};

export function WordPopup({ word, contextEn, contextZh, isSaved, isKnown, onSave, onMarkKnown, onDismiss }: Props) {
  return (
    <Pressable style={styles.overlay} onPress={onDismiss}>
      <Pressable style={styles.card} onPress={e => e.stopPropagation()}>
        <View style={styles.header}>
          <Text style={styles.wordText}>{word.word}</Text>
          {word.cefr ? <Text style={styles.cefrBadge}>{CEFR_LABEL[word.cefr.toUpperCase()] || word.cefr}</Text> : null}
        </View>

        <View style={styles.contextWrap}>
          <Text style={styles.contextEn}>{contextEn}</Text>
          <Text style={styles.contextZh}>{contextZh}</Text>
        </View>

        <View style={styles.actions}>
          <Pressable onPress={onSave} style={[styles.actionButton, isSaved && styles.actionButtonActive]}>
            <Text style={[styles.actionText, isSaved && styles.actionTextActive]}>
              {isSaved ? '已收藏' : '收藏词'}
            </Text>
          </Pressable>
          <Pressable onPress={onMarkKnown} style={[styles.actionButton, isKnown && styles.actionButtonActive]}>
            <Text style={[styles.actionText, isKnown && styles.actionTextActive]}>
              {isKnown ? '已认识' : '我认识'}
            </Text>
          </Pressable>
          <Pressable onPress={onDismiss} style={styles.actionButton}>
            <Text style={styles.actionText}>关闭</Text>
          </Pressable>
        </View>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
    paddingBottom: 120,
    paddingHorizontal: 16,
    zIndex: 100,
  },
  card: {
    backgroundColor: '#1A1A2E',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 20,
    gap: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  wordText: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
  },
  cefrBadge: {
    color: 'rgba(255,255,255,0.64)',
    fontSize: 12,
    fontWeight: '600',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  contextWrap: {
    gap: 6,
  },
  contextEn: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 15,
    lineHeight: 22,
  },
  contextZh: {
    color: 'rgba(255,255,255,0.48)',
    fontSize: 14,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  actionButtonActive: {
    backgroundColor: '#8B9CF7',
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  actionTextActive: {
    color: '#09090B',
  },
});
