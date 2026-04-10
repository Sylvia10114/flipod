import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { INTERESTS, LEVELS } from '../constants';
import type { Level, Profile } from '../types';

type Props = {
  initialProfile?: Profile | null;
  onSubmit: (profile: Profile) => void;
};

export function OnboardingScreen({ initialProfile, onSubmit }: Props) {
  const [selectedLevel, setSelectedLevel] = useState<Level | null>(initialProfile?.level || null);
  const [selectedTags, setSelectedTags] = useState<string[]>(initialProfile?.interests || []);

  const canContinue = useMemo(() => Boolean(selectedLevel) && selectedTags.length === 3, [selectedLevel, selectedTags]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev: string[]) => {
      if (prev.includes(tag)) {
        return prev.filter((item: string) => item !== tag);
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
        <Text style={styles.kicker}>FLIPOD</Text>
        <Text style={styles.title}>你现在听英语播客的感受？</Text>
        <View style={styles.cardGroup}>
          {LEVELS.map(level => (
            <Pressable
              key={level}
              onPress={() => setSelectedLevel(level)}
              style={[styles.optionCard, selectedLevel === level && styles.optionCardSelected]}
            >
              <Text style={[styles.optionTitle, selectedLevel === level && styles.optionTitleSelected]}>{level}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>选择 3 个你感兴趣的领域</Text>
        <View style={styles.tagWrap}>
          {INTERESTS.map(tag => {
            const active = selectedTags.includes(tag);
            return (
              <Pressable
                key={tag}
                onPress={() => toggleTag(tag)}
                style={[styles.tag, active && styles.tagSelected]}
              >
                <Text style={[styles.tagText, active && styles.tagTextSelected]}>{tag}</Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          disabled={!canContinue}
          onPress={() => {
            if (!selectedLevel || selectedTags.length !== 3) return;
            onSubmit({
              level: selectedLevel,
              interests: selectedTags,
              theme: initialProfile?.theme || 'dark',
              onboardingDone: true,
            });
          }}
          style={[styles.primaryButton, !canContinue && styles.primaryButtonDisabled]}
        >
          <Text style={styles.primaryButtonText}>开始探索</Text>
        </Pressable>
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
  kicker: {
    color: '#8B9CF7',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    marginTop: 18,
    marginBottom: 20,
  },
  cardGroup: {
    gap: 12,
  },
  optionCard: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  optionCardSelected: {
    borderColor: '#8B9CF7',
    backgroundColor: 'rgba(139,156,247,0.16)',
  },
  optionTitle: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 17,
    fontWeight: '600',
  },
  optionTitleSelected: {
    color: '#FFFFFF',
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 28,
    marginBottom: 14,
  },
  tagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
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
