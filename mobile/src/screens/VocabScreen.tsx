import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { EmptyState, GlassCard, PillButton, ScreenHeader, ScreenSurface } from '../components/AppChrome';
import { spacing, typography } from '../design';
import { triggerUiFeedback } from '../feedback';
import { useUiI18n } from '../i18n';
import { useResponsiveLayout } from '../responsive';
import { useAppTheme } from '../theme';
import type { Clip, VocabEntry } from '../types';

type Props = {
  vocabList: VocabEntry[];
  clips: Clip[];
  onBack: () => void;
};

export function VocabScreen({ vocabList, clips, onBack }: Props) {
  const { colors } = useAppTheme();
  const { t } = useUiI18n();
  const metrics = useResponsiveLayout();
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
        leading={<PillButton label={t('common.back')} onPress={() => {
          triggerUiFeedback('menu');
          onBack();
        }} />}
        title={t('vocab.title')}
        subtitle={t('vocab.subtitle')}
        trailing={<Text style={styles.count}>{vocabList.length}</Text>}
      />

      <FlatList
        data={vocabList}
        keyExtractor={item => item.word}
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: metrics.pageHorizontalPadding,
            maxWidth: metrics.contentMaxWidth,
            alignSelf: 'center',
            width: '100%',
          },
        ]}
        ListHeaderComponent={
          vocabList.length > 0 ? (
            <GlassCard style={styles.heroCard} tone="feed">
              <Text style={styles.heroTitle}>{t('vocab.heroTitle', { count: vocabList.length })}</Text>
              <Text style={styles.heroBody}>{t('vocab.heroBody')}</Text>
            </GlassCard>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState title={t('vocab.emptyTitle')} body={t('vocab.emptyBody')} />
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
                {item.sourceType === 'practice' ? t('vocab.sourcePractice') : t('vocab.sourceFeed')}
                {item.practiced ? ` · ${t('vocab.metaPracticed')}` : ''}
                {item.known ? ` · ${t('vocab.metaKnown')}` : ''}
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
