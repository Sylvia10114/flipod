import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { EmptyState, GlassCard, PillButton, ScreenHeader, ScreenSurface } from '../components/AppChrome';
import { spacing, typography } from '../design';
import { triggerUiFeedback } from '../feedback';
import { useAppTheme } from '../theme';
import type { Clip, VocabEntry } from '../types';

type Props = {
  vocabList: VocabEntry[];
  clips: Clip[];
  onBack: () => void;
};

export function VocabScreen({ vocabList, clips, onBack }: Props) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const clipByContentKey = React.useMemo(() => {
    const map = new Map<string, Clip>();
    clips.forEach(clip => {
      if (!clip.contentKey) return;
      map.set(clip.contentKey, clip);
    });
    return map;
  }, [clips]);
  return (
    <ScreenSurface>
      <ScreenHeader
        leading={<PillButton label="返回" onPress={() => {
          triggerUiFeedback('menu');
          onBack();
        }} />}
        title="词汇本"
        subtitle="Feed 点词和 Practice 查词都会沉淀在这里"
        trailing={<Text style={styles.count}>{vocabList.length}</Text>}
      />

      <FlatList
        data={vocabList}
        keyExtractor={item => item.word}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          vocabList.length > 0 ? (
            <GlassCard style={styles.heroCard} tone="feed">
              <Text style={styles.heroTitle}>已经记下 {vocabList.length} 个词</Text>
              <Text style={styles.heroBody}>这里更像你的词汇沉淀区，不是打卡面板。后续复习卡会从这里挑。</Text>
            </GlassCard>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState title="还没有保存任何词" body="在字幕里点词后，词义、例句和来源都会自动出现在这里。" />
        }
        renderItem={({ item }) => {
          const lineTranslation = item.contentKey && Number.isInteger(item.lineIndex)
            ? clipByContentKey.get(item.contentKey)?.lines?.[item.lineIndex as number]?.zh || ''
            : '';
          const localizedContext = lineTranslation || item.contextZh || '';

          return (
            <GlassCard style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.word}>{item.word}</Text>
                {item.cefr ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{item.cefr}</Text>
                  </View>
                ) : null}
              </View>
              {item.context ? <Text style={styles.contextEn}>{item.context}</Text> : null}
              {localizedContext ? <Text style={styles.contextZh}>{localizedContext}</Text> : null}
              <Text style={styles.meta}>
                {item.sourceType === 'practice' ? '听力练习' : 'Feed 浏览'}
                {item.practiced ? ' · 精听过' : ''}
                {item.known ? ' · 已认识' : ''}
              </Text>
            </GlassCard>
          );
        }}
      />
    </ScreenSurface>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
  count: {
    color: colors.textSecondary,
    fontSize: typography.body,
    fontWeight: '600',
    minWidth: 20,
    textAlign: 'right',
  },
  content: {
    paddingHorizontal: spacing.page,
    paddingBottom: 36,
    gap: spacing.md,
  },
  heroCard: {
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  heroTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  heroBody: {
    color: colors.textSecondary,
    fontSize: typography.body,
    lineHeight: 20,
  },
  card: {
    gap: spacing.sm,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  word: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: `${colors.accentGold}29`,
  },
  badgeText: {
    color: colors.accentGold,
    fontSize: typography.micro,
    fontWeight: '700',
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
  meta: {
    color: colors.textTertiary,
    fontSize: typography.micro,
  },
  });
}
