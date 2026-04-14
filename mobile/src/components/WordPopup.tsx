import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ActionButton, GlassCard, PillButton } from './AppChrome';
import { colors, radii, spacing, typography } from '../design';
import { triggerUiFeedback } from '../feedback';
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
  A1: 'A1',
  A2: 'A2',
  B1: 'B1',
  B2: 'B2',
  C1: 'C1',
  C2: 'C2',
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
  }, [normalizedWord, contextZh]);

  return (
    <Pressable style={styles.overlay} onPress={onDismiss}>
      <Pressable style={styles.positioner} onPress={e => e.stopPropagation()}>
        <GlassCard style={styles.card}>
          <View style={styles.topRow}>
            <View style={styles.wordBlock}>
              <Text style={styles.word}>{word.word}</Text>
              <View style={styles.metaRow}>
                {word.cefr ? <PillButton label={CEFR_LABEL[word.cefr.toUpperCase()] || word.cefr} subtle /> : null}
                {info?.phonetic ? <Text style={styles.phonetic}>{info.phonetic}</Text> : null}
              </View>
            </View>
            <Pressable
              onPress={() => {
                triggerUiFeedback('menu');
                onDismiss();
              }}
              style={styles.closeButton}
            >
              <Text style={styles.closeButtonText}>x</Text>
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.accentFeed} />
              <Text style={styles.loadingText}>正在查询词义...</Text>
            </View>
          ) : (
            <View style={styles.definitionBlock}>
              {info?.pos ? <Text style={styles.partOfSpeech}>{info.pos}</Text> : null}
              {info?.definition ? <Text style={styles.definition}>{info.definition}</Text> : null}
            </View>
          )}

          <View style={styles.contextBlock}>
            <Text style={styles.contextEn}>{contextEn}</Text>
            <Text style={styles.contextZh}>{contextZh}</Text>
          </View>

          <View style={styles.actionRow}>
            <ActionButton
              label={isSaved ? '已收藏' : '收藏'}
              variant={isSaved ? 'secondary' : 'primary'}
              onPress={() => {
                triggerUiFeedback('bookmark');
                onSave();
              }}
              style={styles.action}
            />
            <ActionButton
              label={isKnown ? '已认识' : '我认识'}
              variant={isKnown ? 'secondary' : 'success'}
              onPress={() => {
                triggerUiFeedback('correct');
                onMarkKnown();
              }}
              style={styles.action}
            />
          </View>
        </GlassCard>
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
    backgroundColor: 'transparent',
    zIndex: 100,
  },
  positioner: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 108,
  },
  card: {
    backgroundColor: colors.bgOverlay,
    borderColor: colors.strokeStrong,
    gap: spacing.md,
    shadowColor: '#000000',
    shadowOpacity: 0.26,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 16,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  wordBlock: {
    flex: 1,
    gap: spacing.sm,
  },
  word: {
    color: colors.textPrimary,
    fontSize: 28,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  phonetic: {
    color: colors.accentFeed,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  closeButton: {
    width: 30,
    height: 30,
    borderRadius: radii.pill,
    backgroundColor: colors.bgSurface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    color: colors.textSecondary,
    fontSize: typography.bodyLg,
    fontWeight: '700',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: typography.caption,
  },
  definitionBlock: {
    gap: spacing.sm,
  },
  partOfSpeech: {
    color: colors.textTertiary,
    fontSize: typography.micro,
    fontWeight: '700',
  },
  definition: {
    color: colors.textPrimary,
    fontSize: typography.bodyLg,
    lineHeight: 22,
    fontWeight: '600',
  },
  contextBlock: {
    gap: spacing.sm,
  },
  contextEn: {
    color: colors.textPrimary,
    fontSize: typography.body,
    lineHeight: 20,
  },
  contextZh: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  action: {
    flex: 1,
  },
});
