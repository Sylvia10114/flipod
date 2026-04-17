import { Audio, type AVPlaybackStatus } from 'expo-av';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionButton, GlassCard, ScreenSurface, StepDots } from '../components/AppChrome';
import { LanguageSelectionList } from '../components/LanguageSelectionList';
import { getDevicePreferredNativeLanguage } from '../content-localization';
import { radii, spacing, typography } from '../design';
import { INTERESTS, LEVELS } from '../constants';
import { triggerUiFeedback } from '../feedback';
import { createUiI18n } from '../i18n';
import { useResponsiveLayout } from '../responsive';
import { useAppTheme } from '../theme';
import type { Level, NativeLanguage, Profile } from '../types';

type Props = {
  initialProfile?: Profile | null;
  onSubmit: (profile: Profile) => void;
};

type StaircaseStep = {
  audio: number;
  text: string;
  labelKey: string;
  resultIfNo: Level;
  titleKey: string;
};

const STAIRCASE: StaircaseStep[] = [
  {
    audio: require('../../assets/onboarding_tts/staircase_1.mp3'),
    text: 'I like to go to the park with my dog. We play there every day.',
    labelKey: 'onboarding.stageLabel1',
    resultIfNo: 'A1-A2',
    titleKey: 'onboarding.stageTitle1',
  },
  {
    audio: require('../../assets/onboarding_tts/staircase_2.mp3'),
    text: 'Last summer I traveled to a small town near the sea. The local food was delicious and the people were friendly.',
    labelKey: 'onboarding.stageLabel2',
    resultIfNo: 'B1',
    titleKey: 'onboarding.stageTitle2',
  },
  {
    audio: require('../../assets/onboarding_tts/staircase_3.mp3'),
    text: 'The government has introduced new regulations to tackle pollution in major cities. Many residents remain skeptical about whether these measures will be sufficient.',
    labelKey: 'onboarding.stageLabel3',
    resultIfNo: 'B2',
    titleKey: 'onboarding.stageTitle3',
  },
  {
    audio: require('../../assets/onboarding_tts/staircase_4.mp3'),
    text: 'The rapid advancement of surveillance technology raises profound ethical dilemmas. Critics argue that insufficient transparency could undermine fundamental civil liberties.',
    labelKey: 'onboarding.stageLabel4',
    resultIfNo: 'C1-C2',
    titleKey: 'onboarding.stageTitle4',
  },
];

const FINAL_YES_LEVEL: Level = 'C1-C2';
const MIN_LOADING_FEEDBACK_MS = 320;

