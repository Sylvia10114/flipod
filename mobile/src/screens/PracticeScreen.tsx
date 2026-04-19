import React, { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  ActionButton,
  EmptyState,
  GlassCard,
  ScreenSurface,
} from '../components/AppChrome';
import { spacing, typography } from '../design';
import {
  buildClipKey,
  findClipIndexByKey,
  getClipDurationSeconds,
  getSourceLabel,
} from '../clip-utils';
import { triggerUiFeedback } from '../feedback';
import { buildLocalizedRecommendationReason } from '../feed-ranking';
import { useUiI18n } from '../i18n';
import { getLocalizedTopicLabel } from '../i18n/helpers';
import { useResponsiveLayout } from '../responsive';
import { useAppTheme } from '../theme';
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
  contentViewportHeight?: number;
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
  contentViewportHeight = 0,
  onStartPractice,
}: Props) {
  const { colors } = useAppTheme();
  const { t } = useUiI18n();
  const metrics = useResponsiveLayout();
  const styles = React.useMemo(() => createStyles(colors), [colors]);

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
        let reason = buildLocalizedRecommendationReason(
          clip,
          profile.level || 'B1',
          profile.interests,
          t
        );
        const matchedWords: string[] = [];

        const tag = (clip.tag || '').toLowerCase();
        if (tag && interestSet.has(tag)) {
          score += 3;
          reason = buildLocalizedRecommendationReason(
            clip,
            profile.level || 'B1',
            profile.interests,
            t
          );
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
          reason = t('practice.reasonLookedUpWords', { words: matchedWords.slice(0, 2).join(' / ') });
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
    <ScreenSurface edges={['left', 'right', 'bottom']}>
      <FlatList
        data={bookmarks}
        keyExtractor={item => item.clipKey}
        style={[styles.list, contentViewportHeight > 0 && { minHeight: contentViewportHeight }]}
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
          <View style={styles.headerContent}>
            {showIntro ? (
              <GlassCard tone="practice" style={styles.introCard}>
                <Text style={styles.introTitle}>{t('practice.introTitle')}</Text>
                <Text style={styles.introBody}>{t('practice.introBody')}</Text>
                <ActionButton
                  label={t('practice.introAcknowledge')}
                  onPress={() => {
                    onDismissIntro();
                  }}
                  variant="secondary"
                  style={styles.introButton}
                />
              </GlassCard>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('practice.recommended')}</Text>
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
                        {item.clip.tag ? ` · ${getLocalizedTopicLabel(item.clip.tag, t)}` : ''}
                        {durationLabel ? ` · ${durationLabel}` : ''}
                      </Text>
                      <Text style={styles.reason}>{item.reason}</Text>
                      <ActionButton
                        label={t('practice.startThisClip')}
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
                  <Text style={styles.reason}>{t('practice.allDone')}</Text>
                </GlassCard>
              )}
            </View>

            <Text style={styles.sectionTitle}>{t('practice.savedMaterials')}</Text>
          </View>
        }
        ListEmptyComponent={
          <EmptyState title={t('practice.emptyTitle')} body={t('practice.emptyBody')} />
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
                <Text style={styles.cardTitle}>{clipIndex >= 0 ? clips[clipIndex].title : item.title}</Text>
                <Text style={styles.cardMeta}>
                  {item.source}
                  {item.tag ? ` · ${getLocalizedTopicLabel(item.tag, t)}` : ''}
                </Text>
                <View style={styles.footer}>
                  <View style={[styles.statusBadge, done ? styles.statusDone : styles.statusFresh]}>
                    <Text style={[styles.statusText, done ? styles.statusTextDone : styles.statusTextFresh]}>
                      {done
                        ? t('practice.statusPracticed', { words: record?.words || 0 })
                        : t('practice.statusFresh')}
                    </Text>
                  </View>
                  <Text style={styles.cta}>{clipIndex >= 0 ? t('practice.startCta') : t('practice.audioMissing')}</Text>
                </View>
              </GlassCard>
            </Pressable>
          );
        }}
      />
    </ScreenSurface>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    list: {
      flex: 1,
    },
    content: {
      paddingHorizontal: spacing.page,
      paddingBottom: 32,
      gap: spacing.md,
    },
    headerContent: {
      gap: spacing.lg,
      marginBottom: 6,
      paddingTop: spacing.md,
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
      backgroundColor: `${colors.accentPractice}24`,
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
}
