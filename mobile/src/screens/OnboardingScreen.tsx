import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { INTERESTS, LEVELS } from '../constants';
import { triggerUiFeedback } from '../feedback';
import type { Level, Profile } from '../types';

type Props = {
  initialProfile?: Profile | null;
  onSubmit: (profile: Profile) => void;
};

const LEVEL_COPY: Record<Level, string> = {
  'A1-A2': '基本听不懂，偶尔抓到几个词',
  B1: '能听懂大意，细节经常漏',
  B2: '大部分能跟上，复杂话题偶尔吃力',
  'C1-C2': '基本无障碍，想挑战更难的',
};

const INTEREST_LABELS: Record<(typeof INTERESTS)[number], string> = {
  science: '🔬 Science',
  business: '💼 Business',
  psychology: '🧠 Psychology',
  story: '📖 Story',
  history: '🏛 History',
  culture: '🎵 Culture',
  tech: '💻 Tech',
  society: '🌍 Society',
};

export function OnboardingScreen({ initialProfile, onSubmit }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedLevel, setSelectedLevel] = useState<Level | null>(initialProfile?.level || null);
  const [selectedTags, setSelectedTags] = useState<string[]>(initialProfile?.interests || []);

  const canContinue = useMemo(() => Boolean(selectedLevel), [selectedLevel]);
  const canStart = useMemo(() => selectedTags.length === 3, [selectedTags]);

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
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.dotsRow}>
          <View style={[styles.dot, step === 1 && styles.dotActive]} />
          <View style={[styles.dot, step === 2 && styles.dotActive]} />
        </View>

        {step === 1 ? (
          <>
            <Text style={styles.title}>你现在听英语播客的感受？</Text>
            <Text style={styles.subtitle}>选择最接近你的描述</Text>

            <View style={styles.cardGroup}>
              {LEVELS.map(level => {
                const selected = selectedLevel === level;
                return (
                  <Pressable
                    key={level}
                    onPress={() => {
                      triggerUiFeedback('card');
                      setSelectedLevel(level);
                    }}
                    style={[styles.optionCard, selected && styles.optionCardSelected]}
                  >
                    <View style={[styles.checkCircle, selected && styles.checkCircleSelected]}>
                      <Text style={[styles.checkMark, selected && styles.checkMarkSelected]}>✓</Text>
                    </View>
                    <View style={styles.optionTextWrap}>
                      <Text style={styles.optionLabel}>{LEVEL_COPY[level]}</Text>
                      <Text style={[styles.optionLevel, selected && styles.optionLevelSelected]}>{level}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.hint}>不确定也没关系，AI 会根据你的表现自动调整</Text>

            <Pressable
              disabled={!canContinue}
              onPress={() => {
                if (!selectedLevel) return;
                triggerUiFeedback('onboarding');
                setStep(2);
              }}
              style={[styles.primaryButton, !canContinue && styles.primaryButtonDisabled]}
            >
              <Text style={styles.primaryButtonText}>下一步</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.title}>你对什么话题感兴趣？</Text>
            <Text style={styles.subtitle}>选择 3 个你感兴趣的领域</Text>

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
                    style={[styles.tag, active && styles.tagSelected]}
                  >
                    <Text style={[styles.tagText, active && styles.tagTextSelected]}>{INTEREST_LABELS[tag]}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.hint}>随便选几个就行，AI 会从你的行为中学习</Text>

            <Pressable
              disabled={!canStart}
              onPress={() => {
                if (!selectedLevel || selectedTags.length !== 3) return;
                triggerUiFeedback('onboarding');
                onSubmit({
                  level: selectedLevel,
                  interests: selectedTags,
                  theme: initialProfile?.theme || 'dark',
                  onboardingDone: true,
                });
              }}
              style={[styles.primaryButton, !canStart && styles.primaryButtonDisabled]}
            >
              <Text style={styles.primaryButtonText}>开始探索</Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#09090B',
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 28,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  dotActive: {
    backgroundColor: '#FFFFFF',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.52)',
    fontSize: 15,
    marginTop: 10,
    textAlign: 'center',
  },
  cardGroup: {
    gap: 12,
    marginTop: 28,
  },
  optionCard: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: 'rgba(255,255,255,0.04)',
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
  },
  optionCardSelected: {
    borderColor: '#8B9CF7',
    backgroundColor: 'rgba(139,156,247,0.16)',
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleSelected: {
    backgroundColor: '#8B9CF7',
    borderColor: '#8B9CF7',
  },
  checkMark: {
    color: 'transparent',
    fontSize: 13,
    fontWeight: '700',
  },
  checkMarkSelected: {
    color: '#FFFFFF',
  },
  optionTextWrap: {
    flex: 1,
  },
  optionLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  optionLevel: {
    marginTop: 6,
    color: 'rgba(255,255,255,0.42)',
    fontSize: 13,
    fontWeight: '600',
  },
  optionLevelSelected: {
    color: '#DDE3FF',
  },
  tagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 28,
  },
  tag: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  tagSelected: {
    backgroundColor: '#8B9CF7',
    borderColor: '#8B9CF7',
  },
  tagText: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 14,
    fontWeight: '600',
  },
  tagTextSelected: {
    color: '#0B1020',
  },
  hint: {
    marginTop: 16,
    color: 'rgba(255,255,255,0.42)',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  primaryButton: {
    marginTop: 'auto',
    borderRadius: 18,
    backgroundColor: '#8B9CF7',
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.35,
  },
  primaryButtonText: {
    color: '#0B1020',
    fontSize: 16,
    fontWeight: '700',
  },
});
