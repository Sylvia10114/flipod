import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { EmptyState, GlassCard, PillButton, ScreenHeader, ScreenSurface } from '../components/AppChrome';
import { colors, spacing, typography } from '../design';
import { triggerUiFeedback } from '../feedback';
import type { Bookmark } from '../types';

type Props = {
  bookmarks: Bookmark[];
  onRemove: (clipKey: string) => void;
  onOpenMenu: () => void;
};

export function LibraryScreen({ bookmarks, onRemove, onOpenMenu }: Props) {
  return (
    <ScreenSurface>
      <ScreenHeader
        leading={<PillButton label="menu" onPress={() => {
          triggerUiFeedback('menu');
          onOpenMenu();
        }} />}
        title="我的收藏"
        subtitle="留给反复听和后面精听的片段"
        trailing={<Text style={styles.count}>{bookmarks.length}</Text>}
      />

      <FlatList
        data={bookmarks}
        keyExtractor={item => item.clipKey}
        contentContainerStyle={styles.content}
        ListEmptyComponent={
          <EmptyState title="还没有收藏内容" body="在 Feed 里点一下 bookmark，想回听的片段都会沉淀在这里。" />
        }
        renderItem={({ item }) => (
          <GlassCard style={styles.card}>
            <View style={styles.cardMain}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardMeta}>
                {item.source}
                {item.tag ? ` · ${item.tag}` : ''}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                triggerUiFeedback('bookmark');
                onRemove(item.clipKey);
              }}
              style={styles.removeButton}
            >
              <Text style={styles.removeButtonText}>移除</Text>
            </Pressable>
          </GlassCard>
        )}
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
    paddingBottom: 40,
    gap: spacing.md,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  cardMain: {
    flex: 1,
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
  removeButton: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.bgSurface2,
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  removeButtonText: {
    color: colors.textPrimary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
});
