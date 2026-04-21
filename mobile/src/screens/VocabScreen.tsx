import React from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  ActionButton,
  EmptyState,
  GlassCard,
  PillButton,
  ScreenHeader,
  ScreenSurface,
} from '../components/AppChrome';
import { radii, spacing, typography } from '../design';
import { triggerUiFeedback } from '../feedback';
import { useUiI18n } from '../i18n';
import { useResponsiveLayout } from '../responsive';
import { useAppTheme } from '../theme';
import type { Clip, VocabEntry } from '../types';
import { fetchWordTranslation } from '../word-translation';

type Props = {
  vocabList: VocabEntry[];
  knownWords: string[];
  clips: Clip[];
  onBack: () => void;
  onMarkKnown: (word: string) => void;
};

type VocabFilter = 'review' | 'all' | 'practiced' | 'known';

type EnrichedVocabEntry = VocabEntry & {
  isKnownResolved: boolean;
  localizedContext: string;
  savedAt: number;
  searchIndex: string;
  sourceLabel: string;
  sourceTitle: string;
};

const REVIEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const CEFR_B2_PLUS = new Set(['B2', 'C1', 'C2']);

function normalizeText(value: unknown) {
  return String(value || '').trim();
}

function normalizeWord(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function resolveSavedAt(entry: VocabEntry) {
  return (
    entry.timestamp
    || Date.parse(entry.updatedAt || '')
    || Date.parse(entry.createdAt || '')
    || 0
  );
}

function isB2Plus(level?: string) {
  return CEFR_B2_PLUS.has(String(level || '').toUpperCase());
}

function matchesFilter(entry: EnrichedVocabEntry, filter: VocabFilter) {
  if (filter === 'all') return true;
  if (filter === 'known') return entry.isKnownResolved;
  if (filter === 'practiced') return Boolean(entry.practiced);
  return !entry.isKnownResolved;
}

export function VocabScreen({ vocabList, knownWords, clips, onBack, onMarkKnown }: Props) {
  const { colors } = useAppTheme();
  const { nativeLanguage, t } = useUiI18n();
  const metrics = useResponsiveLayout();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const [query, setQuery] = React.useState('');
  const [activeFilter, setActiveFilter] = React.useState<VocabFilter>('review');
  const [selectedWord, setSelectedWord] = React.useState<string | null>(null);
  const [inlineDefinitions, setInlineDefinitions] = React.useState<Record<string, string>>({});
  const [resolvedDefinition, setResolvedDefinition] = React.useState('');
  const [definitionLoading, setDefinitionLoading] = React.useState(false);
  const deferredQuery = React.useDeferredValue(query);

  const clipByContentKey = React.useMemo(() => {
    const map = new Map<string, Clip>();
    clips.forEach(clip => {
      if (!clip.contentKey) return;
      map.set(clip.contentKey, clip);
    });
    return map;
  }, [clips]);

  const knownWordSet = React.useMemo(() => {
    return new Set(knownWords.map(item => normalizeWord(item)));
  }, [knownWords]);

  const enrichedVocab = React.useMemo<EnrichedVocabEntry[]>(() => {
    return vocabList
      .map(item => {
        const wordKey = normalizeWord(item.word);
        const lineTranslation = item.contentKey && Number.isInteger(item.lineIndex)
          ? clipByContentKey.get(item.contentKey)?.lines?.[item.lineIndex as number]?.zh || ''
          : '';
        const localizedContext = normalizeText(lineTranslation || item.contextZh);
        const sourceLabel = item.sourceType === 'practice' ? t('vocab.sourcePractice') : t('vocab.sourceFeed');
        const sourceTitle = normalizeText(
          item.clipTitle
          || (item.contentKey ? clipByContentKey.get(item.contentKey)?.title : '')
          || sourceLabel
        );

        return {
          ...item,
          word: wordKey || normalizeText(item.word),
          isKnownResolved: Boolean(item.known) || knownWordSet.has(wordKey),
          localizedContext,
          savedAt: resolveSavedAt(item),
          sourceLabel,
          sourceTitle,
          searchIndex: [
            wordKey,
            item.cefr,
            item.definitionZh,
            item.context,
            localizedContext,
            item.clipTitle,
            item.tag,
            sourceLabel,
          ]
            .map(value => normalizeText(value).toLowerCase())
            .filter(Boolean)
            .join(' '),
        };
      })
      .sort((left, right) => {
        if (right.savedAt !== left.savedAt) return right.savedAt - left.savedAt;
        return left.word.localeCompare(right.word);
      });
  }, [clipByContentKey, knownWordSet, t, vocabList]);

  const reviewCount = React.useMemo(
    () => enrichedVocab.filter(item => !item.isKnownResolved).length,
    [enrichedVocab]
  );
  const practicedCount = React.useMemo(
    () => enrichedVocab.filter(item => item.practiced).length,
    [enrichedVocab]
  );
  const knownCount = React.useMemo(
    () => enrichedVocab.filter(item => item.isKnownResolved).length,
    [enrichedVocab]
  );
  const recentCount = React.useMemo(() => {
    const now = Date.now();
    return enrichedVocab.filter(item => now - item.savedAt <= REVIEW_WINDOW_MS).length;
  }, [enrichedVocab]);
  const b2PlusCount = React.useMemo(
    () => enrichedVocab.filter(item => isB2Plus(item.cefr)).length,
    [enrichedVocab]
  );

  const filteredVocab = React.useMemo(() => {
    const normalizedQuery = normalizeText(deferredQuery).toLowerCase();
    return enrichedVocab.filter(item => {
      if (!matchesFilter(item, activeFilter)) return false;
      if (!normalizedQuery) return true;
      return item.searchIndex.includes(normalizedQuery);
    });
  }, [activeFilter, deferredQuery, enrichedVocab]);

  React.useEffect(() => {
    if (nativeLanguage === 'english') return;

    const pending = filteredVocab
      .filter(item => !normalizeText(item.definitionZh) && !(item.word in inlineDefinitions))
      .slice(0, 12);

    if (pending.length === 0) return;

    let cancelled = false;

    void Promise.all(
      pending.map(async item => ({
        word: item.word,
        definition: normalizeText(await fetchWordTranslation(item.word, nativeLanguage)),
      }))
    ).then(results => {
      if (cancelled) return;
      setInlineDefinitions(prev => {
        const next = { ...prev };
        results.forEach(item => {
          next[item.word] = item.definition;
        });
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [filteredVocab, inlineDefinitions, nativeLanguage]);

  const selectedEntry = React.useMemo(() => {
    if (!selectedWord) return null;
    return enrichedVocab.find(item => item.word === selectedWord) || null;
  }, [enrichedVocab, selectedWord]);

  React.useEffect(() => {
    const existingDefinition = normalizeText(
      selectedEntry
        ? (selectedEntry.definitionZh || inlineDefinitions[selectedEntry.word] || '')
        : ''
    );
    setResolvedDefinition(existingDefinition);
    setDefinitionLoading(false);

    if (!selectedEntry || existingDefinition || nativeLanguage === 'english') {
      return;
    }

    let cancelled = false;
    setDefinitionLoading(true);

    void fetchWordTranslation(selectedEntry.word, nativeLanguage).then(translation => {
      if (cancelled) return;
      setResolvedDefinition(normalizeText(translation));
      setDefinitionLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [inlineDefinitions, nativeLanguage, selectedEntry]);

  const filterOptions = React.useMemo(
    () => [
      { key: 'review' as const, label: t('vocab.filterReview') },
      { key: 'all' as const, label: t('vocab.filterAll') },
      { key: 'practiced' as const, label: t('vocab.filterPracticed') },
      { key: 'known' as const, label: t('vocab.filterKnown') },
    ],
    [t]
  );

  const openDetail = React.useCallback((word: string) => {
    triggerUiFeedback('menu');
    setSelectedWord(word);
  }, []);

  const closeDetail = React.useCallback(() => {
    triggerUiFeedback('menu');
    setSelectedWord(null);
  }, []);

  const handleMarkKnown = React.useCallback((word: string) => {
    triggerUiFeedback('correct');
    onMarkKnown(word);
  }, [onMarkKnown]);

  return (
    <>
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
          data={filteredVocab}
          keyExtractor={item => item.word}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
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
              <View style={styles.headerStack}>
                <GlassCard style={styles.summaryCard} tone="feed">
                  <View style={styles.summaryTopRow}>
                    <View style={styles.summaryCopy}>
                      <Text style={styles.summaryEyebrow}>{t('vocab.summaryEyebrow')}</Text>
                      <View style={styles.summaryNumberRow}>
                        <Text style={styles.summaryNumber}>{reviewCount}</Text>
                        <Text style={styles.summaryLabel}>{t('vocab.summaryCountLabel')}</Text>
                      </View>
                    </View>
                    <View style={styles.summaryBadge}>
                      <Text style={styles.summaryBadgeText}>{t('vocab.summaryRecent', { count: recentCount })}</Text>
                    </View>
                  </View>
                  <Text style={styles.summaryBody}>{t('vocab.summaryBody')}</Text>
                  <View style={styles.summaryStatsRow}>
                    <View style={styles.summaryStat}>
                      <Text style={styles.summaryStatValue}>{vocabList.length}</Text>
                      <Text style={styles.summaryStatLabel}>{t('vocab.filterAll')}</Text>
                    </View>
                    <View style={styles.summaryStat}>
                      <Text style={styles.summaryStatValue}>{practicedCount}</Text>
                      <Text style={styles.summaryStatLabel}>{t('vocab.summaryPracticed')}</Text>
                    </View>
                    <View style={styles.summaryStat}>
                      <Text style={styles.summaryStatValue}>{b2PlusCount}</Text>
                      <Text style={styles.summaryStatLabel}>B2+</Text>
                    </View>
                    <View style={styles.summaryStat}>
                      <Text style={styles.summaryStatValue}>{knownCount}</Text>
                      <Text style={styles.summaryStatLabel}>{t('vocab.summaryKnown')}</Text>
                    </View>
                  </View>
                </GlassCard>

                <View style={styles.searchWrap}>
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder={t('vocab.searchPlaceholder')}
                    placeholderTextColor={colors.textTertiary}
                    selectionColor={colors.accentFeed}
                    style={styles.searchInput}
                  />
                </View>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.filterRow}
                >
                  {filterOptions.map(option => (
                    <PillButton
                      key={option.key}
                      label={option.label}
                      active={activeFilter === option.key}
                      onPress={() => {
                        triggerUiFeedback('menu');
                        setActiveFilter(option.key);
                      }}
                    />
                  ))}
                </ScrollView>

                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{t('vocab.sectionTitle')}</Text>
                  <Text style={styles.sectionMeta}>{t('vocab.sortNewest')}</Text>
                </View>
              </View>
            ) : null
          }
          ListEmptyComponent={
            vocabList.length === 0 ? (
              <EmptyState title={t('vocab.emptyTitle')} body={t('vocab.emptyBody')} />
            ) : (
              <GlassCard style={styles.filteredEmptyCard}>
                <Text style={styles.filteredEmptyTitle}>{t('vocab.emptyFilteredTitle')}</Text>
                <Text style={styles.filteredEmptyBody}>{t('vocab.emptyFilteredBody')}</Text>
              </GlassCard>
            )
          }
          renderItem={({ item }) => {
            const wordTranslation = normalizeText(item.definitionZh || inlineDefinitions[item.word] || '');
            const statusKey = item.isKnownResolved
              ? 'vocab.metaKnown'
              : item.practiced
                ? 'vocab.metaPracticed'
                : 'vocab.statusReview';

            return (
              <Pressable
                onPress={() => openDetail(item.word)}
                style={({ pressed }) => [
                  styles.cardPressable,
                  pressed && styles.cardPressablePressed,
                ]}
              >
                <GlassCard style={styles.card}>
                  <View style={styles.cardTop}>
                    <View style={styles.wordColumn}>
                      <View style={styles.wordRow}>
                        <Text style={styles.word}>{item.word}</Text>
                        {item.cefr ? (
                          <View style={styles.badge}>
                            <Text style={styles.badgeText}>{item.cefr}</Text>
                          </View>
                        ) : null}
                        <View
                          style={[
                            styles.statusBadge,
                            item.isKnownResolved && styles.statusBadgeKnown,
                            item.practiced && !item.isKnownResolved && styles.statusBadgePracticed,
                          ]}
                        >
                          <Text
                            style={[
                              styles.statusBadgeText,
                              item.isKnownResolved && styles.statusBadgeTextKnown,
                              item.practiced && !item.isKnownResolved && styles.statusBadgeTextPracticed,
                            ]}
                          >
                            {t(statusKey)}
                          </Text>
                        </View>
                      </View>
                      {item.phonetic ? <Text style={styles.phonetic}>{item.phonetic}</Text> : null}
                      {wordTranslation ? <Text style={styles.wordTranslation}>{wordTranslation}</Text> : null}
                    </View>
                  </View>

                  {item.context ? <Text style={styles.contextEn}>{item.context}</Text> : null}
                  {item.localizedContext ? <Text style={styles.contextZh}>{item.localizedContext}</Text> : null}

                  <View style={styles.cardFooter}>
                    <Text style={styles.meta}>{item.sourceTitle}</Text>
                    <Text style={styles.metaAction}>{t('vocab.openDetail')}</Text>
                  </View>
                </GlassCard>
              </Pressable>
            );
          }}
        />
      </ScreenSurface>

      <Modal
        visible={Boolean(selectedEntry)}
        transparent
        animationType="slide"
        onRequestClose={closeDetail}
      >
        <View style={styles.sheetOverlay}>
          <Pressable style={styles.sheetBackdrop} onPress={closeDetail} />
          <View style={[styles.sheetDock, { paddingBottom: Math.max(metrics.insets.bottom + 12, 20) }]}>
            <View
              style={[
                styles.sheetCard,
                {
                  marginHorizontal: metrics.pageHorizontalPadding,
                  maxWidth: metrics.modalMaxWidth,
                  maxHeight: Math.min(metrics.windowHeight * 0.76, 620),
                },
              ]}
            >
              {selectedEntry ? (
                <ScrollView
                  style={styles.sheetScroll}
                  contentContainerStyle={styles.sheetScrollContent}
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.sheetHandle} />
                  <View style={styles.sheetHeaderRow}>
                    <View style={styles.sheetHeaderCopy}>
                      <View style={styles.sheetWordRow}>
                        <Text style={styles.sheetWord}>{selectedEntry.word}</Text>
                        {selectedEntry.cefr ? (
                          <View style={styles.badge}>
                            <Text style={styles.badgeText}>{selectedEntry.cefr}</Text>
                          </View>
                        ) : null}
                      </View>
                      {selectedEntry.phonetic ? (
                        <Text style={styles.sheetPhonetic}>{selectedEntry.phonetic}</Text>
                      ) : null}
                    </View>
                    <PillButton label={t('common.close')} subtle onPress={closeDetail} />
                  </View>

                  <View style={styles.sheetTagRow}>
                    <View style={styles.sheetTag}>
                      <Text style={styles.sheetTagText}>{selectedEntry.sourceLabel}</Text>
                    </View>
                    {selectedEntry.tag ? (
                      <View style={styles.sheetTag}>
                        <Text style={styles.sheetTagText}>{selectedEntry.tag}</Text>
                      </View>
                    ) : null}
                    <View style={styles.sheetTagMuted}>
                      <Text style={styles.sheetTagMutedText}>
                        {selectedEntry.isKnownResolved ? t('vocab.metaKnown') : selectedEntry.practiced ? t('vocab.metaPracticed') : t('vocab.statusReview')}
                      </Text>
                    </View>
                  </View>

                  <GlassCard style={styles.detailCard}>
                    <Text style={styles.detailBody}>
                      {definitionLoading
                        ? t('wordPopup.loading')
                        : (resolvedDefinition || t('vocab.detailDefinitionFallback'))}
                    </Text>
                  </GlassCard>

                  {(selectedEntry.context || selectedEntry.localizedContext) ? (
                    <GlassCard style={styles.detailCard}>
                      <Text style={styles.detailSectionTitle}>{t('vocab.detailSourceTitle')}</Text>
                      <Text style={styles.detailSourceTitle}>
                        {selectedEntry.sourceTitle || t('vocab.detailSourceFallback')}
                      </Text>
                      {selectedEntry.context ? <Text style={styles.detailContextEn}>{selectedEntry.context}</Text> : null}
                      {selectedEntry.localizedContext ? (
                        <Text style={styles.detailContextZh}>{selectedEntry.localizedContext}</Text>
                      ) : null}
                    </GlassCard>
                  ) : null}

                  <View style={styles.sheetActionRow}>
                    <ActionButton
                      label={selectedEntry.isKnownResolved ? t('wordPopup.known') : t('wordPopup.markKnown')}
                      variant={selectedEntry.isKnownResolved ? 'secondary' : 'success'}
                      disabled={selectedEntry.isKnownResolved}
                      style={styles.sheetPrimaryAction}
                      onPress={() => handleMarkKnown(selectedEntry.word)}
                    />
                    <ActionButton
                      label={t('common.close')}
                      variant="secondary"
                      style={styles.sheetSecondaryAction}
                      onPress={closeDetail}
                    />
                  </View>
                </ScrollView>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
    </>
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
    headerStack: {
      gap: spacing.md,
      marginBottom: spacing.sm,
    },
    summaryCard: {
      gap: spacing.md,
      backgroundColor: `${colors.accentFeed}16`,
      borderColor: `${colors.accentFeed}36`,
    },
    summaryTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: spacing.md,
      alignItems: 'flex-start',
    },
    summaryCopy: {
      flex: 1,
      gap: 6,
    },
    summaryEyebrow: {
      color: colors.accentFeed,
      fontSize: typography.caption,
      fontWeight: '700',
    },
    summaryNumberRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    summaryNumber: {
      color: colors.textPrimary,
      fontSize: 38,
      lineHeight: 42,
      fontWeight: '700',
    },
    summaryLabel: {
      color: colors.textPrimary,
      fontSize: typography.bodyLg,
      fontWeight: '700',
      paddingBottom: 4,
    },
    summaryBadge: {
      borderRadius: radii.pill,
      backgroundColor: `${colors.bgApp}40`,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    summaryBadgeText: {
      color: colors.textPrimary,
      fontSize: typography.micro,
      fontWeight: '700',
    },
    summaryBody: {
      color: colors.textSecondary,
      fontSize: typography.body,
      lineHeight: 20,
    },
    summaryStatsRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      flexWrap: 'wrap',
    },
    summaryStat: {
      minWidth: 64,
      borderRadius: radii.lg,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: `${colors.bgApp}34`,
      gap: 4,
    },
    summaryStatValue: {
      color: colors.textPrimary,
      fontSize: typography.title,
      fontWeight: '700',
    },
    summaryStatLabel: {
      color: colors.textSecondary,
      fontSize: typography.micro,
      fontWeight: '600',
    },
    searchWrap: {
      borderRadius: radii.xl,
      backgroundColor: colors.bgSurface1,
      borderWidth: 1,
      borderColor: colors.stroke,
      paddingHorizontal: spacing.lg,
    },
    searchInput: {
      minHeight: 48,
      color: colors.textPrimary,
      fontSize: typography.bodyLg,
    },
    filterRow: {
      gap: spacing.sm,
      paddingRight: spacing.sm,
    },
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: spacing.md,
    },
    sectionTitle: {
      color: colors.textPrimary,
      fontSize: typography.title,
      fontWeight: '700',
    },
    sectionMeta: {
      color: colors.textTertiary,
      fontSize: typography.micro,
      fontWeight: '700',
    },
    filteredEmptyCard: {
      gap: spacing.sm,
      alignItems: 'center',
      paddingVertical: spacing.xxl,
    },
    filteredEmptyTitle: {
      color: colors.textPrimary,
      fontSize: 18,
      fontWeight: '700',
      textAlign: 'center',
    },
    filteredEmptyBody: {
      color: colors.textSecondary,
      fontSize: typography.body,
      lineHeight: 20,
      textAlign: 'center',
    },
    cardPressable: {
      borderRadius: radii.xl,
    },
    cardPressablePressed: {
      opacity: 0.92,
      transform: [{ scale: 0.992 }],
    },
    card: {
      gap: spacing.sm,
    },
    cardTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: spacing.md,
    },
    wordColumn: {
      flex: 1,
      gap: 6,
    },
    wordRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    word: {
      color: colors.textPrimary,
      fontSize: 20,
      fontWeight: '700',
    },
    phonetic: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      fontWeight: '600',
    },
    wordTranslation: {
      color: colors.textSecondary,
      fontSize: typography.body,
      lineHeight: 20,
      fontWeight: '600',
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
    statusBadge: {
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
      backgroundColor: `${colors.accentFeed}20`,
    },
    statusBadgeKnown: {
      backgroundColor: `${colors.accentSuccess}20`,
    },
    statusBadgePracticed: {
      backgroundColor: `${colors.accentPractice}20`,
    },
    statusBadgeText: {
      color: colors.accentFeed,
      fontSize: typography.micro,
      fontWeight: '700',
    },
    statusBadgeTextKnown: {
      color: colors.accentSuccess,
    },
    statusBadgeTextPracticed: {
      color: colors.accentPractice,
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
    cardFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: spacing.md,
    },
    meta: {
      flex: 1,
      color: colors.textTertiary,
      fontSize: typography.micro,
      fontWeight: '600',
    },
    metaAction: {
      color: colors.accentFeed,
      fontSize: typography.micro,
      fontWeight: '700',
    },
    sheetOverlay: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    sheetBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.bgDim,
    },
    sheetDock: {
      width: '100%',
      justifyContent: 'flex-end',
      alignItems: 'center',
    },
    sheetCard: {
      width: '100%',
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      backgroundColor: colors.bgOverlay,
      borderWidth: 1,
      borderColor: colors.strokeStrong,
      overflow: 'hidden',
    },
    sheetScroll: {
      flexGrow: 0,
    },
    sheetScrollContent: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.lg,
      paddingTop: spacing.md,
      gap: spacing.md,
    },
    sheetHandle: {
      alignSelf: 'center',
      width: 44,
      height: 5,
      borderRadius: 999,
      backgroundColor: colors.textFaint,
      marginBottom: spacing.sm,
    },
    sheetHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: spacing.md,
    },
    sheetHeaderCopy: {
      flex: 1,
      gap: 6,
      paddingTop: 2,
    },
    sheetWordRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      flexWrap: 'wrap',
    },
    sheetWord: {
      color: colors.textPrimary,
      fontSize: 28,
      fontWeight: '700',
    },
    sheetPhonetic: {
      color: colors.accentFeed,
      fontSize: typography.caption,
      fontWeight: '700',
    },
    sheetTagRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      flexWrap: 'wrap',
    },
    sheetTag: {
      borderRadius: radii.pill,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: `${colors.accentFeed}20`,
    },
    sheetTagText: {
      color: colors.accentFeed,
      fontSize: typography.micro,
      fontWeight: '700',
    },
    sheetTagMuted: {
      borderRadius: radii.pill,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: colors.bgSurface2,
    },
    sheetTagMutedText: {
      color: colors.textSecondary,
      fontSize: typography.micro,
      fontWeight: '700',
    },
    detailCard: {
      gap: spacing.sm,
    },
    detailBody: {
      color: colors.textPrimary,
      fontSize: typography.bodyLg,
      lineHeight: 22,
    },
    detailSectionTitle: {
      color: colors.textTertiary,
      fontSize: typography.micro,
      fontWeight: '700',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    detailSourceTitle: {
      color: colors.textPrimary,
      fontSize: typography.body,
      fontWeight: '700',
    },
    detailContextEn: {
      color: colors.textPrimary,
      fontSize: typography.body,
      lineHeight: 20,
    },
    detailContextZh: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      lineHeight: 18,
    },
    sheetActionRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    sheetPrimaryAction: {
      flex: 1,
    },
    sheetSecondaryAction: {
      flex: 1,
    },
  });
}