export function OnboardingScreen({ initialProfile, onSubmit }: Props) {
  const { colors } = useAppTheme();
  const metrics = useResponsiveLayout();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedLevel, setSelectedLevel] = useState<Level | null>(initialProfile?.level || null);
  const [selectedTags, setSelectedTags] = useState<string[]>(initialProfile?.interests || []);
  const [selectedNativeLanguage, setSelectedNativeLanguage] = useState<NativeLanguage>(
    initialProfile?.nativeLanguage || getDevicePreferredNativeLanguage()
  );
  const [staircaseIndex, setStaircaseIndex] = useState(0);
  const [manualLevelFallback, setManualLevelFallback] = useState(false);
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [showQuestion, setShowQuestion] = useState(false);
  const [playbackError, setPlaybackError] = useState('');
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const soundRef = useRef<Audio.Sound | null>(null);
  const playbackRequestRef = useRef(0);

  const ui = useMemo(() => createUiI18n(selectedNativeLanguage), [selectedNativeLanguage]);
  const currentStaircase = STAIRCASE[staircaseIndex];
  const levelCopy = useMemo<Record<Level, string>>(() => ({
    'A1-A2': ui.t('onboarding.levelA1A2'),
    B1: ui.t('onboarding.levelB1'),
    B2: ui.t('onboarding.levelB2'),
    'C1-C2': ui.t('onboarding.levelC1C2'),
  }), [ui]);
  const interestLabels = useMemo<Record<(typeof INTERESTS)[number], string>>(() => ({
    science: ui.t('topics.science'),
    business: ui.t('topics.business'),
    psychology: ui.t('topics.psychology'),
    story: ui.t('topics.story'),
    history: ui.t('topics.history'),
    culture: ui.t('topics.culture'),
    tech: ui.t('topics.tech'),
    society: ui.t('topics.society'),
  }), [ui]);
  const canContinue = useMemo(() => Boolean(selectedLevel), [selectedLevel]);
  const canStart = useMemo(() => selectedTags.length === 3, [selectedTags]);

  useEffect(() => {
    if (step !== 4 || !selectedLevel || selectedTags.length !== 3) return;
    const timeout = setTimeout(() => {
      onSubmit({
        level: selectedLevel,
        interests: selectedTags,
        nativeLanguage: selectedNativeLanguage,
        theme: initialProfile?.theme || 'dark',
        onboardingDone: true,
      });
    }, 1200);

    return () => clearTimeout(timeout);
  }, [initialProfile?.theme, onSubmit, selectedLevel, selectedNativeLanguage, selectedTags, step]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      if (soundRef.current) {
        const sound = soundRef.current;
        soundRef.current = null;
        sound.setOnPlaybackStatusUpdate(null);
        void sound.unloadAsync().catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    if (step === 2) return;
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    setIsAudioLoading(false);
    setIsSpeaking(false);
    setShowQuestion(false);
    if (soundRef.current) {
      const sound = soundRef.current;
      soundRef.current = null;
      sound.setOnPlaybackStatusUpdate(null);
      void sound.unloadAsync().catch(() => undefined);
    }
  }, [step]);

  useEffect(() => {
    setPlaybackProgress(0);
    setShowQuestion(false);
    setPlaybackError('');
  }, [staircaseIndex]);

  const clearProgressTimer = () => {
    if (!progressTimerRef.current) return;
    clearInterval(progressTimerRef.current);
    progressTimerRef.current = null;
  };

  const waitForMinimumLoadingFeedback = async (startedAt: number) => {
    const elapsed = Date.now() - startedAt;
    const remaining = MIN_LOADING_FEEDBACK_MS - elapsed;
    if (remaining <= 0) return;
    await new Promise(resolve => setTimeout(resolve, remaining));
  };

  const stopPlayback = async (resetProgress = false, options?: { preserveLoading?: boolean }) => {
    clearProgressTimer();
    if (mountedRef.current) {
      if (!options?.preserveLoading) {
        setIsAudioLoading(false);
      }
      setIsSpeaking(false);
      if (resetProgress) {
        setPlaybackProgress(0);
      }
    }
    if (!soundRef.current) return;
    const sound = soundRef.current;
    soundRef.current = null;
    sound.setOnPlaybackStatusUpdate(null);
    await sound.unloadAsync().catch(() => undefined);
  };

  const handlePlaybackStatus = (requestId: number, status: AVPlaybackStatus) => {
    if (requestId !== playbackRequestRef.current) return;
    if (!mountedRef.current) return;

    if (!status.isLoaded) {
      if (status.error) {
        clearProgressTimer();
        setIsAudioLoading(false);
        setIsSpeaking(false);
        setPlaybackProgress(0);
        setPlaybackError(ui.t('app.requestFailed'));
      }
      return;
    }

    if (status.isPlaying) {
      setIsAudioLoading(false);
      setIsSpeaking(true);
    }

    if (typeof status.durationMillis === 'number' && status.durationMillis > 0) {
      setPlaybackProgress(Math.min(status.positionMillis / status.durationMillis, 1));
    }

    if (status.didJustFinish) {
      clearProgressTimer();
      setIsAudioLoading(false);
      setIsSpeaking(false);
      setPlaybackProgress(1);
      setShowQuestion(true);
    }
  };

  const startPlayback = async () => {
    const requestId = playbackRequestRef.current + 1;
    playbackRequestRef.current = requestId;
    const loadingStartedAt = Date.now();

    if (mountedRef.current) {
      setPlaybackError('');
      setShowQuestion(false);
      setPlaybackProgress(0);
      setIsAudioLoading(true);
      setIsSpeaking(false);
    }

    await stopPlayback(true, { preserveLoading: true });
    if (requestId !== playbackRequestRef.current) return;

    const sound = new Audio.Sound();
    soundRef.current = sound;
    sound.setOnPlaybackStatusUpdate(status => handlePlaybackStatus(requestId, status));

    try {
      await sound.loadAsync(currentStaircase.audio, {
        shouldPlay: false,
        isLooping: false,
        progressUpdateIntervalMillis: 120,
        volume: 1,
      });

      if (requestId !== playbackRequestRef.current) {
        sound.setOnPlaybackStatusUpdate(null);
        if (soundRef.current === sound) {
          soundRef.current = null;
        }
        await sound.unloadAsync().catch(() => undefined);
        return;
      }

      await waitForMinimumLoadingFeedback(loadingStartedAt);

      if (requestId !== playbackRequestRef.current) {
        sound.setOnPlaybackStatusUpdate(null);
        if (soundRef.current === sound) {
          soundRef.current = null;
        }
        await sound.unloadAsync().catch(() => undefined);
        return;
      }

      await sound.playAsync();
    } catch {
      if (soundRef.current === sound) {
        soundRef.current = null;
      }
      sound.setOnPlaybackStatusUpdate(null);
      await sound.unloadAsync().catch(() => undefined);
      clearProgressTimer();
      if (mountedRef.current) {
        setIsAudioLoading(false);
        setIsSpeaking(false);
        setPlaybackProgress(0);
        setPlaybackError(ui.t('app.requestFailed'));
      }
    }
  };

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

  const finishLevel = (level: Level) => {
    void stopPlayback(true);
    setSelectedLevel(level);
    setManualLevelFallback(false);
    setStep(3);
  };

  const renderLanguageStep = () => (
    <ScrollView
      style={styles.languageScroll}
      contentContainerStyle={[
        styles.languageScrollContent,
        { maxWidth: metrics.contentMaxWidth, alignSelf: 'center', width: '100%' },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.topBlock, styles.languageTopBlock]}>
        <StepDots count={3} active={1} accent={colors.accentFeed} />
        <Text style={styles.title}>{ui.t('onboarding.nativeLanguageTitle')}</Text>
        <Text style={styles.subtitle}>{ui.t('onboarding.languagePageSubtitle')}</Text>
      </View>

      <LanguageSelectionList
        selectedLanguage={selectedNativeLanguage}
        onSelect={language => {
          triggerUiFeedback('onboarding');
          setSelectedNativeLanguage(language);
          setStep(2);
        }}
      />

      <Text style={[styles.hint, styles.languageHint]}>{ui.t('onboarding.languagePageHint')}</Text>
    </ScrollView>
  );

  const renderManualLevelFallback = () => (
    <>
      <View style={styles.topBlock}>
        <StepDots count={3} active={2} accent={colors.accentFeed} />
        <Text style={styles.title}>{ui.t('onboarding.manualTitle')}</Text>
        <Text style={styles.subtitle}>{ui.t('onboarding.manualSubtitle')}</Text>
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
                  <Text style={styles.levelCopy}>{levelCopy[level]}</Text>
                  <View style={[styles.levelBadge, selected && styles.levelBadgeActive]}>
                    <Text style={[styles.levelBadgeText, selected && styles.levelBadgeTextActive]}>{level}</Text>
                  </View>
                </View>
              </GlassCard>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.hint}>{ui.t('onboarding.manualHint')}</Text>
      <ActionButton
        label={ui.t('common.continue')}
        disabled={!canContinue}
        onPress={() => {
          if (!selectedLevel) return;
          triggerUiFeedback('onboarding');
          setStep(3);
        }}
        style={styles.primaryAction}
      />
    </>
  );

  const renderStaircase = () => (
    <>
      <View style={styles.topBlock}>
        <StepDots count={3} active={2} accent={colors.accentFeed} />
        <Text style={styles.title}>{ui.t('onboarding.staircaseTitle')}</Text>
        <Text style={styles.subtitle}>{ui.t('onboarding.staircaseSubtitle')}</Text>
      </View>

      <View style={styles.staircaseWrap}>
        <View style={styles.staircaseRow}>
          {STAIRCASE.map((item, index) => {
            const isActive = index === staircaseIndex;
            const isDone = index < staircaseIndex;
            return (
              <View
                key={item.labelKey}
                style={[
                  styles.stairBar,
                  isDone && styles.stairBarDone,
                  isActive && styles.stairBarActive,
                ]}
              />
            );
          })}
        </View>

        <View style={styles.stageBadge}>
          <Text style={styles.stageBadgeText}>{ui.t(currentStaircase.labelKey)}</Text>
        </View>

        <GlassCard style={styles.audioCard}>
          <Text style={styles.audioCardEyebrow}>{ui.t('onboarding.audioEyebrow')}</Text>
          <Text style={styles.audioCardTitle}>{ui.t(currentStaircase.titleKey)}</Text>

          <Pressable
            onPress={() => {
              triggerUiFeedback('primary');
              if (isAudioLoading) {
                return;
              }
              if (isSpeaking) {
                void stopPlayback(true);
                return;
              }
              void startPlayback();
            }}
            style={[
              styles.playButton,
              isAudioLoading && styles.playButtonLoading,
              isSpeaking && styles.playButtonActive,
            ]}
          >
            <View style={styles.playButtonContent}>
              {isAudioLoading ? (
                <ActivityIndicator
                  color={colors.textOnAccent}
                  size="small"
                  style={styles.playButtonSpinner}
                />
              ) : null}
              <Text
                style={[
                  styles.playButtonText,
                  isSpeaking && styles.playButtonTextActive,
                ]}
              >
                {isAudioLoading ? ui.t('onboarding.loadingAudio') : isSpeaking ? ui.t('onboarding.stopAudio') : ui.t('onboarding.playAudio')}
              </Text>
            </View>
          </Pressable>

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.max(0, playbackProgress) * 100}%` }]} />
          </View>

          <Text style={styles.progressHint}>
            {isAudioLoading
              ? ui.t('onboarding.preparingAudio')
              : showQuestion
                ? ui.t('onboarding.gistQuestionHint')
                : ui.t('onboarding.answerAfterPlayback')}
          </Text>
        </GlassCard>

        {playbackError ? <Text style={styles.errorText}>{playbackError}</Text> : null}

        {!manualLevelFallback && playbackError ? (
          <Pressable
            onPress={() => {
              triggerUiFeedback('menu');
              void stopPlayback(true);
              setManualLevelFallback(true);
            }}
            style={styles.fallbackLink}
          >
            <Text style={styles.fallbackLinkText}>{ui.t('onboarding.fallbackManual')}</Text>
          </Pressable>
        ) : null}

        {showQuestion ? (
          <View style={styles.askRow}>
            <Text style={styles.askLabel}>{ui.t('onboarding.askLabel')}</Text>
            <View style={styles.askButtons}>
              <Pressable
                onPress={() => {
                  triggerUiFeedback('card');
                  if (staircaseIndex >= STAIRCASE.length - 1) {
                    finishLevel(FINAL_YES_LEVEL);
                    return;
                  }
                  setStaircaseIndex(prev => prev + 1);
                }}
                style={[styles.askButton, styles.askButtonPrimary]}
              >
                <Text style={[styles.askButtonText, styles.askButtonTextPrimary]}>{ui.t('onboarding.understood')}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  triggerUiFeedback('card');
                  finishLevel(currentStaircase.resultIfNo);
                }}
                style={styles.askButton}
              >
                <Text style={styles.askButtonText}>{ui.t('onboarding.didntUnderstand')}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Text style={styles.hint}>{ui.t('onboarding.staircaseHint')}</Text>
        )}
      </View>
    </>
  );

  return (
    <ScreenSurface>
      <View
        style={[
          styles.container,
          {
            paddingHorizontal: metrics.pageHorizontalPadding,
            width: '100%',
            maxWidth: metrics.contentMaxWidth,
            alignSelf: 'center',
          },
        ]}
      >
        {step === 1 ? renderLanguageStep() : null}

        {step === 2 ? (manualLevelFallback ? renderManualLevelFallback() : renderStaircase()) : null}

        {step === 3 ? (
          <>
            <View style={styles.topBlock}>
              <StepDots count={3} active={3} accent={colors.accentFeed} />
              <Text style={styles.title}>{ui.t('onboarding.interestsTitle')}</Text>
              <Text style={styles.subtitle}>{ui.t('onboarding.interestsSubtitle')}</Text>
              {selectedLevel ? (
                <View style={styles.detectedLevelBadge}>
                  <Text style={styles.detectedLevelBadgeText}>{ui.t('onboarding.currentEstimate', { level: selectedLevel })}</Text>
                </View>
              ) : null}
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
                    <Text style={[styles.tagText, active && styles.tagTextActive]}>{interestLabels[tag]}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.hint}>{ui.t('onboarding.interestsHint', { count: selectedTags.length })}</Text>

            <ActionButton
              label={ui.t('common.startExploring')}
              disabled={!canStart}
              onPress={() => {
                if (!selectedLevel || selectedTags.length !== 3) return;
                triggerUiFeedback('onboarding');
                setStep(4);
              }}
              style={styles.primaryAction}
            />
          </>
        ) : null}

        {step === 4 ? (
          <View style={styles.loadingBlock}>
            <Text style={styles.loadingCopy}>{ui.t('onboarding.preparingFeed')}</Text>
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

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
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
    languageScroll: {
      flex: 1,
      width: '100%',
    },
    languageScrollContent: {
      flexGrow: 1,
      paddingBottom: spacing.xl,
    },
    languageTopBlock: {
      marginBottom: spacing.xl,
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
    languageHint: {
      marginTop: spacing.lg,
    },
    staircaseWrap: {
      flex: 1,
      alignItems: 'center',
    },
    staircaseRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.xl,
    },
    stairBar: {
      width: 42,
      height: 5,
      borderRadius: radii.pill,
      backgroundColor: colors.textFaint,
    },
    stairBarDone: {
      backgroundColor: `${colors.accentFeed}80`,
    },
    stairBarActive: {
      backgroundColor: colors.accentFeed,
    },
    stageBadge: {
      borderRadius: radii.pill,
      paddingHorizontal: 14,
      paddingVertical: 6,
      backgroundColor: `${colors.accentFeed}1f`,
      marginBottom: spacing.lg,
    },
    stageBadgeText: {
      color: colors.accentFeed,
      fontSize: typography.caption,
      fontWeight: '700',
    },
    audioCard: {
      width: '100%',
      paddingVertical: spacing.xxxl,
      paddingHorizontal: spacing.xxl,
      alignItems: 'center',
      gap: spacing.lg,
      backgroundColor: 'transparent',
    },
    audioCardEyebrow: {
      color: colors.textTertiary,
      fontSize: typography.micro,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    audioCardTitle: {
      color: colors.textPrimary,
      fontSize: typography.bodyLg,
      fontWeight: '700',
      textAlign: 'center',
    },
    playButton: {
      minWidth: 96,
      height: 96,
      borderRadius: radii.pill,
      backgroundColor: colors.accentFeed,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: colors.accentFeed,
      shadowOpacity: 0.3,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: 4,
    },
    playButtonContent: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    playButtonActive: {
      backgroundColor: colors.bgSurface3,
      borderWidth: 1,
      borderColor: colors.strokeStrong,
    },
    playButtonLoading: {
      backgroundColor: colors.accentFeed,
      shadowOpacity: 0.42,
      transform: [{ scale: 1.03 }],
    },
    playButtonSpinner: {
      marginBottom: 2,
    },
    playButtonText: {
      color: colors.textOnAccent,
      fontSize: typography.body,
      fontWeight: '700',
    },
    playButtonTextActive: {
      color: colors.textPrimary,
    },
    progressTrack: {
      width: '100%',
      height: 8,
      borderRadius: radii.pill,
      backgroundColor: colors.progressBg,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      borderRadius: radii.pill,
      backgroundColor: colors.progressFill,
    },
    progressHint: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      lineHeight: 18,
      textAlign: 'center',
    },
    askRow: {
      width: '100%',
      marginTop: spacing.xxl,
      gap: spacing.md,
      alignItems: 'center',
    },
    askLabel: {
      color: colors.textPrimary,
      fontSize: typography.bodyLg,
      fontWeight: '600',
      textAlign: 'center',
    },
    askButtons: {
      width: '100%',
      flexDirection: 'row',
      gap: spacing.md,
    },
    askButton: {
      flex: 1,
      minHeight: 52,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.strokeStrong,
      backgroundColor: colors.bgSurface1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
    },
    askButtonPrimary: {
      backgroundColor: `${colors.accentFeed}22`,
      borderColor: colors.accentFeed,
    },
    askButtonText: {
      color: colors.textPrimary,
      fontSize: typography.body,
      fontWeight: '700',
    },
    askButtonTextPrimary: {
      color: colors.accentFeed,
    },
    detectedLevelBadge: {
      borderRadius: radii.pill,
      paddingHorizontal: 14,
      paddingVertical: 7,
      backgroundColor: `${colors.accentFeed}18`,
      borderWidth: 1,
      borderColor: `${colors.accentFeed}40`,
    },
    detectedLevelBadgeText: {
      color: colors.accentFeed,
      fontSize: typography.caption,
      fontWeight: '700',
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
      backgroundColor: `${colors.accentFeed}24`,
      borderColor: `${colors.accentFeed}47`,
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
    errorText: {
      marginTop: spacing.lg,
      color: colors.accentOrange,
      fontSize: typography.caption,
      lineHeight: 18,
      textAlign: 'center',
    },
    fallbackLink: {
      marginTop: spacing.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    fallbackLinkText: {
      color: colors.accentFeed,
      fontSize: typography.caption,
      fontWeight: '700',
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
}
