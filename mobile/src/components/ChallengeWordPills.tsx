import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { radii, spacing, typography } from '../design';
import { useUiI18n } from '../i18n';
import { useAppTheme } from '../theme';
import type { ChallengeWord } from '../types';
import { fetchWordTranslation } from '../word-translation';

type Props = {
  words: ChallengeWord[];
  tone?: 'feed' | 'practice';
  singleRow?: boolean;
};

export function ChallengeWordPills({ words, tone = 'feed', singleRow = false }: Props) {
  const { colors } = useAppTheme();
  const { nativeLanguage } = useUiI18n();
  const styles = useMemo(() => createStyles(colors, tone, singleRow), [colors, tone, singleRow]);
  const [translations, setTranslations] = useState<Record<string, string>>({});

  useEffect(() => {
    if (nativeLanguage === 'english' || words.length === 0) {
      setTranslations({});
      return;
    }

    let cancelled = false;
    const uniqueWords = [...new Set(words.map(item => item.word.trim()).filter(Boolean))];

    void Promise.all(
      uniqueWords.map(async word => [word, await fetchWordTranslation(word, nativeLanguage)] as const)
    ).then(entries => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      entries.forEach(([word, translation]) => {
        if (translation) {
          next[word] = translation;
        }
      });
      setTranslations(next);
    });

    return () => {
      cancelled = true;
    };
  }, [nativeLanguage, words]);

  const content = (
    <View style={styles.row}>
      {words.map(word => {
        const translation = translations[word.word] || '';
        return (
          <View key={`${word.word}-${word.lineIndex}`} style={styles.pill}>
            <View style={styles.wordRow}>
              <Text style={styles.wordText}>{word.word}</Text>
              {word.cefr ? <Text style={styles.badge}>{word.cefr}</Text> : null}
            </View>
            {translation ? <Text style={styles.translationText}>{translation}</Text> : null}
          </View>
        );
      })}
    </View>
  );

  if (singleRow) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {content}
      </ScrollView>
    );
  }

  return content;
}

function createStyles(
  colors: ReturnType<typeof useAppTheme>['colors'],
  tone: 'feed' | 'practice',
  singleRow: boolean
) {
  const accent = tone === 'feed' ? colors.accentFeed : colors.accentPractice;
  const border = tone === 'feed' ? 'rgba(139,156,247,0.24)' : 'rgba(168,85,247,0.22)';
  const background = tone === 'feed' ? 'rgba(139,156,247,0.12)' : 'rgba(168,85,247,0.10)';

  return StyleSheet.create({
    scrollContent: {
      paddingRight: spacing.xs,
    },
    row: {
      flexDirection: 'row',
      flexWrap: singleRow ? 'nowrap' : 'wrap',
      gap: spacing.sm,
      justifyContent: tone === 'feed' ? 'center' : 'flex-start',
      alignItems: singleRow ? 'stretch' : 'flex-start',
    },
    pill: {
      minWidth: 88,
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radii.lg,
      backgroundColor: background,
      borderWidth: 1,
      borderColor: border,
    },
    wordRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    wordText: {
      color: colors.textPrimary,
      fontSize: typography.caption,
      fontWeight: '700',
      flexShrink: 1,
    },
    badge: {
      color: accent,
      fontSize: typography.micro,
      fontWeight: '700',
    },
    translationText: {
      color: colors.textSecondary,
      fontSize: 11,
      lineHeight: 15,
    },
  });
}
