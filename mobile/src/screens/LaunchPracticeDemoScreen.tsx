import { Audio, type AVPlaybackStatus } from 'expo-av';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ActionButton, GlassCard, ScreenSurface } from '../components/AppChrome';
import { radii, spacing, typography } from '../design';
import { triggerUiFeedback } from '../feedback';
import { useUiI18n } from '../i18n';
import { useResponsiveLayout } from '../responsive';
import { api } from '../services/api';
import { useAppTheme } from '../theme';

type Props = {
  onComplete: () => void;
};

type DemoSegment = {
  key: string;
  autoAdvanceMs?: number;
  requiresChoice?: boolean;
};

const SEGMENTS: DemoSegment[] = [
  { key: 'launchDemo.segmentIntro', autoAdvanceMs: 1600 },
  { key: 'launchDemo.segmentPriming', autoAdvanceMs: 2200 },
  { key: 'launchDemo.segmentFlow', requiresChoice: true },
  { key: 'launchDemo.segmentWords', autoAdvanceMs: 2400 },
  { key: 'launchDemo.segmentStart', autoAdvanceMs: 1600 },
];

type NarrationToken = {
  text: string;
  speakIndex: number | null;
};

type PreloadedNarration = {
  segmentIndex: number;
  sound: Audio.Sound;
};

function getNarrationTokens(text: string): NarrationToken[] {
  const parts = text.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?|[\u4e00-\u9fff]|[^\sA-Za-z0-9\u4e00-\u9fff]+|\s+/gu) || [text];
  let speakIndex = -1;
  return parts.map(part => {
    const shouldSpeak = /[A-Za-z0-9\u4e00-\u9fff]/u.test(part);
    if (!shouldSpeak) {
      return { text: part, speakIndex: null };
    }
    speakIndex += 1;
    return { text: part, speakIndex };
  });
}

function AgentWave() {
  const { colors } = useAppTheme();
  return (
    <View style={stylesStatic.wave}>
      {[18, 34, 52, 34, 18].map((height, index) => (
        <View
          key={`wave-${index}`}
          style={[
            stylesStatic.waveBar,
            {
              height,
              backgroundColor: index === 2 ? colors.accentPractice : `${colors.accentPractice}AA`,
            },
          ]}
        />
      ))}
    </View>
  );
}

