import React, { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
  onOpenMenu: () => void;
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
  onOpenMenu,
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
        let reason = '难度适合你现在的水平';
        const matchedWords: string[] = [];

        const tag = (clip.tag || '').toLowerCase();
        if (tag && interestSet.has(tag)) {
          score += 3;
          reason = `你可能对 ${clip.tag} 类内容感兴趣`;
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
          reason = `包含你查过的 ${matchedWords.slice(0, 2).join('、')}`;
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
            if (!matchedWords.length && !(tag && interestSet.has(tag))) {
              reason = '难度适合你现在的水平';
            }
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
      .slice(0, 5) as { clip: Clip; clipIndex: number; reason: string; score: number }[];
  }, [bookmarks, clips, practiceData, profile.interests, profile.level, vocabList]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable onPress={() => {
          triggerUiFeedback('menu');
          onOpenMenu();
        }} style={styles.menuButton}>
          <Text style={styles.menuButtonText}>菜单</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>听力练习</Text>
          <Text style={styles.subtitle}>收藏下来慢慢精听，或者直接试试 AI 推荐的下一段。</Text>
        </View>
        <Text style={styles.count}>{unpracticedCount || bookmarks.length}</Text>
      </View>

      <FlatList
        data={bookmarks}
        keyExtractor={item => item.clipKey}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.headerContent}>
            {showIntro ? (
              <View style={styles.introCard}>
                <Text style={styles.introTitle}>精听练习</Text>
                <Text style={styles.introText}>
                  先盲听，再逐句拆开，最后回到整段复听。累一点，但进步会很实。
                </Text>
                <Pressable onPress={() => {
                  triggerUiFeedback('onboarding');
                  onDismissIntro();
                }} style={styles.introButton}>
                  <Text style={styles.introButtonText}>知道了</Text>
                </Pressable>
              </View>
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
                    <Pressable
                      key={`reco-${item.clipIndex}`}
                      onPress={() => {
                        triggerUiFeedback('primary');
                        onStartPractice(item.clipIndex);
                      }}
                      style={styles.recoCard}
                    >
                      <Text style={styles.cardTitle}>{item.clip.title}</Text>
                      <Text style={styles.cardMeta}>
                        {getSourceLabel(item.clip.source)}
                        {item.clip.tag ? ` · ${item.clip.tag}` : ''}
                        {durationLabel ? ` · ${durationLabel}` : ''}
                      </Text>
                      <Text style={styles.recoReason}>{item.reason}</Text>
                    </Pressable>
                  );
                })
              ) : (
                <View style={styles.recoEmpty}>
                  <Text style={styles.recoEmptyText}>所有内容都练过了，新内容正在路上</Text>
                </View>
              )}
            </View>

            <Text style={styles.sectionTitle}>已收藏内容</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>这里还在等第一条收藏</Text>
            <Text style={styles.emptyText}>
              在 Feed 里收藏感兴趣的片段，它们会出现在这里等你精听。
            </Text>
          </View>
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
              style={[styles.card, clipIndex < 0 && styles.cardDisabled]}
            >
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardMeta}>{item.source} · {item.tag}</Text>
              <View style={styles.cardFooter}>
                <View style={[styles.statusBadge, done ? styles.statusBadgeDone : styles.statusBadgeFresh]}>
                  <Text style={[styles.statusBadgeText, done ? styles.statusBadgeTextDone : styles.statusBadgeTextFresh]}>
                    {done ? `已练习 · 查了 ${record?.words || 0} 个词` : '未练习'}
                  </Text>
                </View>
                <Text style={styles.cta}>{clipIndex >= 0 ? '开始' : '未找到音频'}</Text>
              </View>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#09090B',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  menuButton: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  menuButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.48)',
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  count: {
    width: 32,
    textAlign: 'right',
    color: 'rgba(255,255,255,0.52)',
    fontSize: 14,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 12,
  },
  headerContent: {
    gap: 18,
    marginBottom: 6,
  },
  introCard: {
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 20,
    backgroundColor: 'rgba(139,156,247,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(139,156,247,0.24)',
  },
  introTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  introText: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.68)',
    fontSize: 14,
    lineHeight: 22,
  },
  introButton: {
    alignSelf: 'flex-start',
    marginTop: 14,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: '#8B9CF7',
  },
  introButtonText: {
    color: '#09090B',
    fontSize: 12,
    fontWeight: '700',
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  recoCard: {
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: 'rgba(139,156,247,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(139,156,247,0.24)',
    gap: 8,
  },
  recoReason: {
    color: '#AFC0FF',
    fontSize: 12,
    lineHeight: 18,
  },
  recoEmpty: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  recoEmptyText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    lineHeight: 20,
  },
  emptyState: {
    marginTop: 40,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  emptyText: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.56)',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  card: {
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 10,
  },
  cardDisabled: {
    opacity: 0.45,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  cardMeta: {
    color: 'rgba(255,255,255,0.52)',
    fontSize: 13,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  statusBadgeFresh: {
    backgroundColor: 'rgba(139,156,247,0.16)',
  },
  statusBadgeDone: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusBadgeTextFresh: {
    color: '#8B9CF7',
  },
  statusBadgeTextDone: {
    color: 'rgba(255,255,255,0.68)',
  },
  cta: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
