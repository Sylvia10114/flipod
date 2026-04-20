import * as FileSystem from 'expo-file-system';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../services/api';
import { ActionButton, GlassCard, StepDots } from './AppChrome';
import { ChallengeWordPills } from './ChallengeWordPills';
import { ProgressBar } from './ProgressBar';
import { WordLine } from './WordLine';
import { WordPopup } from './WordPopup';
import { radii, spacing, typography } from '../design';
import { triggerUiFeedback } from '../feedback';
import { useUiI18n } from '../i18n';
import { useResponsiveLayout } from '../responsive';
import { useAppTheme } from '../theme';
import type {
  ChallengeWord,
  ClipLine,
  ClipLineWord,
  GeneratedPractice,
  NativeLanguage,
  PracticeRecord,
  VocabEntry,
} from '../types';

type Step = 1 | 2 | 3 | 4;

type PopupState = {
  word: ClipLineWord;
  contextEn: string;
  contextZh: string;
  lineIndex: number;
} | null;

type Props = {
  visible: boolean;
  practice: GeneratedPractice | null;
  nativeLanguage: NativeLanguage;
  vocabWords: string[];
  knownWords: string[];
  onSaveVocab: (entry: VocabEntry) => void;
  onMarkKnown: (word: string) => void;
  onRecordWordLookup: (cefr?: string, details?: { word?: string }) => void;
  onComplete: (practiceId: string, record: PracticeRecord, practice: GeneratedPractice) => void;
  onDismiss: () => void;
  onReturnFeed: () => void;
  onPracticeAgain: () => void;
};

