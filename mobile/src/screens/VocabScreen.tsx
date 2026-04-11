import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { VocabEntry } from '../types';

type Props = {
  vocabList: VocabEntry[];
  onOpenMenu: () => void;
};

export function VocabScreen({ vocabList, onOpenMenu }: Props) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable onPress={onOpenMenu} style={styles.menuButton}>
          <Text style={styles.menuButtonText}>菜单</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>词汇本</Text>
          <Text style={styles.subtitle}>Feed 点词和 Practice 查词都会沉淀在这里</Text>
        </View>
        <Text style={styles.count}>{vocabList.length}</Text>
      </View>

      <FlatList
        data={vocabList}
        keyExtractor={item => item.word}
        contentContainerStyle={styles.content}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>还没有保存任何词</Text>
            <Text style={styles.emptyText}>在字幕里点词收藏后，这里会开始长起来。</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.word}>{item.word}</Text>
              {item.cefr ? <Text style={styles.badge}>{item.cefr}</Text> : null}
            </View>
            {item.context ? <Text style={styles.contextEn}>{item.context}</Text> : null}
            {item.contextZh ? <Text style={styles.contextZh}>{item.contextZh}</Text> : null}
            <Text style={styles.meta}>
              {(item.sourceType === 'practice' ? '听力练习' : 'Feed 浏览')}
              {item.practiced ? ' · 精听过' : ''}
            </Text>
          </View>
        )}
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
    gap: 8,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  word: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  badge: {
    color: '#8B9CF7',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(139,156,247,0.16)',
  },
  contextEn: {
    color: 'rgba(255,255,255,0.76)',
    fontSize: 15,
    lineHeight: 22,
  },
  contextZh: {
    color: 'rgba(255,255,255,0.52)',
    fontSize: 14,
    lineHeight: 20,
  },
  meta: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
  },
});
