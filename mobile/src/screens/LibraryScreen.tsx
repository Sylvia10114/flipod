import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Bookmark } from '../types';

type Props = {
  bookmarks: Bookmark[];
  onRemove: (clipKey: string) => void;
  onOpenMenu: () => void;
};

export function LibraryScreen({ bookmarks, onRemove, onOpenMenu }: Props) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable onPress={onOpenMenu} style={styles.backButton}>
          <Text style={styles.backButtonText}>菜单</Text>
        </Pressable>
        <Text style={styles.title}>收藏夹</Text>
        <Text style={styles.count}>{bookmarks.length}</Text>
      </View>

      <FlatList
        data={bookmarks}
        keyExtractor={item => item.clipKey}
        contentContainerStyle={styles.content}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>你还没有收藏内容</Text>
            <Text style={styles.emptyText}>先在 feed 里保存几条想反复听的 clip。</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardMeta}>{item.source} · {item.tag}</Text>
            </View>
            <Pressable onPress={() => onRemove(item.clipKey)} style={styles.removeButton}>
              <Text style={styles.removeButtonText}>移除</Text>
            </Pressable>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
  },
  count: {
    color: 'rgba(255,255,255,0.48)',
    fontSize: 14,
    width: 40,
    textAlign: 'right',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 12,
  },
  emptyState: {
    marginTop: 120,
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  emptyText: {
    color: 'rgba(255,255,255,0.56)',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 10,
  },
  card: {
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardBody: {
    flex: 1,
    paddingRight: 16,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  cardMeta: {
    color: 'rgba(255,255,255,0.5)',
    marginTop: 8,
    fontSize: 13,
  },
  removeButton: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  removeButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
});
