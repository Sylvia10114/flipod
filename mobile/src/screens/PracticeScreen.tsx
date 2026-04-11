import React, { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { findClipIndexByKey } from '../clip-utils';
import type { Bookmark, Clip, PracticeMap } from '../types';

type Props = {
  bookmarks: Bookmark[];
  clips: Clip[];
  practiceData: PracticeMap;
  showIntro: boolean;
  onDismissIntro: () => void;
  onOpenMenu: () => void;
  onStartPractice: (clipIndex: number) => void;
};

export function PracticeScreen({
  bookmarks,
  clips,
  practiceData,
  showIntro,
  onDismissIntro,
  onOpenMenu,
  onStartPractice,
}: Props) {
  const unpracticedCount = useMemo(() => {
    return bookmarks.filter(item => !practiceData[item.clipKey]?.done).length;
  }, [bookmarks, practiceData]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable onPress={onOpenMenu} style={styles.menuButton}>
          <Text style={styles.menuButtonText}>菜单</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>听力练习</Text>
          <Text style={styles.subtitle}>Feed 刷到喜欢的，就收藏下来慢慢精听</Text>
        </View>
        <Text style={styles.count}>{unpracticedCount || bookmarks.length}</Text>
      </View>

      <FlatList
        data={bookmarks}
        keyExtractor={item => item.clipKey}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          showIntro ? (
            <View style={styles.introCard}>
              <Text style={styles.introTitle}>精听练习</Text>
              <Text style={styles.introText}>
                对一段内容反复听、逐句听、搞懂每个词。比泛听累一点，但进步会很实。
              </Text>
              <Pressable onPress={onDismissIntro} style={styles.introButton}>
                <Text style={styles.introButtonText}>知道了</Text>
              </Pressable>
            </View>
          ) : null
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
                if (clipIndex >= 0) onStartPractice(clipIndex);
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
  introCard: {
    marginBottom: 18,
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
  emptyState: {
    marginTop: 120,
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
