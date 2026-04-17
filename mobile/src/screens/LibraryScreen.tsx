import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { findClipIndexByKey } from '../clip-utils';
import { EmptyState, GlassCard, PillButton, ScreenHeader, ScreenSurface } from '../components/AppChrome';
import { spacing, typography } from '../design';
import { triggerUiFeedback } from '../feedback';
import { useUiI18n } from '../i18n';
import { getLocalizedTopicLabel } from '../i18n/helpers';
import { useResponsiveLayout } from '../responsive';
import { useAppTheme } from '../theme';
import type { Bookmark, Clip } from '../types';

type Props = {
  bookmarks: Bookmark[];
  clips: Clip[];
  onRemove: (clipKey: string) => void;
  onBack: () => void;
};

export function LibraryScreen({ bookmarks, clips, onRemove, onBack }: Props) {
  const { colors } = useAppTheme();
  const { t } = useUiI18n();
  const metrics = useResponsiveLayout();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  return (
    <ScreenSurface>
      <ScreenHeader
        leading={<PillButton label={t('common.back')} onPress={() => {
          triggerUiFeedback('menu');
          onBack();
        }} />}
        title={t('library.title')}
        subtitle={t('library.subtitle')}
        trailing={<Text style={styles.count}>{bookmarks.length}</Text>}
      />

      <FlatList
        data={bookmarks}
        keyExtractor={item => item.clipKey}
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: metrics.pageHorizontalPadding,
            maxWidth: metrics.contentMaxWidth,
            alignSelf: 'center',
            width: '100%',
          },
        ]}
        ListEmptyComponent={
          <EmptyState title={t('library.emptyTitle')} body={t('library.emptyBody')} />
        }
        renderItem={({ item }) => {
          const clipIndex = findClipIndexByKey(clips, item.clipKey);
          const localizedClip = clipIndex >= 0 ? clips[clipIndex] : null;

          return (
            <GlassCard style={styles.card}>
              <View style={styles.cardMain}>
                <Text style={styles.cardTitle}>{localizedClip?.title || item.title}</Text>
                <Text style={styles.cardMeta}>
                  {item.source}
                  {item.tag ? ` · ${getLocalizedTopicLabel(item.tag, t)}` : ''}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  triggerUiFeedback('bookmark');
                  onRemove(item.clipKey);
                }}
                style={styles.removeButton}
              >
                <Text style={styles.removeButtonText}>{t('library.remove')}</Text>
              </Pressable>
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
}