export function LaunchPracticeDemoScreen({ onComplete }: Props) {
  const { colors } = useAppTheme();
  const { nativeLanguage, t } = useUiI18n();
  const metrics = useResponsiveLayout();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const onCompleteRef = useRef(onComplete);
  const mountedRef = useRef(true);
  const soundRef = useRef<Audio.Sound | null>(null);
  const preloadedNarrationRef = useRef<PreloadedNarration | null>(null);
  const playbackRequestRef = useRef(0);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [activeSpeakIndex, setActiveSpeakIndex] = useState(-1);
  const [segmentReadyForChoice, setSegmentReadyForChoice] = useState(false);
  const [pendingChoice, setPendingChoice] = useState<'primary' | 'repeat' | null>(null);
  const segment = SEGMENTS[segmentIndex];
  const segmentText = segment ? t(segment.key) : '';
  const narrationTokens = useMemo(() => getNarrationTokens(segmentText), [segmentText]);
  const spokenTokenCount = useMemo(
    () => narrationTokens.reduce((count, token) => token.speakIndex === null ? count : count + 1, 0),
    [narrationTokens]
  );

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      playbackRequestRef.current += 1;
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      if (soundRef.current) {
        const sound = soundRef.current;
        soundRef.current = null;
        sound.setOnPlaybackStatusUpdate(null);
        void sound.unloadAsync().catch(() => undefined);
      }
      if (preloadedNarrationRef.current) {
        const { sound } = preloadedNarrationRef.current;
        preloadedNarrationRef.current = null;
        sound.setOnPlaybackStatusUpdate(null);
        void sound.unloadAsync().catch(() => undefined);
      }
    };
  }, []);

  const prepareAndSetSegment = async (nextSegmentIndex: number) => {
    const requestId = playbackRequestRef.current + 1;
    playbackRequestRef.current = requestId;
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }

    if (nextSegmentIndex >= SEGMENTS.length) {
      onCompleteRef.current();
      return;
    }

    const nextSegment = SEGMENTS[nextSegmentIndex];
    try {
      const nextSound = new Audio.Sound();
      await nextSound.loadAsync(
        { uri: api.buildPracticeTtsUrl(t(nextSegment.key), nativeLanguage) },
        {
          shouldPlay: false,
          progressUpdateIntervalMillis: 80,
        }
      );
      if (!mountedRef.current || requestId !== playbackRequestRef.current) {
        nextSound.setOnPlaybackStatusUpdate(null);
        await nextSound.unloadAsync().catch(() => undefined);
        return;
      }
      if (preloadedNarrationRef.current) {
        const { sound } = preloadedNarrationRef.current;
        preloadedNarrationRef.current = null;
        sound.setOnPlaybackStatusUpdate(null);
        void sound.unloadAsync().catch(() => undefined);
      }
      preloadedNarrationRef.current = { segmentIndex: nextSegmentIndex, sound: nextSound };
    } catch {
    }

    if (mountedRef.current && requestId === playbackRequestRef.current) {
      setSegmentIndex(nextSegmentIndex);
    }
    if (mountedRef.current && requestId === playbackRequestRef.current) {
      setPendingChoice(null);
    }
  };

  useEffect(() => {
    const requestId = playbackRequestRef.current + 1;
    playbackRequestRef.current = requestId;
    setActiveSpeakIndex(-1);
    setSegmentReadyForChoice(false);
    setPendingChoice(null);
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    const preloadedNarration = preloadedNarrationRef.current?.segmentIndex === segmentIndex
      ? preloadedNarrationRef.current
      : null;
    if (preloadedNarration) {
      preloadedNarrationRef.current = null;
    } else if (preloadedNarrationRef.current) {
      const { sound } = preloadedNarrationRef.current;
      preloadedNarrationRef.current = null;
      sound.setOnPlaybackStatusUpdate(null);
      void sound.unloadAsync().catch(() => undefined);
    }
    if (soundRef.current) {
      const sound = soundRef.current;
      soundRef.current = null;
      sound.setOnPlaybackStatusUpdate(null);
      void sound.unloadAsync().catch(() => undefined);
    }

    if (!segment) {
      onCompleteRef.current();
      return;
    }

    let completed = false;
    const completeSegment = () => {
      if (completed) return;
      completed = true;
      if (!mountedRef.current || requestId !== playbackRequestRef.current) return;
      setActiveSpeakIndex(Math.max(0, spokenTokenCount - 1));
      if (segment.requiresChoice) {
        setSegmentReadyForChoice(true);
        return;
      }
      void prepareAndSetSegment(segmentIndex + 1);
    };

    const scheduleFallback = () => {
      if (fallbackTimerRef.current || completed) return;
      if (!segment.autoAdvanceMs && !segment.requiresChoice) return;
      fallbackTimerRef.current = setTimeout(completeSegment, segment.autoAdvanceMs || 1800);
    };

    const startNarration = async () => {
      const sound = preloadedNarration?.sound || new Audio.Sound();
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
        if (!mountedRef.current || requestId !== playbackRequestRef.current) return;
        if (!status.isLoaded) {
          if (status.error) {
            scheduleFallback();
          }
          return;
        }
        if (typeof status.durationMillis === 'number' && status.durationMillis > 0) {
          const progress = Math.min(status.positionMillis / status.durationMillis, 1);
          setActiveSpeakIndex(Math.min(
            Math.max(0, spokenTokenCount - 1),
            Math.floor(progress * spokenTokenCount)
          ));
        }
        if (status.didJustFinish) {
          completeSegment();
        }
      });

      try {
        if (!preloadedNarration) {
          await sound.loadAsync(
            { uri: api.buildPracticeTtsUrl(segmentText, nativeLanguage) },
            {
              shouldPlay: false,
              progressUpdateIntervalMillis: 80,
            }
          );
        }
        if (!mountedRef.current || requestId !== playbackRequestRef.current) {
          sound.setOnPlaybackStatusUpdate(null);
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
        scheduleFallback();
      }
    };

    void startNarration();

    return () => {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    };
  }, [segment, segmentText, spokenTokenCount]);

  return (
    <ScreenSurface edges={['top', 'left', 'right', 'bottom']} style={styles.surface}>
      <View
        style={[
          styles.content,
          {
            paddingHorizontal: metrics.pageHorizontalPadding,
            maxWidth: metrics.contentMaxWidth,
          },
        ]}
      >
        <View style={styles.progressDots}>
          {SEGMENTS.map((item, index) => (
            <View
              key={item.key}
              style={[
                styles.progressDot,
                index < segmentIndex && styles.progressDotDone,
                index === segmentIndex && styles.progressDotActive,
              ]}
            />
          ))}
        </View>

        <View style={styles.agentWrap}>
          <AgentWave />
          <GlassCard tone="practice" style={styles.bubble}>
            {segment ? (
              <Text style={styles.segmentText}>
                {narrationTokens.map((token, index) => (
                  <Text
                    key={`${segment.key}-${index}`}
                    style={[
                      token.speakIndex !== null && token.speakIndex < activeSpeakIndex && styles.segmentTextSpoken,
                      token.speakIndex !== null && token.speakIndex === activeSpeakIndex && styles.segmentTextActive,
                    ]}
                  >
                    {token.text}
                  </Text>
                ))}
              </Text>
            ) : null}
          </GlassCard>
        </View>

        {segment?.requiresChoice && segmentReadyForChoice ? (
          <View style={styles.choiceRow}>
            <ActionButton
              disabled={Boolean(pendingChoice)}
              label={pendingChoice === 'primary' ? t('launchDemo.preparing') : t('launchDemo.gotIt')}
              onPress={() => {
                triggerUiFeedback('primary');
                setPendingChoice('primary');
                void prepareAndSetSegment(segmentIndex + 1);
              }}
              style={styles.choiceButton}
            />
            <ActionButton
              disabled={Boolean(pendingChoice)}
              label={pendingChoice === 'repeat' ? t('launchDemo.preparing') : t('launchDemo.repeat')}
              variant="secondary"
              onPress={() => {
                triggerUiFeedback('menu');
                setPendingChoice('repeat');
                void prepareAndSetSegment(0);
              }}
              style={styles.choiceButton}
            />
            {pendingChoice ? (
              <View style={styles.choiceLoading} pointerEvents="none">
                <ActivityIndicator size="small" color={colors.accentPractice} />
              </View>
            ) : null}
          </View>
        ) : segment && !segment.requiresChoice ? (
          <Pressable
            hitSlop={8}
            onPress={() => {
              triggerUiFeedback('menu');
              onCompleteRef.current();
            }}
            style={styles.skipButton}
          >
            <Text style={styles.skipText}>{t('launchDemo.skip')}</Text>
          </Pressable>
        ) : null}
      </View>
    </ScreenSurface>
  );
}

