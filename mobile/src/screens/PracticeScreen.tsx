import React, { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  ActionButton,
  EmptyState,
  GlassCard,
  PillButton,
  ScreenHeader,
  ScreenSurface,
} from '../components/AppChrome';
import { colors, spacing, typography } from '../design';
import {
  buildClipKey,
  findClipIndexByKey,
  getClipDurationSeconds,
  getSourceLabel,
} from '../clip-utils';
import { triggerUiFeedback } from '../feedback';
import type { Bookmark, Clip, PracticeMap, Profile, VocabEntry } from '../types';

function getWordLevelWeight(level?: string) {
  const normalized = (level || '').toUpperCase().trim();
  if (normalized === 'A1') return 1;
  if (normalized === 'A2' || normalized === 'A') return 2;
  if (normalized === 'B1') return 3;
  if (normalized === 'B2') return 4;
  if (normalized === 'C1') return 5;
  if (normalized === 'C2') return 6;
  return 0;
}

type Props = {
  bookmarks: Bookmark[];
  clips: Clip[];
  profile: Profile;
  vocabList: VocabEntry[];
  practiceData: PracticeMap;
  showIntro: boolean;
  onDismissIntro: () => void;
  onBackToFeed: () => void;
  onStartPractice: (clipIndex: number) => void;
};

export function PracticeScreen({
  bookmarks,
  clips,
  profile,
  vocabList,
  practiceData,
  showIntro,
  onDismissIntro,
  onBackToFeed,
  onStartPractice,
}: Props) {
  const unpracticedCount = useMemo(() => {
    return bookmarks.filter(item => !practiceData[item.clipKey]?.done).length;
  }, [bookmarks, practiceData]);

  const recommended = useMemo(() => {
    const bookmarkKeys = new Set(bookmarks.map(item => item.clipKey));
    const practicedKeys = new Set(
      Object.entries(practiceData)
        .filter(([, value]) => value?.done)
        .map(([key]) => key)
    );
    const vocabSet = new Set(vocabList.map(item => item.word.toLowerCase()));
    const interestSet = new Set(profile.interests.map(item => item.toLowerCase()));
    const userLevelNum = (() => {
      const normalized = (profile.level || 'B1').toUpperCase();
      if (normalized === 'A1-A2') return 2;
      if (normalized === 'B1') return 3;
      if (normalized === 'B2') return 4;
      if (normalized === 'C1-C2') return 5;
      return 3;
    })();

    return clips
      .map((clip, clipIndex) => {
        const clipKey = buildClipKey(clip, clipIndex);
        if (bookmarkKeys.has(clipKey) || practicedKeys.has(clipKey)) return null;

        let score = 0;
        let reason = '难度适合你当前的水平';
        const matchedWords: string[] = [];

        const tag = (clip.tag || '').toLowerCase();
        if (tag && interestSet.has(tag)) {
          score += 3;
          reason = `你最近更常点开 ${clip.tag} 方向`;
        }

        for (const line of clip.lines || []) {
          for (const word of line.words || []) {
            const normalized = word.word.toLowerCase();
            if (vocabSet.has(normalized) && !matchedWords.includes(normalized)) {
              matchedWords.push(normalized);
            }
          }
        }

        if (matchedWords.length > 0) {
          score += 5 + matchedWords.length;
          reason = `包含你查过的 ${matchedWords.slice(0, 2).join(' / ')}`;
        }

        let cefrWords = 0;
        let cefrSum = 0;
        for (const line of clip.lines || []) {
          for (const word of line.words || []) {
            const bucket = getWordLevelWeight(word.cefr || '');
            if (bucket > 0) {
              cefrWords += 1;
              cefrSum += bucket;
            }
          }
        }

        if (cefrWords > 0) {
          const avgLevel = cefrSum / cefrWords;
          if (Math.abs(avgLevel - userLevelNum) <= 1) {
            score += 2;
          }
        }

        return {
          clip,
          clipIndex,
          reason,
          score: score || 0.1,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.score || 0) - (a?.score || 0))
      .slice(0, 3) as { clip: Clip; clipIndex: number; reason: string; score: number }[];
  }, [bookmarks, clips, practiceData, profile.interests, profile.level, vocabList]);

  return (
    <ScreenSurface>
      <ScreenHeader
        leading={<PillButton label="返回" onPress={() => {
          triggerUiFeedback('menu');
          onBackToFeed();
        }} />}
        title="听力练习"
        subtitle="先盲听，再精听，再回到整段"
        trailing={<Text style={styles.count}>{unpracticedCount || bookmarks.length}</Text>}
      />

      <FlatList
        data={bookmarks}
        keyExtractor={item => item.clipKey}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.headerContent}>
            {showIntro ? (
              <GlassCard tone="practice" style={styles.introCard}>
                <Text style={styles.introTitle}>你的练习区</Text>
                <Text style={styles.introBody}>
                  好的练习不是把整篇稿子看完，而是把真正卡住的几句掰开来听。
                </Text>
                <ActionButton
                  label="知道了"
                  onPress={() => {
                    triggerUiFeedback('onboarding');
                    onDismissIntro();
                  }}
                  variant="secondary"
                  style={styles.introButton}
                />
              </GlassCard>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>AI 推荐练习</Text>
              {recommended.length > 0 ? (
                recommended.map(item => {
                  const duration = getClipDurationSeconds(item.clip);
                  const durationLabel = duration > 0
                    ? `${Math.floor(duration / 60)}:${String(Math.round(duration % 60)).padStart(2, '0')}`
                    : '';

                  return (
                    <GlassCard key={`reco-${item.clipIndex}`} tone="practice" style={styles.recoCard}>
                      <Text style={styles.cardTitle}>{item.clip.title}</Text>
                      <Text style={styles.cardMeta}>
                        {getSourceLabel(item.clip.source)}
                        {item.clip.tag ? ` · ${item.clip.tag}` : ''}
                        {durationLabel ? ` · ${durationLabel}` : ''}
                      </Text>
                      <Text style={styles.reason}>{item.reason}</Text>
                      <ActionButton
                        label="开始这一段"
                        onPress={() => {
                          triggerUiFeedback('primary');
                          onStartPractice(item.clipIndex);
                        }}
                      />
                    </GlassCard>
                  );
                })
              ) : (
                <GlassCard style={styles.recoCard}>
                  <Text style={styles.reason}>所有内容都练过了，新内容正在路上。</Text>
                </GlassCard>
              )}
            </View>

            <Text style={styles.sectionTitle}>收藏里的练习素材</Text>
          </View>
        }
        ListEmptyComponent={
          <EmptyState title="这里还没有可练的内容" body="先在 Feed 里收藏片段，它们会在这里等你慢慢精听。" />
        }
        renderItem={({ item }) => {
          const clipIndex = (() => {
            const directMatch = findClipIndexByKey(clips, item.clipKey);
            if (directMatch >= 0) return directMatch;
            return clips.findIndex(clip => clip.title === item.title);
          })();
          const record = practiceData[item.clipKey];
          const done = Boolean(record?.done);

          return (
            <Pressable
              disabled={clipIndex < 0}
              onPress={() => {
                if (clipIndex >= 0) {
                  triggerUiFeedback('primary');
                  onStartPractice(clipIndex);
                }
              }}
            >
              <GlassCard style={[styles.savedCard, clipIndex < 0 && styles.savedCardDisabled]}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardMeta}>{item.source} · {item.tag}</Text>
                <View style={styles.footer}>
                  <View style={[styles.statusBadge, done ? styles.statusDone : styles.statusFresh]}>
                    <Text style={[styles.statusText, done ? styles.statusTextDone : styles.statusTextFresh]}>
                      {done ? `已练过 · 查了 ${record?.words || 0} 个词` : '未练习'}
                    </Text>
                  </View>
                  <Text style={styles.cta}>{clipIndex >= 0 ? '开始' : '未找到音频'}</Text>
                </View>
              </GlassCard>
            </Pressable>
          );
        }}
      />
    </ScreenSurface>
  );
}