function normalizeToken(value: string) {
  return String(value || '').replace(/^[^a-zA-Z]+|[^a-zA-Z'-]+$/g, '').toLowerCase();
}

function hashAudioKey(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `gp_${(hash >>> 0).toString(16)}`;
}

function distributeWordTimings(
  line: GeneratedPractice['lines'][number],
  cefrMap: Map<string, string>,
  targetWords: Set<string>
): ClipLine {
  const tokens = (line.en.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g) || []).filter(Boolean);
  const duration = Math.max(0.6, line.end - line.start || tokens.length * 0.45);
  const perToken = tokens.length > 0 ? duration / tokens.length : duration;
  const words = tokens.map((token, index) => {
    const normalized = normalizeToken(token);
    return {
      word: token,
      start: Number((line.start + (index * perToken)).toFixed(2)),
      end: Number((line.start + ((index + 1) * perToken)).toFixed(2)),
      cefr: cefrMap.get(normalized) || (targetWords.has(normalized) ? 'B2' : undefined),
    };
  });

  return {
    ...line,
    words,
  };
}

function buildChallengeWords(practice: GeneratedPractice): ChallengeWord[] {
  const contextByWord = new Map(
    (practice.target_word_contexts || []).map(item => [item.word.toLowerCase(), item])
  );
  return (practice.target_words || []).slice(0, 3).map((word, index) => {
    const context = contextByWord.get(word.toLowerCase());
    return {
      word,
      cefr: context?.cefr,
      lineIndex: context?.sentence_index ?? index,
    };
  });
}

function buildFadeText(line: ClipLine, targetWords: Set<string>) {
  const parts = (line.en || '').split(/(\s+)/);
  let nonTargetIndex = 0;
  return parts.map((part, index) => {
    if (!part.trim()) {
      return {
        key: `gap-${index}`,
        text: part,
        visible: true,
        emphasis: false,
      };
    }
    const normalized = normalizeToken(part);
    const isTarget = targetWords.has(normalized);
    if (!isTarget) nonTargetIndex += 1;
    const visible = isTarget || nonTargetIndex % 3 !== 0;
    return {
      key: `part-${index}-${normalized || 'p'}`,
      text: part,
      visible,
      emphasis: isTarget,
    };
  });
}

export function GeneratedPracticeSessionModal({
  visible,
  practice,
  nativeLanguage,
  vocabWords,
  knownWords,
  onSaveVocab,
  onMarkKnown,
  onRecordWordLookup,
  onComplete,
  onDismiss,
  onReturnFeed,
  onPracticeAgain,
}: Props) {
  const { colors } = useAppTheme();
  const { t } = useUiI18n();
  const metrics = useResponsiveLayout();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const soundRef = useRef<Audio.Sound | null>(null);
  const cachedAudioRef = useRef<Map<string, string>>(new Map());
  const playbackRequestRef = useRef(0);
  const completionSavedRef = useRef(false);

  const [step, setStep] = useState<Step>(1);
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasPlayedStep1, setHasPlayedStep1] = useState(false);
  const [hasPlayedStep3, setHasPlayedStep3] = useState(false);
  const [hasPlayedStep4, setHasPlayedStep4] = useState(false);
  const [quizSelection, setQuizSelection] = useState<number | null>(null);
  const [quizAnswered, setQuizAnswered] = useState(false);
  const [popup, setPopup] = useState<PopupState>(null);
  const [lookedWords, setLookedWords] = useState<string[]>([]);
  const [hardSentences, setHardSentences] = useState<number[]>([]);

  const challengeWords = useMemo(() => (practice ? buildChallengeWords(practice) : []), [practice]);

  const enrichedLines = useMemo(() => {
    if (!practice) return [];
    const cefrMap = new Map<string, string>();
    (practice.target_word_contexts || []).forEach(item => {
      cefrMap.set(item.word.toLowerCase(), item.cefr || '');
    });
    (practice.vocab_in_text || []).forEach(item => {
      cefrMap.set(item.word.toLowerCase(), item.cefr || '');
    });
    const targetSet = new Set((practice.target_words || []).map(word => word.toLowerCase()));
    return (practice.lines || []).map(line => distributeWordTimings(line, cefrMap, targetSet));
  }, [practice]);

  const currentSentence = enrichedLines[sentenceIndex] || null;
  const transcriptCardHeight = metrics.isTablet ? 320 : 264;
  const canShowQuiz = Boolean(practice?.mcq) && hasPlayedStep4;
  const canShowReview = quizAnswered;

  const unloadSound = useCallback(async () => {
    if (!soundRef.current) return;
    try {
      await soundRef.current.unloadAsync();
    } catch {
    }
    soundRef.current.setOnPlaybackStatusUpdate(null);
    soundRef.current = null;
    setIsPlaying(false);
    setIsLoading(false);
  }, []);

  const prepareAudioUri = useCallback(async (text: string) => {
    const normalized = text.trim();
    if (!normalized) return null;
    const key = hashAudioKey(normalized);
    const cached = cachedAudioRef.current.get(key);
    if (cached) return cached;
    const cacheRoot = FileSystem.cacheDirectory;
    if (!cacheRoot) return api.buildPracticeTtsUrl(normalized);
    const cacheDir = `${cacheRoot}generated-practice-audio/`;
    const localUri = `${cacheDir}${key}.mp3`;

    try {
      await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });
      const existing = await FileSystem.getInfoAsync(localUri);
      if (!existing.exists) {
        await FileSystem.downloadAsync(api.buildPracticeTtsUrl(normalized), localUri);
      }
      cachedAudioRef.current.set(key, localUri);
      return localUri;
    } catch {
      const fallback = api.buildPracticeTtsUrl(normalized);
      cachedAudioRef.current.set(key, fallback);
      return fallback;
    }
  }, []);

  const playText = useCallback(async (
    text: string,
    options: {
      onFinish?: () => void;
      onStart?: () => void;
    } = {}
  ) => {
    const normalized = text.trim();
    if (!normalized) return;
    const requestId = playbackRequestRef.current + 1;
    playbackRequestRef.current = requestId;
    setErrorMessage(null);
    setIsLoading(true);

    const sourceUri = await prepareAudioUri(normalized);
    if (!sourceUri || requestId !== playbackRequestRef.current) {
      setIsLoading(false);
      return;
    }

    await unloadSound();

    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri: sourceUri },
        { shouldPlay: true },
        (status: AVPlaybackStatus) => {
          if (requestId !== playbackRequestRef.current) {
            return;
          }
          if (!status.isLoaded) {
            setIsPlaying(false);
            setIsLoading(false);
            if (status.error) {
              setErrorMessage(t('practiceSession.loadError'));
            }
            return;
          }
          setIsLoading(false);
          setIsPlaying(status.isPlaying);
          if (status.didJustFinish) {
            setIsPlaying(false);
            options.onFinish?.();
          }
        }
      );

      soundRef.current = sound;
      setIsPlaying(true);
      options.onStart?.();
    } catch {
      setIsLoading(false);
      setIsPlaying(false);
      setErrorMessage(t('practiceSession.loadError'));
    }
  }, [prepareAudioUri, t, unloadSound]);

  useEffect(() => {
    if (!visible || !practice) return;
    completionSavedRef.current = false;
    setStep(1);
    setSentenceIndex(0);
    setQuizSelection(null);
    setQuizAnswered(false);
    setHasPlayedStep1(false);
    setHasPlayedStep3(false);
    setHasPlayedStep4(false);
    setPopup(null);
    setLookedWords([]);
    setHardSentences([]);
    setErrorMessage(null);
    setIsLoading(false);
    setIsPlaying(false);
  }, [practice, visible]);

  useEffect(() => {
    if (!visible) {
      void unloadSound();
    }
  }, [unloadSound, visible]);

  useEffect(() => {
    if (!visible || !practice || step !== 2 || !currentSentence) return;
    void playText(currentSentence.en);
  }, [currentSentence, playText, practice, step, visible]);

  const handleDismiss = useCallback(() => {
    playbackRequestRef.current += 1;
    void unloadSound();
    onDismiss();
  }, [onDismiss, unloadSound]);

  const handleWordTap = useCallback((word: ClipLineWord, line: ClipLine, lineIndex: number) => {
    const normalized = word.word.toLowerCase();
    if (!lookedWords.includes(normalized)) {
      setLookedWords(prev => [...prev, normalized]);
    }
    onRecordWordLookup(word.cefr, { word: normalized });
    setPopup({
      word,
      contextEn: line.en,
      contextZh: line.zh,
      lineIndex,
    });
  }, [lookedWords, onRecordWordLookup]);

  const finishPractice = useCallback(() => {
    if (!practice || completionSavedRef.current) return;
    completionSavedRef.current = true;
    onComplete(practice.id, {
      done: true,
      words: lookedWords.length,
      hard: hardSentences.length,
      ts: Date.now(),
    }, practice);
  }, [hardSentences.length, lookedWords.length, onComplete, practice]);

  const handleSentenceFeedback = useCallback((difficulty: 'easy' | 'hard') => {
    if (!practice) return;
    if (difficulty === 'hard') {
      setHardSentences(prev => (prev.includes(sentenceIndex) ? prev : [...prev, sentenceIndex]));
    }
    if (sentenceIndex >= enrichedLines.length - 1) {
      setStep(3);
      return;
    }
    setSentenceIndex(prev => Math.min(prev + 1, enrichedLines.length - 1));
  }, [enrichedLines.length, practice, sentenceIndex]);

  const renderTranscriptCard = useCallback((
    mode: 'translation' | 'sentence' | 'fade' | 'review'
  ) => {
    if (!practice) return null;
    const targetSet = new Set((practice.target_words || []).map(word => word.toLowerCase()));

    return (
      <GlassCard style={[styles.transcriptCard, { height: transcriptCardHeight }]}>
        <ScrollView
          style={styles.transcriptScroll}
          contentContainerStyle={styles.transcriptScrollContent}
          showsVerticalScrollIndicator={false}
        >
          {mode === 'translation'
            ? (practice.lines || []).map((line, index) => (
                <View key={`translation-${index}`} style={styles.translationBlock}>
                  <Text style={styles.translationLine}>{line.zh}</Text>
                  <Text style={styles.translationSubline}>{line.en}</Text>
                </View>
              ))
            : null}

          {mode === 'sentence'
            ? enrichedLines.map((line, index) => (
                <Pressable
                  key={`sentence-${index}`}
                  onPress={() => setSentenceIndex(index)}
                  style={[
                    styles.sentenceBlock,
                    index === sentenceIndex && styles.sentenceBlockActive,
                  ]}
                >
                  <WordLine
                    line={line}
                    currentTime={0}
                    isActive={index === sentenceIndex}
                    showZh
                    subtitleSize="sm"
                    onWordTap={(word, activeLine) => handleWordTap(word, activeLine, index)}
                  />
                </Pressable>
              ))
            : null}

          {mode === 'fade'
            ? enrichedLines.map((line, index) => {
                const fadeTokens = buildFadeText(line, targetSet);
                return (
                  <View key={`fade-${index}`} style={styles.fadeBlock}>
                    <Text style={styles.fadeLine}>
                      {fadeTokens.map(token => (
                        <Text
                          key={token.key}
                          style={[
                            token.emphasis && styles.fadeWordTarget,
                            !token.visible && styles.fadeWordMasked,
                            token.visible && !token.emphasis && styles.fadeWordVisible,
                          ]}
                        >
                          {token.visible ? token.text : '····'}
                        </Text>
                      ))}
                    </Text>
                    <Text style={styles.fadeZh}>{line.zh}</Text>
                  </View>
                );
              })
            : null}

          {mode === 'review'
            ? enrichedLines.map((line, index) => (
                <View key={`review-${index}`} style={styles.reviewBlock}>
                  <WordLine
                    line={line}
                    currentTime={0}
                    isActive={false}
                    showZh
                    practiced={hardSentences.includes(index)}
                    subtitleSize="sm"
                    onWordTap={(word, activeLine) => handleWordTap(word, activeLine, index)}
                  />
                </View>
              ))
            : null}
        </ScrollView>
      </GlassCard>
    );
  }, [enrichedLines, handleWordTap, hardSentences, practice, sentenceIndex, transcriptCardHeight]);

  if (!practice) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleDismiss}
    >
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
        <View
          style={[
            styles.header,
            {
              paddingTop: Math.max(insets.top + 10, 18),
              paddingHorizontal: metrics.pageHorizontalPadding,
            },
          ]}
        >
          <View style={[styles.headerInner, { maxWidth: metrics.contentMaxWidth }]}>
            <Pressable
              onPress={handleDismiss}
              hitSlop={12}
              style={styles.closeButton}
            >
              <Text style={styles.closeButtonText}>×</Text>
            </Pressable>
            <View style={styles.headerCopy}>
              <Text style={styles.headerLabel}>{step === 1
                ? t('practiceSession.stepNativeLanguage')
                : step === 2
                  ? t('practiceSession.stepEnglish')
                  : step === 3
                    ? t('practiceSession.stepFade')
                    : t('practiceSession.stepBlind')}</Text>
              <Text style={styles.headerTitle}>{practice.title}</Text>
            </View>
            <View style={styles.headerSpacer} />
          </View>
        </View>

        <ScrollView
          contentContainerStyle={[
            styles.body,
            {
              paddingHorizontal: metrics.pageHorizontalPadding,
              maxWidth: metrics.contentMaxWidth,
              alignSelf: 'center',
              width: '100%',
            },
          ]}
        >
          <StepDots active={step} count={4} accent={colors.accentPractice} />

          <View style={styles.heroBlock}>
            <Text style={styles.heroTitle}>
              {step === 1
                ? t('practiceSession.previewTitle')
                : step === 2
                  ? t('practiceSession.englishDrillTitle')
                  : step === 3
                    ? t('practiceSession.fadeTitle')
                    : t('practiceSession.blindTitle')}
            </Text>
            <Text style={styles.heroBody}>
              {step === 1
                ? (
                  nativeLanguage === 'english'
                    ? t('practiceSession.previewFallbackBody')
                    : t('practiceSession.previewBody')
                )
                : step === 2
                  ? t('practiceSession.englishDrillBody')
                  : step === 3
                    ? t('practiceSession.fadeBody')
                    : t('practiceSession.blindBody')}
            </Text>
          </View>

          {challengeWords.length > 0 ? (
            <View style={styles.challengeSection}>
              <Text style={styles.challengeTitle}>{t('practiceSession.challengeWordsTitle')}</Text>
              <ChallengeWordPills words={challengeWords} tone="practice" />
            </View>
          ) : null}

          {step === 1 ? renderTranscriptCard('translation') : null}
          {step === 2 ? renderTranscriptCard('sentence') : null}
          {step === 3 ? renderTranscriptCard('fade') : null}

          {step === 2 ? (
            <View style={styles.progressBlock}>
              <Text style={styles.progressLabel}>
                {t('practiceSession.sentenceProgress', {
                  current: sentenceIndex + 1,
                  total: enrichedLines.length,
                })}
              </Text>
              <ProgressBar
                progress={(sentenceIndex + 1) / Math.max(1, enrichedLines.length)}
                onSeek={() => {}}
              />
            </View>
          ) : null}

          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

          {step === 1 ? (
            <View style={styles.actions}>
              <ActionButton
                label={isPlaying ? t('common.pause') : t('common.play')}
                onPress={() => {
                  if (isPlaying) {
                    playbackRequestRef.current += 1;
                    void unloadSound();
                    return;
                  }
                  void playText(practice.text, {
                    onFinish: () => setHasPlayedStep1(true),
                  });
                }}
                variant="primary"
              />
              <ActionButton
                label={t('common.continue')}
                onPress={() => {
                  triggerUiFeedback('primary');
                  setStep(2);
                }}
                variant="secondary"
                disabled={!hasPlayedStep1 && !isLoading}
              />
            </View>
          ) : null}

          {step === 2 && currentSentence ? (
            <View style={styles.actionsColumn}>
              <ActionButton
                label={t('common.replay')}
                onPress={() => {
                  void playText(currentSentence.en);
                }}
                variant="secondary"
              />
              <View style={styles.dualRow}>
                <ActionButton
                  label={t('practiceSession.easy')}
                  onPress={() => handleSentenceFeedback('easy')}
                  variant="secondary"
                  style={styles.dualButton}
                />
                <ActionButton
                  label={t('practiceSession.hard')}
                  onPress={() => handleSentenceFeedback('hard')}
                  variant="primary"
                  style={styles.dualButton}
                />
              </View>
            </View>
          ) : null}

          {step === 3 ? (
            <View style={styles.actions}>
              <ActionButton
                label={isPlaying ? t('common.pause') : t('common.play')}
                onPress={() => {
                  if (isPlaying) {
                    playbackRequestRef.current += 1;
                    void unloadSound();
                    return;
                  }
                  void playText(practice.text, {
                    onFinish: () => setHasPlayedStep3(true),
                  });
                }}
                variant="primary"
              />
              <ActionButton
                label={t('common.continue')}
                onPress={() => setStep(4)}
                variant="secondary"
                disabled={!hasPlayedStep3 && !isLoading}
              />
            </View>
          ) : null}

          {step === 4 ? (
            <View style={styles.actionsColumn}>
              {!hasPlayedStep4 ? (
                <ActionButton
                  label={isPlaying ? t('common.pause') : t('common.play')}
                  onPress={() => {
                    if (isPlaying) {
                      playbackRequestRef.current += 1;
                      void unloadSound();
                      return;
                    }
                    void playText(practice.text, {
                      onFinish: () => setHasPlayedStep4(true),
                    });
                  }}
                  variant="primary"
                />
              ) : null}

              {canShowQuiz && practice.mcq ? (
                <GlassCard style={styles.quizCard}>
                  <Text style={styles.quizLabel}>{t('practiceSession.afterListenQuiz')}</Text>
                  <Text style={styles.quizQuestion}>{practice.mcq.q}</Text>
                  <View style={styles.quizOptions}>
                    {practice.mcq.options.map((option, index) => {
                      const selected = quizSelection === index;
                      const isCorrect = quizAnswered && index === practice.mcq?.correct;
                      const isWrong = quizAnswered && selected && !isCorrect;
                      return (
                        <Pressable
                          key={`mcq-${index}`}
                          disabled={quizAnswered}
                          onPress={() => {
                            if (!practice.mcq || quizAnswered) return;
                            setQuizSelection(index);
                            setQuizAnswered(true);
                          }}
                          style={[
                            styles.quizOption,
                            selected && styles.quizOptionSelected,
                            isCorrect && styles.quizOptionCorrect,
                            isWrong && styles.quizOptionWrong,
                          ]}
                        >
                          <Text style={styles.quizOptionText}>{option}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {quizAnswered ? (
                    <Text style={styles.quizExplanation}>{practice.mcq.explanation}</Text>
                  ) : null}
                </GlassCard>
              ) : null}

              {canShowReview ? (
                <>
                  {renderTranscriptCard('review')}
                  <GlassCard style={styles.reviewSummaryCard}>
                    <Text style={styles.reviewSummaryTitle}>{t('practiceSession.summaryTitle')}</Text>
                    <View style={styles.reviewStats}>
                      <Text style={styles.reviewStatText}>
                        {lookedWords.length} · {t('practiceSession.summaryWords')}
                      </Text>
                      <Text style={styles.reviewStatText}>
                        {hardSentences.length} · {t('practiceSession.summaryHard')}
                      </Text>
                    </View>
                  </GlassCard>
                  <View style={styles.actionsColumn}>
                    <ActionButton
                      label={t('practiceSession.finishPractice')}
                      onPress={() => {
                        finishPractice();
                        handleDismiss();
                      }}
                      variant="primary"
                    />
                    <View style={styles.dualRow}>
                      <ActionButton
                        label={t('practiceSession.practiceAnother')}
                        onPress={() => {
                          finishPractice();
                          onPracticeAgain();
                        }}
                        variant="secondary"
                        style={styles.dualButton}
                      />
                      <ActionButton
                        label={t('practiceSession.backToFeed')}
                        onPress={() => {
                          finishPractice();
                          onReturnFeed();
                        }}
                        variant="secondary"
                        style={styles.dualButton}
                      />
                    </View>
                  </View>
                </>
              ) : null}
            </View>
          ) : null}
        </ScrollView>

        {popup ? (
          <WordPopup
            word={popup.word}
            contextEn={popup.contextEn}
            contextZh={popup.contextZh}
            isSaved={vocabWords.includes(popup.word.word.toLowerCase())}
            isKnown={knownWords.includes(popup.word.word.toLowerCase())}
            onSave={() => {
              onSaveVocab({
                word: popup.word.word.toLowerCase(),
                cefr: popup.word.cefr,
                context: popup.contextEn,
                contextZh: popup.contextZh,
                contentKey: practice.contentKey,
                lineIndex: popup.lineIndex,
                clipTitle: practice.title,
                tag: practice.tag,
                sourceType: 'practice',
                practiced: true,
              });
            }}
            onMarkKnown={() => onMarkKnown(popup.word.word.toLowerCase())}
            onDismiss={() => setPopup(null)}
          />
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.bgApp,
    },
    header: {
      paddingBottom: spacing.sm,
      zIndex: 2,
    },
    headerInner: {
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      alignSelf: 'center',
    },
    closeButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.bgSurface2,
      borderWidth: 1,
      borderColor: colors.strokeStrong,
    },
    closeButtonText: {
      color: colors.textPrimary,
      fontSize: 28,
      lineHeight: 30,
      fontWeight: '500',
    },
    headerCopy: {
      flex: 1,
      alignItems: 'center',
      gap: 4,
    },
    headerLabel: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    headerTitle: {
      color: colors.textPrimary,
      fontSize: typography.title,
      fontWeight: '700',
      textAlign: 'center',
    },
    headerSpacer: {
      width: 44,
      height: 44,
    },
    body: {
      paddingBottom: spacing.xxl,
      gap: spacing.lg,
    },
    heroBlock: {
      gap: spacing.xs,
    },
    heroTitle: {
      color: colors.textPrimary,
      fontSize: typography.hero,
      fontWeight: '800',
      textAlign: 'center',
    },
    heroBody: {
      color: colors.textSecondary,
      fontSize: typography.body,
      lineHeight: 22,
      textAlign: 'center',
    },
    challengeSection: {
      gap: spacing.sm,
    },
    challengeTitle: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    transcriptCard: {
      padding: 0,
      overflow: 'hidden',
    },
    transcriptScroll: {
      flex: 1,
    },
    transcriptScrollContent: {
      padding: spacing.lg,
      gap: spacing.md,
    },
    translationBlock: {
      gap: spacing.xs,
    },
    translationLine: {
      color: colors.textPrimary,
      fontSize: typography.body,
      lineHeight: 22,
    },
    translationSubline: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      lineHeight: 18,
    },
    sentenceBlock: {
      padding: spacing.md,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.stroke,
      backgroundColor: colors.bgSurface2,
    },
    sentenceBlockActive: {
      borderColor: colors.accentPractice,
      backgroundColor: colors.bgOverlay,
    },
    fadeBlock: {
      gap: spacing.xs,
    },
    fadeLine: {
      color: colors.textPrimary,
      fontSize: typography.body,
      lineHeight: 24,
    },
    fadeWordVisible: {
      color: colors.textPrimary,
    },
    fadeWordTarget: {
      color: colors.accentPractice,
      fontWeight: '700',
    },
    fadeWordMasked: {
      color: colors.textTertiary,
    },
    fadeZh: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      lineHeight: 18,
    },
    reviewBlock: {
      paddingBottom: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.stroke,
    },
    progressBlock: {
      gap: spacing.sm,
    },
    progressLabel: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      fontWeight: '700',
      textAlign: 'center',
    },
    errorText: {
      color: colors.accentError,
      fontSize: typography.caption,
      textAlign: 'center',
    },
    actions: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    actionsColumn: {
      gap: spacing.md,
    },
    dualRow: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    dualButton: {
      flex: 1,
    },
    quizCard: {
      gap: spacing.md,
    },
    quizLabel: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    quizQuestion: {
      color: colors.textPrimary,
      fontSize: typography.body,
      lineHeight: 22,
      fontWeight: '600',
    },
    quizOptions: {
      gap: spacing.sm,
    },
    quizOption: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.stroke,
      backgroundColor: colors.bgSurface2,
    },
    quizOptionSelected: {
      borderColor: colors.accentPractice,
    },
    quizOptionCorrect: {
      borderColor: colors.accentSuccess,
      backgroundColor: colors.bgOverlay,
    },
    quizOptionWrong: {
      borderColor: colors.accentError,
      backgroundColor: colors.bgOverlay,
    },
    quizOptionText: {
      color: colors.textPrimary,
      fontSize: typography.body,
      lineHeight: 22,
    },
    quizExplanation: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      lineHeight: 18,
    },
    reviewSummaryCard: {
      gap: spacing.sm,
    },
    reviewSummaryTitle: {
      color: colors.textPrimary,
      fontSize: typography.title,
      fontWeight: '700',
    },
    reviewStats: {
      gap: spacing.xs,
    },
    reviewStatText: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      lineHeight: 18,
    },
  });
}