const stylesStatic = StyleSheet.create({
  wave: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  waveBar: {
    width: 9,
    borderRadius: 999,
  },
});

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    surface: {
      backgroundColor: colors.bgApp,
    },
    content: {
      flex: 1,
      width: '100%',
      alignSelf: 'center',
      justifyContent: 'center',
      gap: spacing.xl,
      paddingVertical: spacing.xxl,
    },
    progressDots: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 8,
    },
    progressDot: {
      width: 8,
      height: 8,
      borderRadius: 999,
      backgroundColor: colors.bgSurface2,
    },
    progressDotDone: {
      backgroundColor: `${colors.accentPractice}88`,
    },
    progressDotActive: {
      width: 18,
      backgroundColor: colors.accentPractice,
    },
    agentWrap: {
      alignItems: 'center',
      gap: spacing.xl,
    },
    bubble: {
      width: '100%',
      gap: spacing.md,
      borderRadius: radii.xl,
      paddingVertical: spacing.xl,
    },
    segmentText: {
      color: colors.textSecondary,
      fontSize: 24,
      lineHeight: 34,
      fontWeight: '700',
      textAlign: 'center',
    },
    segmentTextSpoken: {
      color: colors.textPrimary,
    },
    segmentTextActive: {
      color: colors.accentPractice,
    },
    choiceRow: {
      flexDirection: 'row',
      gap: spacing.md,
      position: 'relative',
    },
    choiceButton: {
      flex: 1,
    },
    choiceLoading: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: -34,
      alignItems: 'center',
    },
    skipButton: {
      alignSelf: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    skipText: {
      color: colors.textTertiary,
      fontSize: typography.caption,
      fontWeight: '700',
    },
  });
}
