import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
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

type WordInfo = {
  phonetic: string;
  pos: string;
  definition: string;
};

const CEFR_LABEL: Record<string, string> = {
  A1: 'A1 基础',
  A2: 'A2 初级',
  B1: 'B1 中级',
  B2: 'B2 中高',
  C1: 'C1 高级',
  C2: 'C2 精通/专名',
};

const wordInfoCache = new Map<string, WordInfo>();

async function fetchWordInfo(word: string, fallbackDefinition: string): Promise<WordInfo> {
  const normalized = word.trim().toLowerCase();
  if (!normalized) {
    return { phonetic: '', pos: '', definition: '' };
  }
  if (wordInfoCache.has(normalized)) {
    return wordInfoCache.get(normalized)!;
  }

  let phonetic = '';
  let pos = '';
  let definition = '';

  try {
    const translateRes = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=bd&dt=t&dt=rm&q=${encodeURIComponent(normalized)}`
    );
    if (translateRes.ok) {
      const data = await translateRes.json();
      const dictEntries = Array.isArray(data?.[1]) ? data[1] : [];
      if (dictEntries.length > 0) {
        pos = dictEntries.map((entry: unknown[]) => entry?.[0]).filter(Boolean).join('/');
        definition = dictEntries
          .map((entry: unknown[]) => {
            const part = entry?.[0];
            const meanings = Array.isArray(entry?.[1]) ? entry[1].slice(0, 3).join('、') : '';
            return [part, meanings].filter(Boolean).join(' ');
          })
          .filter(Boolean)
          .join('；');
      } else {
        definition = data?.[0]?.[0]?.[0] || '';
      }
    }
  } catch {
  }

  try {
    const dictionaryRes = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(normalized)}`);
    if (dictionaryRes.ok) {
      const entries = await dictionaryRes.json();
      const first = entries?.[0] || {};
      phonetic = first.phonetic || first.phonetics?.find((item: { text?: string }) => item.text)?.text || '';
    }
  } catch {
  }

  const result = {
    phonetic,
    pos,
    definition: definition || fallbackDefinition || '',
  };
  wordInfoCache.set(normalized, result);
  return result;
}

export function WordPopup({ word, contextEn, contextZh, isSaved, isKnown, onSave, onMarkKnown, onDismiss }: Props) {
  const normalizedWord = useMemo(() => word.word.trim().toLowerCase(), [word.word]);
  const [info, setInfo] = useState<WordInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setInfo(null);

    void fetchWordInfo(normalizedWord, contextZh).then(result => {
      if (cancelled) return;
      setInfo(result);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [normalizedWord]);

  return (
    <Pressable style={styles.overlay} onPress={onDismiss}>
      <Pressable style={styles.card} onPress={e => e.stopPropagation()}>
        <View style={styles.header}>
          <Text style={styles.wordText}>{word.word}</Text>
          {word.cefr ? <Text style={styles.cefrBadge}>{CEFR_LABEL[word.cefr.toUpperCase()] || word.cefr}</Text> : null}
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="small" color="#8B9CF7" />
            <Text style={styles.loadingText}>正在查询词义…</Text>
          </View>
        ) : (
          <View style={styles.definitionWrap}>
            {info?.phonetic ? <Text style={styles.phonetic}>{info.phonetic}</Text> : null}
            {info?.pos ? <Text style={styles.pos}>{info.pos}</Text> : null}
            {info?.definition ? <Text style={styles.definition}>{info.definition}</Text> : null}
          </View>
        )}

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
  loadingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    color: 'rgba(255,255,255,0.56)',
    fontSize: 13,
  },
  definitionWrap: {
    gap: 6,
  },
  phonetic: {
    color: '#8B9CF7',
    fontSize: 14,
    fontWeight: '600',
  },
  pos: {
    color: 'rgba(255,255,255,0.48)',
    fontSize: 12,
    fontWeight: '600',
  },
  definition: {
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
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