const styles = StyleSheet.create({
  count: {
    color: colors.textSecondary,
    fontSize: typography.body,
    fontWeight: '600',
    minWidth: 20,
    textAlign: 'right',
  },
  content: {
    paddingHorizontal: spacing.page,
    paddingBottom: 32,
    gap: spacing.md,
  },
  headerContent: {
    gap: spacing.lg,
    marginBottom: 6,
  },
  introCard: {
    gap: spacing.sm,
  },
  introTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  introBody: {
    color: colors.textSecondary,
    fontSize: typography.body,
    lineHeight: 20,
  },
  introButton: {
    alignSelf: 'flex-start',
    minWidth: 96,
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: typography.title,
    fontWeight: '700',
  },
  recoCard: {
    gap: spacing.sm,
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  cardMeta: {
    color: colors.textSecondary,
    fontSize: typography.caption,
  },
  reason: {
    color: colors.textSecondary,
    fontSize: typography.body,
    lineHeight: 20,
  },
  savedCard: {
    gap: spacing.sm,
  },
  savedCardDisabled: {
    opacity: 0.45,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  statusFresh: {
    backgroundColor: 'rgba(168,85,247,0.14)',
  },
  statusDone: {
    backgroundColor: colors.bgSurface2,
  },
  statusText: {
    fontSize: typography.micro,
    fontWeight: '700',
  },
  statusTextFresh: {
    color: colors.accentPractice,
  },
  statusTextDone: {
    color: colors.textSecondary,
  },
  cta: {
    color: colors.textPrimary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
});
