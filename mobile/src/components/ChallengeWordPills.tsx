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
  variant?: 'default' | 'preview';
};

export function ChallengeWordPills({ words, tone = 'feed', singleRow = false, variant = 'default' }: Props) {
  const { colors } = useAppTheme();
  const { nativeLanguage } = useUiI18n();
  const styles = useMemo(() => createStyles(colors, tone, singleRow, variant), [colors, tone, singleRow, variant]);
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
        const inlineTranslation = words.find(item => item.word === word && item.translationLocale === nativeLanguage)?.translation;
        if (inlineTranslation) {
          next[word] = inlineTranslation;
          return;
        }
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
        const inlineTranslation = word.translationLocale === nativeLanguage ? word.translation || '' : '';
        const translation = inlineTranslation || translations[word.word] || '';
        return (
          <View key={`${word.word}-${word.lineIndex}`} style={styles.pill}>
            <View style={styles.wordRow}>
              <Text style={styles.wordText}>{word.word}</Text>
              {word.cefr && variant !== 'preview' ? <Text style={styles.badge}>{word.cefr}</Text> : null}
            </View>
            <Text style={[styles.translationText, !translation && styles.translationPlaceholder]}>
              {translation || ' '}
            </Text>
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
  singleRow: boolean,
  variant: 'default' | 'preview'
) {
  const accent = tone === 'feed' ? colors.accentFeed : colors.accentPractice;
  const border = tone === 'feed' ? 'rgba(139,156,247,0.24)' : 'rgba(168,85,247,0.22)';
  const background = tone === 'feed' ? 'rgba(139,156,247,0.12)' : 'rgba(168,85,247,0.10)';
  const preview = variant === 'preview';

  return StyleSheet.create({
    scrollContent: {
      paddingRight: spacing.xs,
    },
    row: {
      flexDirection: preview ? 'column' : 'row',
      flexWrap: preview ? 'nowrap' : (singleRow ? 'nowrap' : 'wrap'),
      gap: preview ? 28 : spacing.sm,
      justifyContent: tone === 'feed' ? 'center' : 'flex-start',
      alignItems: preview ? 'center' : (singleRow ? 'stretch' : 'flex-start'),
    },
    pill: {
      minWidth: preview ? 0 : 88,
      minHeight: preview ? 78 : undefined,
      gap: preview ? 2 : 4,
      paddingHorizontal: preview ? 0 : 12,
      paddingVertical: preview ? 0 : 8,
      borderRadius: preview ? 0 : radii.lg,
      backgroundColor: preview ? 'transparent' : background,
      borderWidth: preview ? 0 : 1,
      borderColor: preview ? 'transparent' : border,
      alignItems: preview ? 'center' : 'stretch',
      justifyContent: preview ? 'center' : 'flex-start',
    },
    wordRow: {
      flexDirection: 'row',
      alignItems: preview ? 'center' : 'center',
      justifyContent: preview ? 'center' : 'flex-start',
      gap: preview ? 5 : 6,
    },
    wordText: {
      color: colors.textPrimary,
      fontSize: preview ? 44 : typography.caption,
      lineHeight: preview ? 48 : undefined,
      fontWeight: preview ? '600' : '700',
      flexShrink: 1,
      textAlign: preview ? 'center' : 'left',
      letterSpacing: preview ? -0.6 : 0,
    },
    badge: {
      color: accent,
      fontSize: typography.micro,
      fontWeight: '700',
    },
    translationText: {
      color: colors.textSecondary,
      fontSize: preview ? 14 : 11,
      lineHeight: preview ? 18 : 15,
      minHeight: preview ? 18 : undefined,
      textAlign: preview ? 'center' : 'left',
      letterSpacing: preview ? 0.3 : 0,
    },
    translationPlaceholder: {
      opacity: preview ? 0 : 1,
    },
  });
}
