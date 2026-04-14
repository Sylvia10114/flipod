import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ActionButton, GlassCard, ScreenSurface, StepDots } from '../components/AppChrome';
import { colors, radii, spacing, typography } from '../design';
import { INTERESTS, LEVELS } from '../constants';
import { triggerUiFeedback } from '../feedback';
import type { Level, Profile } from '../types';

type Props = {
  initialProfile?: Profile | null;
  onSubmit: (profile: Profile) => void;
};

const LEVEL_COPY: Record<Level, string> = {
  'A1-A2': '能抓到少量单词，需要更多帮助',
  B1: '大意大概能跟上，细节经常漏掉',
  B2: '大部分能听懂，偶尔卡在复杂句',
  'C1-C2': '基本无障碍，想听更难一点的',
};

const INTEREST_LABELS: Record<(typeof INTERESTS)[number], string> = {
  science: 'science',
  business: 'business',
  psychology: 'psychology',
  story: 'story',
  history: 'history',
  culture: 'culture',
  tech: 'technology',
  society: 'society',
};

export function OnboardingScreen({ initialProfile, onSubmit }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedLevel, setSelectedLevel] = useState<Level | null>(initialProfile?.level || null);
  const [selectedTags, setSelectedTags] = useState<string[]>(initialProfile?.interests || []);

  const canContinue = useMemo(() => Boolean(selectedLevel), [selectedLevel]);
  const canStart = useMemo(() => selectedTags.length === 3, [selectedTags]);

  useEffect(() => {
    if (step !== 3 || !selectedLevel || selectedTags.length !== 3) return;
    const timeout = setTimeout(() => {
      onSubmit({
        level: selectedLevel,
        interests: selectedTags,
        theme: initialProfile?.theme || 'dark',
        onboardingDone: true,
      });
    }, 1200);

    return () => clearTimeout(timeout);
  }, [initialProfile?.theme, onSubmit, selectedLevel, selectedTags, step]);

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => {
      if (prev.includes(tag)) {
        return prev.filter(item => item !== tag);
      }
      if (prev.length >= 3) {
        return [...prev.slice(1), tag];
      }
      return [...prev, tag];
    });
  };

  return (
    <ScreenSurface>
      <View style={styles.container}>
        {step === 1 ? (
          <>
            <View style={styles.topBlock}>
              <StepDots count={2} active={1} accent={colors.accentFeed} />
              <Text style={styles.title}>你现在听英语播客时的感觉？</Text>
              <Text style={styles.subtitle}>先大概定一个难度，后面 AI 会继续校准。</Text>
            </View>

            <View style={styles.levelList}>
              {LEVELS.map(level => {
                const selected = selectedLevel === level;
                return (
                  <Pressable
                    key={level}
                    onPress={() => {
                      triggerUiFeedback('card');
                      setSelectedLevel(level);
                    }}
                  >
                    <GlassCard style={[styles.levelCard, selected && styles.levelCardActive]}>
                      <View style={styles.levelCardTop}>
                        <Text style={styles.levelCopy}>{LEVEL_COPY[level]}</Text>
                        <View style={[styles.levelBadge, selected && styles.levelBadgeActive]}>
                          <Text style={[styles.levelBadgeText, selected && styles.levelBadgeTextActive]}>{level}</Text>
                        </View>
                      </View>
                    </GlassCard>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.hint}>不确定也没关系，先选最接近的一档。</Text>
            <ActionButton
              label="继续"
              disabled={!canContinue}
              onPress={() => {
                if (!selectedLevel) return;
                triggerUiFeedback('onboarding');
                setStep(2);
              }}
              style={styles.primaryAction}
            />
          </>
        ) : null}

        {step === 2 ? (
          <>
            <View style={styles.topBlock}>
              <StepDots count={2} active={2} accent={colors.accentFeed} />
              <Text style={styles.title}>你对哪些主题更有兴趣？</Text>
              <Text style={styles.subtitle}>选 3 个，Feed 会先从这些方向开始推。</Text>
            </View>

            <View style={styles.tagWrap}>
              {INTERESTS.map(tag => {
                const active = selectedTags.includes(tag);
                return (
                  <Pressable
                    key={tag}
                    onPress={() => {
                      triggerUiFeedback('card');
                      toggleTag(tag);
                    }}
                    style={[styles.tag, active && styles.tagActive]}
                  >
                    <Text style={[styles.tagText, active && styles.tagTextActive]}>{INTEREST_LABELS[tag]}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.hint}>已选 {selectedTags.length}/3，随便选也行，后面会继续学习你的偏好。</Text>

            <ActionButton
              label="开始探索"
              disabled={!canStart}
              onPress={() => {
                if (!selectedLevel || selectedTags.length !== 3) return;
                triggerUiFeedback('onboarding');
                setStep(3);
              }}
              style={styles.primaryAction}
            />
          </>
        ) : null}

        {step === 3 ? (
          <View style={styles.loadingBlock}>
            <Text style={styles.loadingCopy}>正在为你准备第一批内容...</Text>
            <View style={styles.loadingDots}>
              {[0, 1, 2].map(item => (
                <View key={`loading-${item}`} style={[styles.loadingDot, item === 1 && styles.loadingDotActive]} />
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </ScreenSurface>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.page,
    paddingTop: 24,
    paddingBottom: 28,
  },
  topBlock: {
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: 28,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.bodyLg,
    lineHeight: 22,
    textAlign: 'center',
    paddingHorizontal: 18,
  },
  levelList: {
    gap: spacing.md,
  },
  levelCard: {
    borderRadius: radii.lg,
    paddingVertical: 18,
    backgroundColor: 'transparent',
  },
  levelCardActive: {
    backgroundColor: 'rgba(139,156,247,0.14)',
    borderColor: 'rgba(139,156,247,0.28)',
  },
  levelCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  levelCopy: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.body,
    lineHeight: 20,
    fontWeight: '600',
  },
  levelBadge: {
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.bgSurface2,
  },
  levelBadgeActive: {
    backgroundColor: colors.accentFeed,
  },
  levelBadgeText: {
    color: colors.textPrimary,
    fontSize: typography.micro,
    fontWeight: '700',
  },
  levelBadgeTextActive: {
    color: colors.textOnAccent,
  },
  tagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: 6,
  },
  tag: {
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.stroke,
    backgroundColor: colors.bgSurface1,
  },
  tagActive: {
    backgroundColor: colors.accentFeed,
    borderColor: colors.accentFeed,
  },
  tagText: {
    color: colors.textPrimary,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  tagTextActive: {
    color: colors.textOnAccent,
  },
  hint: {
    marginTop: 18,
    color: colors.textTertiary,
    fontSize: typography.caption,
    lineHeight: 18,
    textAlign: 'center',
  },
  primaryAction: {
    marginTop: 'auto',
  },
  loadingBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  loadingCopy: {
    color: colors.textSecondary,
    fontSize: typography.bodyLg,
  },
  loadingDots: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  loadingDot: {
    width: 6,
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.textFaint,
  },
  loadingDotActive: {
    backgroundColor: colors.accentFeed,
  },
});
