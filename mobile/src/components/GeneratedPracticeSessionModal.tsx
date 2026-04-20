import * as FileSystem from 'expo-file-system';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../services/api';
import { ActionButton, GlassCard, StatBlock } from './AppChrome';
import { ChallengeWordPills } from './ChallengeWordPills';
import { PracticeCardHeader } from './generated-practice/PracticeCardHeader';
import { PracticeInlineWordInspector } from './generated-practice/PracticeInlineWordInspector';
import { PracticeStudioShell } from './generated-practice/PracticeStudioShell';
import { PracticeTranscriptPanel } from './generated-practice/PracticeTranscriptPanel';
import { WordLine } from './WordLine';
import { radii, spacing, typography } from '../design';
import { triggerUiFeedback } from '../feedback';
import { useUiI18n } from '../i18n';
import { getLocalizedTopicLabel } from '../i18n/helpers';
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

function shiftLineToZero(line: ClipLine): ClipLine {
  return {
    ...line,
    start: 0,
    end: Math.max(0.01, line.end - line.start),
    words: (line.words || []).map(word => ({
      ...word,
      start: Math.max(0, word.start - line.start),
      end: Math.max(0.01, word.end - line.start),
    })),
  };
}

function stepLabel(step: Step, t: (key: string, params?: Record<string, string | number>) => string) {
  if (step === 1) return t('practiceSession.stepNativeLanguage');
  if (step === 2) return t('practiceSession.stepEnglish');
  if (step === 3) return t('practiceSession.stepFade');
  return t('practiceSession.stepBlind');
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
  const styles = useMemo(() => createStyles(colors), [colors]);

  const soundRef = useRef<Audio.Sound | null>(null);
  const cachedAudioRef = useRef<Map<string, string>>(new Map());
  const playbackRequestRef = useRef(0);
  const completionSavedRef = useRef(false);
  const activeTrackKeyRef = useRef('');
  const positionMillisRef = useRef(0);
  const durationMillisRef = useRef(0);
  const step2AutoplayKeyRef = useRef('');
  const blindPulse = useRef(new Animated.Value(0)).current;

  const [step, setStep] = useState<Step>(1);
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [positionMillis, setPositionMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState(0);
  const [hasPlayedStep1, setHasPlayedStep1] = useState(false);
  const [hasPlayedStep2, setHasPlayedStep2] = useState(false);
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
  const fadeTargetWords = useMemo(
    () => new Set((practice?.target_words || []).map(word => word.toLowerCase())),
    [practice?.target_words]
  );
  const isReviewReady = step === 4 && hasPlayedStep4 && (!practice?.mcq || quizAnswered);
  const playbackSeconds = positionMillis / 1000;
  const transcriptStartSeconds = enrichedLines[0]?.start || 0;
  const transcriptEndSeconds = enrichedLines[enrichedLines.length - 1]?.end || transcriptStartSeconds;
  const transcriptDurationSeconds = Math.max(0, transcriptEndSeconds - transcriptStartSeconds);
  const alignedPlaybackSeconds = useMemo(() => {
    if (playbackSeconds <= 0) return 0;
    if (durationMillis <= 0 || transcriptDurationSeconds <= 0) return playbackSeconds;
    const audioDurationSeconds = durationMillis / 1000;
    if (audioDurationSeconds <= 0) return playbackSeconds;
    const progress = Math.max(0, Math.min(1, playbackSeconds / audioDurationSeconds));
    return transcriptStartSeconds + (progress * transcriptDurationSeconds);
  }, [durationMillis, playbackSeconds, transcriptDurationSeconds, transcriptStartSeconds]);
  const activePlaybackLineIndex = useMemo(() => {
    if (!enrichedLines.length || alignedPlaybackSeconds <= 0) return -1;
    const index = enrichedLines.findIndex(
      line => alignedPlaybackSeconds >= line.start && alignedPlaybackSeconds < line.end
    );
    if (index >= 0) return index;
    if (alignedPlaybackSeconds >= enrichedLines[enrichedLines.length - 1].end) return enrichedLines.length - 1;
    return -1;
  }, [alignedPlaybackSeconds, enrichedLines]);

  const selectedWordKey = popup ? normalizeToken(popup.word.word) : '';
  const selectedWordSaved = selectedWordKey ? vocabWords.includes(selectedWordKey) : false;
  const selectedWordKnown = selectedWordKey ? knownWords.includes(selectedWordKey) : false;
  const selectedWordInfo = useMemo(() => {
    if (!practice || !popup) return null;
    const normalized = normalizeToken(popup.word.word);
    const direct = (practice.vocabulary || []).find(item => normalizeToken(item.word) === normalized);
    const context = (practice.target_word_contexts || []).find(item => normalizeToken(item.word) === normalized);
    const inText = (practice.vocab_in_text || []).find(item => normalizeToken(item.word) === normalized);

    return {
      cefr: direct?.cefr || context?.cefr || inText?.cefr || popup.word.cefr || '',
      ipa: direct?.ipa || context?.ipa || inText?.ipa || '',
      definition: direct?.definition_zh || context?.definition_zh || inText?.zh || popup.contextZh,
    };
  }, [popup, practice]);

  const unloadSound = useCallback(async () => {
    activeTrackKeyRef.current = '';
    if (!soundRef.current) return;
    try {
      await soundRef.current.unloadAsync();
    } catch {
    }
    soundRef.current.setOnPlaybackStatusUpdate(null);
    soundRef.current = null;
    setIsPlaying(false);
    setIsLoading(false);
    positionMillisRef.current = 0;
    durationMillisRef.current = 0;
    setPositionMillis(0);
    setDurationMillis(0);
  }, []);

  const pausePlayback = useCallback(async () => {
    if (!soundRef.current) return;
    try {
      await soundRef.current.pauseAsync();
      setIsPlaying(false);
    } catch {
    }
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
      fromStart?: boolean;
    } = {}
  ) => {
    const normalized = text.trim();
    if (!normalized) return;
    const existingSound = activeTrackKeyRef.current === normalized ? soundRef.current : null;
    if (existingSound) {
      try {
        const shouldRestart = options.fromStart || (
          durationMillisRef.current > 0 && positionMillisRef.current >= Math.max(0, durationMillisRef.current - 200)
        );
        if (shouldRestart) {
          await existingSound.setPositionAsync(0);
          positionMillisRef.current = 0;
          setPositionMillis(0);
        }
        setErrorMessage(null);
        setIsLoading(false);
        await existingSound.playAsync();
        setIsPlaying(true);
        options.onStart?.();
        return;
      } catch {
        await unloadSound();
      }
    }
    const requestId = playbackRequestRef.current + 1;
    playbackRequestRef.current = requestId;
    setErrorMessage(null);
    setIsLoading(true);
    positionMillisRef.current = 0;
    durationMillisRef.current = 0;
    setPositionMillis(0);
    setDurationMillis(0);

    const sourceUri = await prepareAudioUri(normalized);
    if (!sourceUri || requestId !== playbackRequestRef.current) {
      setIsLoading(false);
      return;
    }

    await unloadSound();

    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri: sourceUri },
        {
          shouldPlay: false,
          progressUpdateIntervalMillis: 120,
        },
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
          positionMillisRef.current = status.positionMillis || 0;
          durationMillisRef.current = status.durationMillis || 0;
          setPositionMillis(status.positionMillis || 0);
          setDurationMillis(status.durationMillis || 0);
          if (status.didJustFinish) {
            setIsPlaying(false);
            options.onFinish?.();
          }
        }
      );

      if (requestId !== playbackRequestRef.current) {
        sound.setOnPlaybackStatusUpdate(null);
        await sound.unloadAsync();
        return;
      }

      soundRef.current = sound;
      activeTrackKeyRef.current = normalized;
      await sound.setProgressUpdateIntervalAsync(120);
      await sound.playAsync();
      setIsPlaying(true);
      options.onStart?.();
    } catch {
      if (requestId === playbackRequestRef.current) {
        positionMillisRef.current = 0;
        durationMillisRef.current = 0;
      }
      setIsLoading(false);
      setIsPlaying(false);
      setErrorMessage(t('practiceSession.loadError'));
    }
  }, [prepareAudioUri, t, unloadSound]);

  useEffect(() => {
    if (!visible || !practice) return;
    completionSavedRef.current = false;
    step2AutoplayKeyRef.current = '';
    setStep(1);
    setSentenceIndex(0);
    setQuizSelection(null);
    setQuizAnswered(false);
    setHasPlayedStep1(false);
    setHasPlayedStep2(false);
    setHasPlayedStep3(false);
    setHasPlayedStep4(false);
    setPopup(null);
    setLookedWords([]);
    setHardSentences([]);
    setErrorMessage(null);
    setIsLoading(false);
    setIsPlaying(false);
    positionMillisRef.current = 0;
    durationMillisRef.current = 0;
    setPositionMillis(0);
    setDurationMillis(0);
  }, [practice, visible]);

  useEffect(() => {
    if (!visible) {
      void unloadSound();
    }
  }, [unloadSound, visible]);

  useEffect(() => {
    if (!visible || !practice || step !== 2) return;
    const autoplayKey = `${practice.id}:${step}`;
    if (step2AutoplayKeyRef.current === autoplayKey) return;
    step2AutoplayKeyRef.current = autoplayKey;
    setHasPlayedStep2(false);
    void playText(practice.text, {
      fromStart: true,
      onFinish: () => setHasPlayedStep2(true),
    });
  }, [playText, practice, step, visible]);

  useEffect(() => {
    setPopup(null);
  }, [sentenceIndex, step]);

  useEffect(() => {
    if (step !== 2 || activePlaybackLineIndex < 0 || activePlaybackLineIndex === sentenceIndex) return;
    setSentenceIndex(activePlaybackLineIndex);
  }, [activePlaybackLineIndex, sentenceIndex, step]);

  useEffect(() => {
    if (!visible || step !== 4 || hasPlayedStep4) {
      blindPulse.stopAnimation();
      blindPulse.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(blindPulse, {
          toValue: 1,
          duration: 950,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(blindPulse, {
          toValue: 0,
          duration: 950,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => {
      animation.stop();
      blindPulse.setValue(0);
    };
  }, [blindPulse, hasPlayedStep4, step, visible]);

  const handleDismiss = useCallback(() => {
    playbackRequestRef.current += 1;
    void unloadSound();
    onDismiss();
  }, [onDismiss, unloadSound]);

  const transitionToStep = useCallback((nextStep: Step) => {
    playbackRequestRef.current += 1;
    setErrorMessage(null);
    void unloadSound();
    setStep(nextStep);
  }, [unloadSound]);

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

  const finishAndPracticeAgain = useCallback(() => {
    finishPractice();
    playbackRequestRef.current += 1;
    void unloadSound();
    onPracticeAgain();
  }, [finishPractice, onPracticeAgain, unloadSound]);

  const finishAndReturnFeed = useCallback(() => {
    finishPractice();
    playbackRequestRef.current += 1;
    void unloadSound();
    onReturnFeed();
  }, [finishPractice, onReturnFeed, unloadSound]);

  if (!practice) return null;

  const localizedTopic = practice.tag ? getLocalizedTopicLabel(practice.tag, t) : '';
  const mcq = practice.mcq;
  const currentStepLabel = stepLabel(step, t);
  const stepHeroTitle = step === 1
    ? t('practiceSession.previewTitle')
    : step === 2
      ? t('practiceSession.englishDrillTitle')
      : step === 3
        ? t('practiceSession.fadeTitle')
        : isReviewReady
          ? t('practiceSession.summaryTitle')
          : t('practiceSession.blindTitle');
  const stepHeroBody = step === 1
    ? (
      nativeLanguage === 'english'
        ? t('practiceSession.previewFallbackBody')
        : t('practiceSession.previewBody')
    )
    : step === 2
      ? t('practiceSession.englishDrillBody')
      : step === 3
        ? t('practiceSession.fadeBody')
        : isReviewReady
          ? t('practiceSession.afterListenCheck')
          : t('practiceSession.blindBody');

  return (
    <PracticeStudioShell
      visible={visible}
      title={practice.title}
      cefr={practice.cefr}
      step={step}
      stepLabel={currentStepLabel}
      stepTitle={stepHeroTitle}
      stepBody={stepHeroBody}
      onClose={handleDismiss}
    >
      {step === 1 ? (
        <>
          <GlassCard style={styles.sourceCard}>
            <Text style={styles.sourceTitle}>{practice.title}</Text>
            <Text style={styles.sourceMeta}>
              {[localizedTopic, practice.cefr].filter(Boolean).join(' · ')}
            </Text>
            {challengeWords.length > 0 ? (
              <View style={styles.challengeWrap}>
                <PracticeCardHeader label={t('practiceSession.challengeWordsTitle')} />
                <ChallengeWordPills words={challengeWords} tone="practice" singleRow />
              </View>
            ) : null}
          </GlassCard>

          <GlassCard style={styles.meaningCard}>
            <PracticeCardHeader
              label={t('practiceSession.previewTitle')}
              hint={durationMillis > 0 ? `${Math.ceil(durationMillis / 1000)}s` : t('common.play')}
            />
            <PracticeTranscriptPanel
              lines={enrichedLines}
              currentTime={alignedPlaybackSeconds}
              maxHeight={220}
              renderLine={({ line, isActive }) => (
                <View style={[styles.nativeTranscriptLine, isActive && styles.nativeTranscriptLineActive]}>
                  <Text style={styles.nativeTranscriptText}>{line.zh || line.en}</Text>
                </View>
              )}
            />
          </GlassCard>

          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

          <View style={styles.actionRow}>
            <ActionButton
              label={isLoading ? t('feed.preparingPlayback') : isPlaying ? t('common.pause') : t('common.play')}
              onPress={() => {
                if (isPlaying) {
                  void pausePlayback();
                  return;
                }
                void playText(practice.text, {
                  onFinish: () => setHasPlayedStep1(true),
                });
              }}
              loading={isLoading}
              style={styles.primaryAction}
            />
            <ActionButton
              label={t('common.continue')}
              onPress={() => {
                triggerUiFeedback('primary');
                transitionToStep(2);
              }}
              variant="secondary"
              disabled={!hasPlayedStep1}
              style={styles.secondaryAction}
            />
          </View>
        </>
      ) : null}

      {step === 2 && currentSentence ? (
        <>
          <GlassCard style={styles.sentenceCard}>
            <PracticeCardHeader
              label={t('practiceSession.englishDrillTitle')}
              hint={practice.cefr}
            />
            <Text style={styles.sentenceHelper}>{t('practiceSession.englishDrillBody')}</Text>
            <PracticeTranscriptPanel
              lines={enrichedLines}
              currentTime={alignedPlaybackSeconds}
              maxHeight={340}
              renderLine={({ line, index, isActive }) => (
                <WordLine
                  line={line}
                  currentTime={isActive ? alignedPlaybackSeconds : 0}
                  isActive={isActive}
                  showZh={false}
                  compact
                  subtitleSize="sm"
                  onWordTap={(word, lineData) => handleWordTap(word, lineData, index)}
                />
              )}
            />
          </GlassCard>

          {selectedWordInfo && popup ? (
            <PracticeInlineWordInspector
              word={popup.word.word}
              cefr={selectedWordInfo.cefr}
              ipa={selectedWordInfo.ipa}
              definition={selectedWordInfo.definition}
              context={popup.contextEn}
              saved={selectedWordSaved}
              known={selectedWordKnown}
              saveLabel={t('wordPopup.save')}
              savedLabel={t('wordPopup.saved')}
              markKnownLabel={t('wordPopup.markKnown')}
              knownLabel={t('wordPopup.known')}
              onClose={() => setPopup(null)}
              onSave={() => {
                onSaveVocab({
                  word: selectedWordKey,
                  cefr: selectedWordInfo.cefr || popup.word.cefr,
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
              onMarkKnown={() => onMarkKnown(selectedWordKey)}
            />
          ) : null}

          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

          <View style={styles.step2Controls}>
            <View style={styles.dualRow}>
              <ActionButton
                label={t('common.replay')}
                onPress={() => {
                  setHasPlayedStep2(false);
                  void playText(practice.text, {
                    fromStart: true,
                    onFinish: () => setHasPlayedStep2(true),
                  });
                }}
                variant="secondary"
                loading={isLoading}
                style={styles.dualAction}
              />
              <ActionButton
                label={isPlaying ? t('common.pause') : t('common.play')}
                onPress={() => {
                  if (isPlaying) {
                    void pausePlayback();
                    return;
                  }
                  void playText(practice.text, {
                    onFinish: () => setHasPlayedStep2(true),
                  });
                }}
                loading={isLoading}
                style={styles.dualAction}
              />
            </View>
            <ActionButton
              label={t('common.continue')}
              onPress={() => transitionToStep(3)}
              variant="secondary"
              disabled={!hasPlayedStep2 || isPlaying || isLoading}
            />
          </View>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <GlassCard style={styles.fadeCard}>
            <PracticeCardHeader
              label={t('practiceSession.fadeTitle')}
              hint={`${challengeWords.length} words`}
            />
            {challengeWords.length > 0 ? (
              <ChallengeWordPills words={challengeWords} tone="practice" singleRow />
            ) : null}
            <Text style={styles.fadeHint}>{t('practiceSession.fadeBody')}</Text>
          </GlassCard>

          <GlassCard style={styles.fadeTranscriptCard}>
            <PracticeCardHeader
              label={t('practiceSession.fadeTitle')}
              hint={durationMillis > 0 ? `${Math.ceil(durationMillis / 1000)}s` : null}
            />
            <PracticeTranscriptPanel
              lines={enrichedLines}
              currentTime={alignedPlaybackSeconds}
              maxHeight={360}
              renderLine={({ line, index, isActive }) => {
                const fadeTokens = buildFadeText(line, fadeTargetWords);
                return (
                  <View style={styles.fadeLineBlock}>
                    <Text
                      style={[
                        styles.fadeTranscriptLine,
                        !isActive && styles.fadeTranscriptLineIdle,
                      ]}
                    >
                      {fadeTokens.map(token => (
                        <Text
                          key={token.key}
                          style={[
                            styles.fadeToken,
                            token.emphasis && styles.fadeTokenEmphasis,
                            !token.visible && styles.fadeTokenMasked,
                          ]}
                        >
                          {token.visible ? token.text : '····'}
                        </Text>
                      ))}
                    </Text>
                  </View>
                );
              }}
            />
          </GlassCard>

          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

          <View style={styles.actionRow}>
            <ActionButton
              label={isLoading ? t('feed.preparingPlayback') : isPlaying ? t('common.pause') : t('common.play')}
              onPress={() => {
                if (isPlaying) {
                  void pausePlayback();
                  return;
                }
                void playText(practice.text, {
                  onFinish: () => setHasPlayedStep3(true),
                });
              }}
              loading={isLoading}
              style={styles.primaryAction}
            />
            <ActionButton
              label={t('common.continue')}
              onPress={() => transitionToStep(4)}
              variant="secondary"
              disabled={!hasPlayedStep3}
              style={styles.secondaryAction}
            />
          </View>
        </>
      ) : null}

      {step === 4 && !hasPlayedStep4 ? (
        <>
          <GlassCard style={styles.blindCard}>
            <Pressable
              onPress={() => {
                if (isPlaying) {
                  void pausePlayback();
                  return;
                }
                void playText(practice.text, {
                  onFinish: () => setHasPlayedStep4(true),
                });
              }}
              style={styles.blindButton}
            >
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.blindPulseRing,
                  {
                    opacity: blindPulse.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.18, 0.38],
                    }),
                    transform: [
                      {
                        scale: blindPulse.interpolate({
                          inputRange: [0, 1],
                          outputRange: [1, 1.08],
                        }),
                      },
                    ],
                  },
                ]}
              />
              <View style={styles.blindOrb}>
                <View style={styles.blindBars}>
                  {[24, 44, 30, 56, 18].map((height, index) => (
                    <View
                      key={`blind-${index}`}
                      style={[
                        styles.blindBar,
                        {
                          height,
                          opacity: isPlaying ? 0.98 : 0.58 + ((index % 2) * 0.14),
                        },
                      ]}
                    />
                  ))}
                </View>
                <View style={styles.blindIconBadge}>
                  <Ionicons
                    name={isPlaying ? 'pause' : 'play'}
                    size={28}
                    color={colors.textOnAccent}
                  />
                </View>
              </View>
            </Pressable>
            <Text style={styles.blindCaption}>{t('practiceSession.blindBody')}</Text>
          </GlassCard>

          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

          <View style={styles.actionRow}>
            <ActionButton
              label={isLoading ? t('feed.preparingPlayback') : isPlaying ? t('common.pause') : t('common.play')}
              onPress={() => {
                if (isPlaying) {
                  void pausePlayback();
                  return;
                }
                void playText(practice.text, {
                  onFinish: () => setHasPlayedStep4(true),
                });
              }}
              loading={isLoading}
              style={styles.primaryAction}
            />
          </View>
        </>
      ) : null}

      {step === 4 && hasPlayedStep4 ? (
        <>
          {mcq ? (
            <GlassCard style={styles.quizCard}>
              <PracticeCardHeader label={t('practiceSession.afterListenQuiz')} />
              <Text style={styles.quizQuestion}>{mcq.q}</Text>
              <View style={styles.quizOptions}>
                {mcq.options.map((option, index) => {
                  const selected = quizSelection === index;
                  const isCorrect = quizAnswered && index === mcq.correct;
                  const isWrong = quizAnswered && selected && !isCorrect;
                  return (
                    <Pressable
                      key={`mcq-${index}`}
                      disabled={quizAnswered}
                      onPress={() => {
                        if (quizAnswered) return;
                        triggerUiFeedback(index === mcq.correct ? 'correct' : 'error');
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
                <Text style={styles.quizExplanation}>{mcq.explanation}</Text>
              ) : null}
            </GlassCard>
          ) : null}

          {isReviewReady ? (
            <>
              <View style={styles.reviewStatsRow}>
                <GlassCard style={styles.statCard}>
                  <StatBlock
                    value={lookedWords.length}
                    label={t('practiceSession.summaryWords')}
                  />
                </GlassCard>
                <GlassCard style={styles.statCard}>
                  <StatBlock
                    value={hardSentences.length}
                    label={t('practiceSession.summaryHard')}
                    accent="#F59E0B"
                  />
                </GlassCard>
              </View>

              <GlassCard style={styles.reviewCard}>
                <PracticeCardHeader label={t('practiceSession.summaryTitle')} />
                <View style={styles.reviewTranscript}>
                  {enrichedLines.map((line, index) => (
                    <View
                      key={`review-${index}`}
                      style={[
                        styles.reviewLine,
                        hardSentences.includes(index) && styles.reviewLineHard,
                      ]}
                    >
                      <Text style={styles.reviewLineEn}>{line.en}</Text>
                      <Text style={styles.reviewLineZh}>{line.zh}</Text>
                      {hardSentences.includes(index) ? (
                        <Text style={styles.reviewLineHint}>{t('practiceSession.hard')}</Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              </GlassCard>

              <View style={styles.actionRow}>
                <ActionButton
                  label={t('practiceSession.finishPractice')}
                  onPress={() => {
                    finishPractice();
                    handleDismiss();
                  }}
                  style={styles.primaryAction}
                />
                <ActionButton
                  label={t('practiceSession.practiceAnother')}
                  onPress={finishAndPracticeAgain}
                  variant="secondary"
                  style={styles.secondaryAction}
                />
              </View>

              <ActionButton
                label={t('practiceSession.backToFeed')}
                onPress={finishAndReturnFeed}
                variant="secondary"
              />
            </>
          ) : null}
        </>
      ) : null}
    </PracticeStudioShell>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    sourceCard: {
      gap: spacing.md,
      backgroundColor: 'rgba(168,85,247,0.10)',
      borderColor: 'rgba(168,85,247,0.22)',
    },
    sourceTitle: {
      color: colors.textPrimary,
      fontSize: typography.title,
      fontWeight: '700',
    },
    sourceMeta: {
      color: colors.textSecondary,
      fontSize: typography.caption,
    },
    challengeWrap: {
      gap: spacing.sm,
      paddingBottom: spacing.sm,
    },
    meaningCard: {
      gap: spacing.sm,
      backgroundColor: colors.bgSurface1,
    },
    nativeTranscriptLine: {
      paddingVertical: spacing.xs,
      alignItems: 'center',
    },
    nativeTranscriptLineActive: {
      opacity: 1,
    },
    nativeTranscriptText: {
      color: colors.textPrimary,
      fontSize: typography.body,
      lineHeight: 22,
      textAlign: 'center',
      fontWeight: '600',
    },
    actionRow: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    primaryAction: {
      flex: 1,
    },
    secondaryAction: {
      minWidth: 108,
    },
    sentenceCard: {
      gap: spacing.md,
      backgroundColor: 'rgba(168,85,247,0.10)',
      borderColor: 'rgba(168,85,247,0.22)',
    },
    sentenceHelper: {
      color: colors.textTertiary,
      fontSize: typography.caption,
      lineHeight: 18,
      textAlign: 'center',
    },
    progressCard: {
      gap: spacing.sm,
      backgroundColor: colors.bgSurface1,
    },
    step2Controls: {
      gap: spacing.md,
    },
    dualRow: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    dualAction: {
      flex: 1,
    },
    fadeCard: {
      gap: spacing.md,
      backgroundColor: 'rgba(168,85,247,0.10)',
      borderColor: 'rgba(168,85,247,0.22)',
    },
    fadeTranscriptCard: {
      gap: spacing.md,
      backgroundColor: colors.bgSurface1,
    },
    fadeLineBlock: {
      gap: spacing.xs,
      alignItems: 'center',
    },
    fadeTranscriptLine: {
      color: colors.textPrimary,
      fontSize: 18,
      lineHeight: 28,
      textAlign: 'center',
    },
    fadeTranscriptLineIdle: {
      opacity: 0.92,
    },
    fadeSentence: {
      color: colors.textPrimary,
      fontSize: 24,
      lineHeight: 34,
      fontWeight: '700',
      textAlign: 'center',
    },
    fadeToken: {
      color: colors.textPrimary,
    },
    fadeTokenEmphasis: {
      color: '#D8B4FE',
    },
    fadeTokenMasked: {
      color: colors.textTertiary,
    },
    fadeHint: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      lineHeight: 18,
      textAlign: 'center',
    },
    blindCard: {
      gap: spacing.lg,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 320,
      backgroundColor: colors.bgSurface1,
    },
    blindButton: {
      width: 188,
      height: 188,
      alignItems: 'center',
      justifyContent: 'center',
    },
    blindPulseRing: {
      position: 'absolute',
      width: 184,
      height: 184,
      borderRadius: 92,
      backgroundColor: 'rgba(168,85,247,0.16)',
    },
    blindOrb: {
      width: 168,
      height: 168,
      borderRadius: 84,
      backgroundColor: 'rgba(168,85,247,0.14)',
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: colors.accentPractice,
      shadowOpacity: 0.22,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 6 },
    },
    blindBars: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    blindIconBadge: {
      position: 'absolute',
      width: 58,
      height: 58,
      borderRadius: 29,
      backgroundColor: colors.accentPractice,
      alignItems: 'center',
      justifyContent: 'center',
    },
    blindBar: {
      width: 6,
      borderRadius: radii.pill,
      backgroundColor: '#FFFFFF',
    },
    blindCaption: {
      color: colors.textSecondary,
      fontSize: typography.body,
      textAlign: 'center',
    },
    quizCard: {
      gap: spacing.md,
      backgroundColor: colors.bgSurface1,
    },
    quizQuestion: {
      color: colors.textPrimary,
      fontSize: typography.bodyLg,
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
      borderColor: 'rgba(34,197,94,0.32)',
      backgroundColor: 'rgba(34,197,94,0.16)',
    },
    quizOptionWrong: {
      borderColor: 'rgba(239,68,68,0.32)',
      backgroundColor: 'rgba(239,68,68,0.16)',
    },
    quizOptionText: {
      color: colors.textPrimary,
      fontSize: typography.body,
      lineHeight: 20,
      fontWeight: '500',
    },
    quizExplanation: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      lineHeight: 18,
    },
    reviewStatsRow: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    statCard: {
      flex: 1,
      backgroundColor: colors.bgSurface1,
    },
    reviewCard: {
      gap: spacing.md,
      backgroundColor: colors.bgSurface1,
    },
    reviewTranscript: {
      gap: spacing.sm,
    },
    reviewLine: {
      padding: spacing.md,
      borderRadius: radii.lg,
      backgroundColor: colors.bgSurface2,
      gap: 6,
    },
    reviewLineHard: {
      borderWidth: 1,
      borderColor: 'rgba(245,158,11,0.32)',
      backgroundColor: 'rgba(245,158,11,0.12)',
    },
    reviewLineEn: {
      color: colors.textPrimary,
      fontSize: typography.body,
      lineHeight: 21,
      fontWeight: '600',
    },
    reviewLineZh: {
      color: colors.textSecondary,
      fontSize: typography.caption,
      lineHeight: 18,
    },
    reviewLineHint: {
      color: '#FCD34D',
      fontSize: typography.micro,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    errorText: {
      color: colors.accentError,
      fontSize: typography.caption,
      textAlign: 'center',
    },
  });
}
