import * as FileSystem from 'expo-file-system';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  buildClipKey,
  clipRelativeToSourceSeconds,
  findLineAtTime,
  getClipDurationSeconds,
  getClipAudioEndSeconds,
  getClipAudioStartSeconds,
  getSentenceMarkers,
  getSentenceRange,
  getSourceLabel,
  resolveClipAudioUrl,
} from '../clip-utils';
import { CircularProgressPlayButton } from './CircularProgressPlayButton';
import { ChallengeWordPills } from './ChallengeWordPills';
import { triggerMediumHaptic, triggerUiFeedback } from '../feedback';
import { useUiI18n } from '../i18n';
import { getLocalizedTopicLabel } from '../i18n/helpers';
import { buildFadeSegments, deriveChallengeWords } from '../learning-scaffold';
import { useResponsiveLayout } from '../responsive';
import { useAppTheme } from '../theme';
import type { Clip, ClipLineWord, Level, NativeLanguage, PracticeRecord, VocabEntry } from '../types';
import { ProgressBar } from './ProgressBar';
import { WordLine } from './WordLine';
import { WordPopup } from './WordPopup';

type Step = 1 | 2 | 3 | 4 | 5;

type PopupState = {
  word: ClipLineWord;
  contextEn: string;
  contextZh: string;
  lineIndex: number | null;
} | null;

type LookedWord = {
  word: string;
  cefr?: string;
};

type PendingPlayback = {
  targetStartMillis: number;
  targetEndMillis: number | null;
};

function hashPracticeAudioKey(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

type Props = {
  visible: boolean;
  clip: Clip | null;
  clipIndex: number;
  level: Level | null;
  nativeLanguage: NativeLanguage;
  vocabWords: string[];
  knownWords: string[];
  onSaveVocab: (entry: VocabEntry) => void;
  onMarkKnown: (word: string) => void;
  onRecordWordLookup: (cefr?: string, details?: { clip?: Clip | null; word?: string }) => void;
  onComplete: (clipKey: string, record: PracticeRecord) => void;
  onDismiss: () => void;
  onReturnFeed: () => void;
  onPracticeAgain: () => void;
};

function stepLabel(step: Step, t: (key: string, params?: Record<string, string | number>) => string) {
  if (step === 1) return t('practiceSession.stepNativeLanguage');
  if (step === 2) return t('practiceSession.stepEnglish');
  if (step === 3) return t('practiceSession.stepFade');
  if (step === 4) return t('practiceSession.stepBlind');
  return t('practiceSession.stepComplete');
}

function hasReadableCharacters(value: string) {
  return /[A-Za-z]/.test(value);
}

export function PracticeSessionModal({
  visible,
  clip,
  clipIndex,
  level,
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
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const soundReadyRef = useRef(false);
  const preparedAudioUriRef = useRef<string | null>(null);
  const preparedAudioKeyRef = useRef('');
  const prepareAudioPromiseRef = useRef<Promise<string | null> | null>(null);
  const prepareRequestIdRef = useRef(0);
  const loadPromiseRef = useRef<Promise<boolean> | null>(null);
  const loadRequestIdRef = useRef(0);
  const playbackRequestRef = useRef(0);
  const pendingPlaybackRef = useRef<PendingPlayback | null>(null);
  const segmentEndRef = useRef<number | null>(null);
  const completionSavedRef = useRef(false);
  const stepRef = useRef<Step>(1);
  const wordsLookedRef = useRef(0);
  const hardSentencesRef = useRef<number[]>([]);

  const [step, setStep] = useState<Step>(1);
  const [status, setStatus] = useState({
    isPlaying: false,
    isLoading: false,
    positionMillis: 0,
    durationMillis: 0,
    errorMessage: null as string | null,
  });
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [hardSentences, setHardSentences] = useState<number[]>([]);
  const [wordsLooked, setWordsLooked] = useState(0);
  const [lookedWordsList, setLookedWordsList] = useState<LookedWord[]>([]);
  const [fadePlaybackFinished, setFadePlaybackFinished] = useState(false);
  const [blindListenFinished, setBlindListenFinished] = useState(false);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizSelections, setQuizSelections] = useState<Record<number, string>>({});
  const [quizCorrectCount, setQuizCorrectCount] = useState(0);
  const [popup, setPopup] = useState<PopupState>(null);

  const clipKey = useMemo(() => {
    if (!clip) return '';
    return buildClipKey(clip, clipIndex);
  }, [clip, clipIndex]);
  const challengeWords = useMemo(
    () => (clip ? deriveChallengeWords(clip, level, knownWords) : []),
    [clip, knownWords, level]
  );

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  useEffect(() => {
    hardSentencesRef.current = hardSentences;
  }, [hardSentences]);

  useEffect(() => {
    wordsLookedRef.current = wordsLooked;
  }, [wordsLooked]);

  const unloadSound = useCallback(async () => {
    soundReadyRef.current = false;
    pendingPlaybackRef.current = null;
    if (!soundRef.current) return;
    try {
      await soundRef.current.unloadAsync();
    } catch {
    }
    soundRef.current.setOnPlaybackStatusUpdate(null);
    soundRef.current = null;
  }, []);

  const ensurePreparedAudioUri = useCallback(async () => {
    if (!clip) return null;
    const sourceUrl = resolveClipAudioUrl(clip);
    if (!sourceUrl) return null;
    if (!/^https?:\/\//i.test(sourceUrl)) {
      preparedAudioUriRef.current = sourceUrl;
      preparedAudioKeyRef.current = sourceUrl;
      return sourceUrl;
    }

    const cacheRoot = FileSystem.cacheDirectory;
    if (!cacheRoot) return sourceUrl;

    const cacheKey = hashPracticeAudioKey(sourceUrl);
    if (preparedAudioKeyRef.current === cacheKey && preparedAudioUriRef.current) {
      return preparedAudioUriRef.current;
    }
    if (prepareAudioPromiseRef.current) {
      return prepareAudioPromiseRef.current;
    }

    const extensionMatch = sourceUrl.match(/\.([a-z0-9]+)(?:$|[?#])/i);
    const extension = extensionMatch ? extensionMatch[1].toLowerCase() : 'mp3';
    const cacheDir = `${cacheRoot}practice-audio/`;
    const localUri = `${cacheDir}${cacheKey}.${extension}`;

    const prepareRequestId = prepareRequestIdRef.current + 1;
    prepareRequestIdRef.current = prepareRequestId;

    const currentPrepare = (async () => {
      try {
        await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });
        const existing = await FileSystem.getInfoAsync(localUri);
        if (existing.exists && !existing.isDirectory) {
          preparedAudioUriRef.current = localUri;
          preparedAudioKeyRef.current = cacheKey;
          return localUri;
        }
        await FileSystem.downloadAsync(sourceUrl, localUri);
        preparedAudioUriRef.current = localUri;
        preparedAudioKeyRef.current = cacheKey;
        return localUri;
      } catch {
        try {
          await FileSystem.deleteAsync(localUri, { idempotent: true });
        } catch {
        }
        preparedAudioUriRef.current = sourceUrl;
        preparedAudioKeyRef.current = cacheKey;
        return sourceUrl;
      } finally {
        if (prepareRequestIdRef.current === prepareRequestId) {
          prepareAudioPromiseRef.current = null;
        }
      }
    })();

    prepareAudioPromiseRef.current = currentPrepare;
    return currentPrepare;
  }, [clip]);

  const finishPractice = useCallback(() => {
    if (!clip || !clipKey || completionSavedRef.current) {
      setStep(5);
      return;
    }

    completionSavedRef.current = true;
    triggerUiFeedback('practiceComplete');
    onComplete(clipKey, {
      done: true,
      words: wordsLookedRef.current,
      hard: hardSentencesRef.current.length,
      ts: Date.now(),
    });
    setStep(5);
  }, [clip, clipKey, onComplete]);

  const handleStatus = useCallback((nextStatus: AVPlaybackStatus) => {
    if (!nextStatus.isLoaded) {
      setStatus(prev => ({
        ...prev,
        isLoading: false,
        isPlaying: false,
        errorMessage: nextStatus.error ? t('practiceSession.loadError') : prev.errorMessage,
      }));
      return;
    }

    const clipWindowEndMillis = clip ? Math.floor(getClipAudioEndSeconds(clip) * 1000) : 0;
    const clipWindowStartMillis = clip ? Math.floor(getClipAudioStartSeconds(clip) * 1000) : 0;
    const clipDurationMillis = clip ? Math.floor(getClipDurationSeconds(clip) * 1000) : 0;
    const relativePositionMillis = clip
      ? Math.max(0, nextStatus.positionMillis - clipWindowStartMillis)
      : nextStatus.positionMillis;
    const pendingPlayback = pendingPlaybackRef.current;
    if (pendingPlayback) {
      const settled =
        Math.abs(nextStatus.positionMillis - pendingPlayback.targetStartMillis) <= 400
        || (
          nextStatus.positionMillis >= pendingPlayback.targetStartMillis
          && nextStatus.positionMillis <= pendingPlayback.targetStartMillis + 1200
        );
      if (!settled) {
        return;
      }
      pendingPlaybackRef.current = null;
      segmentEndRef.current = pendingPlayback.targetEndMillis;
    }
    const reachedClipEnd = clip && clipWindowEndMillis > clipWindowStartMillis
      && nextStatus.positionMillis >= clipWindowEndMillis - 160;

    setStatus(prev => ({
      ...prev,
      isPlaying: reachedClipEnd ? false : nextStatus.isPlaying,
      isLoading: false,
      positionMillis: clipDurationMillis > 0
        ? Math.min(relativePositionMillis, clipDurationMillis)
        : relativePositionMillis,
      durationMillis: clipDurationMillis || prev.durationMillis,
      errorMessage: null,
    }));

    if (
      segmentEndRef.current !== null &&
      nextStatus.isPlaying &&
      nextStatus.positionMillis >= segmentEndRef.current
    ) {
      const sound = soundRef.current;
      segmentEndRef.current = null;
      if (sound) {
        void sound.pauseAsync();
      }
    }

    if (reachedClipEnd && soundRef.current) {
      const sound = soundRef.current;
      segmentEndRef.current = null;
      void sound.pauseAsync().catch(() => {});
      void sound.setPositionAsync(clipWindowEndMillis).catch(() => {});
      if (stepRef.current === 3) {
        setFadePlaybackFinished(true);
      }
      if (stepRef.current === 4) {
        setBlindListenFinished(true);
      }
      return;
    }

    if (!nextStatus.didJustFinish) return;

    segmentEndRef.current = null;
    if (stepRef.current === 3) {
      setFadePlaybackFinished(true);
    }
    if (stepRef.current === 4) {
      setBlindListenFinished(true);
    }
  }, [clip, t]);

  const loadSound = useCallback(async () => {
    if (!clip || !visible) return false;
    if (soundRef.current && soundReadyRef.current) {
      return true;
    }
    if (loadPromiseRef.current) {
      return loadPromiseRef.current;
    }
    setStatus(prev => ({ ...prev, isLoading: true, errorMessage: null }));
    const preparedAudioUri = await ensurePreparedAudioUri();
    if (!preparedAudioUri) {
      setStatus({
        isPlaying: false,
        isLoading: false,
        positionMillis: 0,
        durationMillis: Math.floor(getClipDurationSeconds(clip) * 1000),
        errorMessage: t('practiceSession.noAudio'),
      });
      return false;
    }

    const loadRequestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = loadRequestId;

    const currentLoad = (async () => {
      await unloadSound();

      const sound = new Audio.Sound();
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate(handleStatus);

      try {
        await sound.loadAsync(
          { uri: preparedAudioUri },
          {
            shouldPlay: false,
            progressUpdateIntervalMillis: 120,
            positionMillis: Math.floor(getClipAudioStartSeconds(clip) * 1000),
          }
        );
        await sound.setProgressUpdateIntervalAsync(120);
        soundReadyRef.current = true;
        const initialStatus = await sound.getStatusAsync();
        handleStatus(initialStatus);
        return true;
      } catch {
        if (soundRef.current === sound) {
          sound.setOnPlaybackStatusUpdate(null);
          soundRef.current = null;
        }
        try {
          await sound.unloadAsync();
        } catch {
        }
        setStatus(prev => ({
          ...prev,
          isPlaying: false,
          isLoading: false,
          positionMillis: 0,
          durationMillis: Math.floor(getClipDurationSeconds(clip) * 1000),
          errorMessage: t('practiceSession.loadError'),
        }));
        return false;
      } finally {
        if (loadRequestIdRef.current === loadRequestId) {
          loadPromiseRef.current = null;
        }
      }
    })();

    loadPromiseRef.current = currentLoad;
    return currentLoad;
  }, [clip, ensurePreparedAudioUri, handleStatus, t, unloadSound, visible]);

  const playWholeClip = useCallback(async (fromMillis = 0) => {
    if (!clip) return;
    const requestId = playbackRequestRef.current + 1;
    playbackRequestRef.current = requestId;
    segmentEndRef.current = null;
    const targetStartMillis = Math.max(0, Math.floor(clipRelativeToSourceSeconds(clip, fromMillis / 1000) * 1000));
    pendingPlaybackRef.current = {
      targetStartMillis,
      targetEndMillis: null,
    };
    const ready = await loadSound();
    if (!ready || requestId !== playbackRequestRef.current || !soundRef.current) return;
    try {
      await soundRef.current.pauseAsync().catch(() => {});
      await soundRef.current.setPositionAsync(targetStartMillis);
      const seekStatus = await soundRef.current.getStatusAsync();
      handleStatus(seekStatus);
      await soundRef.current.playAsync();
    } catch {
      if (requestId !== playbackRequestRef.current) return;
      pendingPlaybackRef.current = null;
      setStatus(prev => ({
        ...prev,
        isPlaying: false,
        isLoading: false,
        errorMessage: t('practiceSession.loadError'),
      }));
    }
  }, [clip, loadSound, t]);

  const playSentence = useCallback(async (lineIndex: number) => {
    if (!clip) return;
    const line = clip.lines?.[lineIndex];
    if (!line) return;
    const requestId = playbackRequestRef.current + 1;
    playbackRequestRef.current = requestId;
    const targetStartMillis = Math.max(0, Math.floor(clipRelativeToSourceSeconds(clip, line.start) * 1000));
    const targetEndMillis = Math.floor(clipRelativeToSourceSeconds(clip, line.end) * 1000);
    pendingPlaybackRef.current = {
      targetStartMillis,
      targetEndMillis,
    };
    const ready = await loadSound();
    if (!ready || requestId !== playbackRequestRef.current || !soundRef.current) return;
    try {
      await soundRef.current.pauseAsync().catch(() => {});
      await soundRef.current.setPositionAsync(targetStartMillis);
      const seekStatus = await soundRef.current.getStatusAsync();
      handleStatus(seekStatus);
      await soundRef.current.playAsync();
    } catch {
      if (requestId !== playbackRequestRef.current) return;
      pendingPlaybackRef.current = null;
      setStatus(prev => ({
        ...prev,
        isPlaying: false,
        isLoading: false,
        errorMessage: t('practiceSession.loadError'),
      }));
    }
  }, [clip, loadSound, t]);

  const pause = useCallback(async () => {
    playbackRequestRef.current += 1;
    pendingPlaybackRef.current = null;
    if (!soundRef.current) return;
    try {
      await soundRef.current.pauseAsync();
    } catch {
    }
  }, []);

  const togglePlay = useCallback(async () => {
    if (status.isPlaying) {
      await pause();
      return;
    }

    if (stepRef.current === 2) {
      if (soundRef.current && soundReadyRef.current) {
        try {
          await soundRef.current.playAsync();
          return;
        } catch {
        }
      }
      await playSentence(sentenceIndex);
      return;
    }
    if (stepRef.current === 3) {
      if (soundRef.current && soundReadyRef.current) {
        try {
          await soundRef.current.playAsync();
          return;
        } catch {
        }
      }
      await playWholeClip(status.positionMillis);
      return;
    }

    const totalDurationMillis = Math.max(
      status.durationMillis,
      Math.floor((clip ? getClipDurationSeconds(clip) : 0) * 1000)
    );
    const restart = status.positionMillis >= Math.max(0, totalDurationMillis - 300);
    await playWholeClip(restart ? 0 : status.positionMillis);
  }, [clip, pause, playSentence, playWholeClip, sentenceIndex, status.durationMillis, status.isPlaying, status.positionMillis]);

  useEffect(() => {
    if (!visible || !clip) return;

    playbackRequestRef.current += 1;
    preparedAudioUriRef.current = null;
    preparedAudioKeyRef.current = '';
    prepareAudioPromiseRef.current = null;
    loadPromiseRef.current = null;
    pendingPlaybackRef.current = null;
    completionSavedRef.current = false;
    segmentEndRef.current = null;
    setStep(1);
    setSentenceIndex(0);
    setHardSentences([]);
    setWordsLooked(0);
    setLookedWordsList([]);
    setFadePlaybackFinished(false);
    setBlindListenFinished(false);
    setQuizIndex(0);
    setQuizSelections({});
    setQuizCorrectCount(0);
    setPopup(null);
    wordsLookedRef.current = 0;
    hardSentencesRef.current = [];

    void loadSound();

    return () => {
      loadPromiseRef.current = null;
      void unloadSound();
    };
  }, [clip, loadSound, unloadSound, visible]);

  useEffect(() => {
    if (!visible || !clip || step !== 2) return;
    void playSentence(sentenceIndex);
  }, [clip, playSentence, sentenceIndex, step, visible]);

  useEffect(() => {
    if (!visible || !clip || step !== 3) return;
    setFadePlaybackFinished(false);
    void playWholeClip(0);
  }, [clip, playWholeClip, step, visible]);

  useEffect(() => {
    if (!visible || !clip || step !== 4) return;
    if (blindListenFinished) return;
    void playWholeClip(0);
  }, [blindListenFinished, clip, playWholeClip, step, visible]);

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;
    const timer = setInterval(() => {
      const sound = soundRef.current;
      if (!sound) return;

      void sound.getStatusAsync().then(nextStatus => {
        if (cancelled) return;
        handleStatus(nextStatus);
      }).catch(() => {
      });
    }, 180);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [handleStatus, visible]);

  useEffect(() => {
    if (!visible || step !== 5) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  }, [step, visible]);

  const lineCount = clip?.lines?.length || 0;
  const clipDurationMillis = Math.max(
    status.durationMillis,
    Math.floor((clip ? getClipDurationSeconds(clip) : 0) * 1000)
  );
  const currentLineIndex = clip ? Math.max(0, findLineAtTime(clip, status.positionMillis / 1000)) : 0;
  const currentLine = clip?.lines?.[currentLineIndex] || null;
  const sentenceLine = clip?.lines?.[sentenceIndex] || null;
  const markers = clip ? getSentenceMarkers(clip) : [];
  const currentSentenceRange = clip ? getSentenceRange(clip, currentLineIndex) : null;
  const hardRanges = useMemo(() => {
    if (!clip || (step !== 4 && step !== 5)) return [];
    return hardSentences
      .map(lineIndex => {
        const range = getSentenceRange(clip, lineIndex);
        if (!range) return null;
        return { ...range, color: 'rgba(139,156,247,0.22)', opacity: 1 };
      })
      .filter(Boolean) as { start: number; end: number; color?: string; opacity?: number }[];
  }, [clip, hardSentences, step]);
  const fadeDisplayLevel = useMemo<0 | 1 | 2>(() => {
    if (step !== 3 || clipDurationMillis <= 0) return 0;
    const progress = status.positionMillis / clipDurationMillis;
    if (progress >= 0.66) return 2;
    if (progress >= 0.33) return 1;
    return 0;
  }, [clipDurationMillis, status.positionMillis, step]);
  const fadeSegments = useMemo(
    () => (currentLine ? buildFadeSegments(currentLine, challengeWords, fadeDisplayLevel) : []),
    [challengeWords, currentLine, fadeDisplayLevel]
  );
  const translationUnavailableLabel = t('common.translationUnavailable');
  const previewLines = useMemo(() => {
    return (clip?.lines || []).map((line, index) => {
      const localizedText = String(line.zh || '').trim();
      const hasLocalizedText = Boolean(
        localizedText
        && localizedText !== line.en
        && localizedText !== translationUnavailableLabel
      );
      return {
        index,
        line,
        translation: hasLocalizedText ? localizedText : line.en,
        hasLocalizedText,
      };
    });
  }, [clip?.lines, lineCount, translationUnavailableLabel]);
  const fadeTapWords = useMemo(
    () => (currentLine?.words || []).filter(word => hasReadableCharacters(word.word)),
    [currentLine]
  );
  const previewUsesLocalizedContent = useMemo(() => {
    if (nativeLanguage === 'english') return false;
    return previewLines.some(item => item.hasLocalizedText);
  }, [nativeLanguage, previewLines]);
  const transcriptPanelHeight = Math.min(
    Math.max(metrics.windowHeight * 0.24, 180),
    metrics.isTablet ? 320 : 250
  );
  const reviewTranscriptHeight = Math.min(
    Math.max(metrics.windowHeight * 0.28, 220),
    metrics.isTablet ? 380 : 300
  );
  if (!clip) return null;

  const questions = clip.questions || [];
  const currentQuestion = questions[quizIndex] || null;
  const currentSelection = quizSelections[quizIndex] || '';
  const currentAnswer = currentQuestion?.answer?.trim().charAt(0).toUpperCase() || '';

  const handleWordTap = (word: ClipLineWord, contextEn: string, contextZh: string, lineIndex: number | null) => {
    onRecordWordLookup(word.cefr, {
      clip,
      word: word.word,
    });
    setWordsLooked(prev => prev + 1);
    setLookedWordsList(prev => {
      const normalized = word.word.toLowerCase();
      if (prev.some(item => item.word === normalized)) return prev;
      return [...prev, { word: normalized, cefr: word.cefr }];
    });
    setPopup({ word, contextEn, contextZh, lineIndex });
  };

  const beginFadeStage = () => {
    if (lineCount <= 0) {
      setStep(4);
      return;
    }
    setFadePlaybackFinished(false);
    setStep(3);
  };

  const moveToNextSentence = () => {
    const nextIndex = sentenceIndex + 1;
    if (nextIndex < lineCount) {
      setSentenceIndex(nextIndex);
      return;
    }
    beginFadeStage();
  };

  const beginBlindStage = () => {
    setBlindListenFinished(false);
    setQuizIndex(0);
    setQuizSelections({});
    setQuizCorrectCount(0);
    setStep(4);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onDismiss}>
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <View
          style={[
            styles.header,
            {
              paddingTop: Math.max(insets.top + 10, 18),
              paddingHorizontal: metrics.pageHorizontalPadding,
            },
          ]}
        >
          <View style={[styles.headerInner, { maxWidth: metrics.modalMaxWidth }]}>
            <Pressable
              onPress={() => {
                triggerUiFeedback('menu');
                onDismiss();
              }}
              style={styles.closeButton}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={styles.closeButtonText}>{t('common.close')}</Text>
            </Pressable>
            <Text style={styles.stepLabel}>{stepLabel(step, t)}</Text>
            <View style={styles.stepDots}>
              {[1, 2, 3, 4].map(item => (
                <View
                  key={item}
                  style={[
                    styles.stepDot,
                    step === item && styles.stepDotActive,
                    step > item && styles.stepDotDone,
                  ]}
                />
              ))}
            </View>
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[
            styles.body,
            {
              paddingHorizontal: metrics.pageHorizontalPadding,
              paddingBottom: Math.max(insets.bottom + 40, 40),
              maxWidth: metrics.modalMaxWidth,
              alignSelf: 'center',
              width: '100%',
            },
          ]}
        >
          {step === 1 ? (
            <View style={styles.centerBlock}>
              <View style={styles.sourceCard}>
                <Text style={styles.sourceTitle}>{clip.title}</Text>
                <Text style={styles.sourceMeta}>
                  {getSourceLabel(clip.source)}
                  {clip.tag ? ` · ${getLocalizedTopicLabel(clip.tag, t)}` : ''}
                </Text>
              </View>

              {challengeWords.length > 0 ? (
                <View style={styles.previewCard}>
                  <Text style={styles.sectionEyebrow}>{t('practiceSession.challengeWordsTitle')}</Text>
                  <ChallengeWordPills words={challengeWords} tone="practice" />
                </View>
              ) : null}

              <View style={styles.previewCard}>
                <Text style={styles.sectionEyebrow}>{t('practiceSession.previewTitle')}</Text>
                <Text style={styles.previewHint}>
                  {previewUsesLocalizedContent || nativeLanguage === 'english'
                    ? t('practiceSession.previewBody')
                    : t('practiceSession.previewFallbackBody')}
                </Text>
                <View style={[styles.transcriptPanel, { maxHeight: transcriptPanelHeight }]}>
                  <ScrollView
                    nestedScrollEnabled
                    showsVerticalScrollIndicator
                    contentContainerStyle={styles.transcriptScrollContent}
                  >
                    {previewLines.map(item => (
                      <View key={`preview-${item.index}`} style={styles.previewItem}>
                        <Text style={styles.previewPrimary}>{item.translation}</Text>
                        {item.hasLocalizedText ? (
                          <Text style={styles.previewSecondary}>{item.line.en}</Text>
                        ) : null}
                      </View>
                    ))}
                  </ScrollView>
                </View>
              </View>

              {status.errorMessage ? <Text style={styles.practiceErrorText}>{status.errorMessage}</Text> : null}

              <View style={styles.waveRow}>
                {Array.from({ length: 8 }).map((_, index) => (
                  <View
                    key={`wave-${index}`}
                    style={[
                      styles.waveBar,
                      { height: 18 + ((index % 4) + 1) * 9, opacity: status.isPlaying ? 0.95 : 0.4 },
                    ]}
                  />
                ))}
              </View>

              <View style={styles.primaryPlayWrap}>
                <CircularProgressPlayButton
                  progress={clipDurationMillis > 0 ? status.positionMillis / clipDurationMillis : 0}
                  isPlaying={status.isPlaying}
                  onPress={() => {
                    triggerMediumHaptic();
                    if (status.isPlaying) {
                      void pause();
                      return;
                    }
                    const restart = status.positionMillis >= Math.max(0, clipDurationMillis - 300);
                    void playWholeClip(restart ? 0 : status.positionMillis);
                  }}
                  size={80}
                  buttonSize={64}
                  color={colors.accentPractice}
                />
              </View>

              <View style={styles.fullWidthActions}>
                <Pressable
                  onPress={() => {
                    triggerUiFeedback('primary');
                    void pause();
                    setStep(lineCount > 0 ? 2 : 4);
                  }}
                  style={[styles.choiceButton, styles.choiceButtonPrimary]}
                >
                  <Text style={styles.choiceButtonPrimaryText}>{t('common.continue')}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {step === 2 && sentenceLine ? (
            <View style={styles.centerBlock}>
              <View style={styles.previewCard}>
                <Text style={styles.sectionEyebrow}>{t('practiceSession.englishDrillTitle')}</Text>
                <Text style={styles.previewHint}>{t('practiceSession.englishDrillBody')}</Text>
              </View>

              <Text style={styles.progressText}>
                {t('practiceSession.sentenceProgress', { current: sentenceIndex + 1, total: lineCount })}
              </Text>

              <View style={[styles.practiceLineWrap, styles.transcriptPanel]}>
                <ScrollView
                  nestedScrollEnabled
                  showsVerticalScrollIndicator
                  contentContainerStyle={styles.transcriptScrollContent}
                >
                  <WordLine
                    line={sentenceLine}
                    currentTime={status.positionMillis / 1000}
                    isActive
                    showZh={false}
                    compact
                    onWordTap={(word, line) => handleWordTap(word, line.en, line.zh || '', sentenceIndex)}
                  />
                </ScrollView>
              </View>

              {status.errorMessage ? <Text style={styles.practiceErrorText}>{status.errorMessage}</Text> : null}

              <View style={styles.controlsRow}>
                <Pressable
                  onPress={() => {
                    triggerMediumHaptic();
                    void playSentence(sentenceIndex);
                  }}
                  style={styles.secondaryCircle}
                >
                  <Text style={styles.secondaryCircleText}>{t('common.replay')}</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    triggerMediumHaptic();
                    void togglePlay();
                  }}
                  style={styles.secondaryCircle}
                >
                  <Text style={styles.secondaryCircleText}>{status.isPlaying ? t('common.pause') : t('common.play')}</Text>
                </Pressable>
              </View>

              <View style={styles.actionRow}>
                <Pressable
                  onPress={() => {
                    triggerUiFeedback('correct');
                    void pause();
                    moveToNextSentence();
                  }}
                  style={[styles.actionButton, styles.actionButtonEasy]}
                >
                  <Text style={[styles.actionButtonText, styles.actionButtonTextEasy]}>{t('practiceSession.easy')}</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    triggerUiFeedback('error');
                    void pause();
                    const nextHard = hardSentencesRef.current.includes(sentenceIndex)
                      ? hardSentencesRef.current
                      : [...hardSentencesRef.current, sentenceIndex];
                    hardSentencesRef.current = nextHard;
                    setHardSentences(nextHard);
                    moveToNextSentence();
                  }}
                  style={[styles.actionButton, styles.actionButtonHard]}
                >
                  <Text style={[styles.actionButtonText, styles.actionButtonTextHard]}>{t('practiceSession.hard')}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {step === 3 ? (
            <View style={styles.centerBlock}>
              <View style={styles.previewCard}>
                <Text style={styles.sectionEyebrow}>{t('practiceSession.fadeTitle')}</Text>
                <Text style={styles.previewHint}>{t('practiceSession.fadeBody')}</Text>
              </View>

              <View style={styles.fadeCard}>
                {currentLine ? (
                  <View style={styles.fadeSentenceRow}>
                    {fadeSegments.map((segment, index) => {
                      const word = fadeTapWords[index];
                      const visible = segment.visible;
                      return (
                        <Pressable
                          key={segment.key}
                          disabled={!visible || !word}
                          onPress={() => {
                            if (!word || !visible) return;
                            handleWordTap(word, currentLine.en, currentLine.zh || '', currentLineIndex);
                          }}
                        >
                          <Text
                            style={[
                              styles.fadeToken,
                              !visible && styles.fadeTokenMasked,
                              segment.emphasis && styles.fadeTokenEmphasis,
                            ]}
                          >
                            {segment.text}{' '}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={styles.previewHint}>{t('practiceSession.replayPreparing')}</Text>
                )}
              </View>

              {status.errorMessage ? <Text style={styles.practiceErrorText}>{status.errorMessage}</Text> : null}

              <View style={styles.progressWrap}>
                <ProgressBar
                  progress={status.durationMillis > 0 ? status.positionMillis / status.durationMillis : 0}
                  markers={markers}
                  currentSentenceRange={currentSentenceRange}
                  highlightRanges={hardRanges}
                  onSeek={ratio => {
                    if (!soundRef.current || !status.durationMillis) return;
                    const nextRelativeMillis = Math.floor(status.durationMillis * ratio);
                    void soundRef.current.setPositionAsync(
                      Math.floor(clipRelativeToSourceSeconds(clip, nextRelativeMillis / 1000) * 1000)
                    );
                  }}
                />
              </View>

              <View style={styles.controlsRow}>
                <Pressable
                  onPress={() => {
                    triggerMediumHaptic();
                    void playWholeClip(0);
                  }}
                  style={styles.secondaryCircle}
                >
                  <Text style={styles.secondaryCircleText}>{t('common.replay')}</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    triggerMediumHaptic();
                    void togglePlay();
                  }}
                  style={styles.secondaryCircle}
                >
                  <Text style={styles.secondaryCircleText}>{status.isPlaying ? t('common.pause') : t('common.play')}</Text>
                </Pressable>
              </View>

              <View style={styles.fullWidthActions}>
                <Pressable
                  onPress={() => {
                    triggerUiFeedback('primary');
                    void pause();
                    beginBlindStage();
                  }}
                  disabled={!fadePlaybackFinished}
                  style={[
                    styles.choiceButton,
                    styles.choiceButtonPrimary,
                    !fadePlaybackFinished && styles.choiceButtonDisabled,
                  ]}
                >
                  <Text style={styles.choiceButtonPrimaryText}>{t('common.continue')}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {step === 4 ? (
            <View style={styles.centerBlock}>
              <View style={styles.previewCard}>
                <Text style={styles.sectionEyebrow}>{t('practiceSession.blindTitle')}</Text>
                <Text style={styles.previewHint}>{t('practiceSession.blindBody')}</Text>
              </View>

              {status.errorMessage ? <Text style={styles.practiceErrorText}>{status.errorMessage}</Text> : null}

              {!blindListenFinished ? (
                <>
                  <View style={styles.waveRow}>
                    {Array.from({ length: 8 }).map((_, index) => (
                      <View
                        key={`blind-wave-${index}`}
                        style={[
                          styles.waveBar,
                          { height: 18 + ((index % 4) + 1) * 9, opacity: status.isPlaying ? 0.95 : 0.4 },
                        ]}
                      />
                    ))}
                  </View>

                  <View style={styles.progressWrap}>
                    <ProgressBar
                      progress={status.durationMillis > 0 ? status.positionMillis / status.durationMillis : 0}
                      markers={markers}
                      currentSentenceRange={currentSentenceRange}
                      highlightRanges={hardRanges}
                      onSeek={ratio => {
                        if (!soundRef.current || !status.durationMillis) return;
                        const nextRelativeMillis = Math.floor(status.durationMillis * ratio);
                        void soundRef.current.setPositionAsync(
                          Math.floor(clipRelativeToSourceSeconds(clip, nextRelativeMillis / 1000) * 1000)
                        );
                      }}
                    />
                  </View>

                  <View style={styles.controlsRow}>
                    <Pressable
                      onPress={() => {
                        triggerMediumHaptic();
                        void playWholeClip(0);
                      }}
                      style={styles.secondaryCircle}
                    >
                      <Text style={styles.secondaryCircleText}>{t('common.replay')}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        triggerMediumHaptic();
                        void togglePlay();
                      }}
                      style={styles.secondaryCircle}
                    >
                      <Text style={styles.secondaryCircleText}>{status.isPlaying ? t('common.pause') : t('common.play')}</Text>
                    </Pressable>
                  </View>
                </>
              ) : questions.length > 0 && currentQuestion ? (
                <View style={styles.quizCard}>
                  <Text style={styles.compLabel}>
                    {t('practiceSession.quizLabel', { current: quizIndex + 1, total: questions.length })}
                  </Text>
                  <Text style={styles.compQuestion}>{currentQuestion.question}</Text>
                  <View style={styles.compOptions}>
                    {currentQuestion.options.map(option => {
                      const letter = option.trim().charAt(0).toUpperCase();
                      const picked = currentSelection === letter;
                      const answered = Boolean(currentSelection);
                      const isCorrect = letter === currentAnswer;
                      return (
                        <Pressable
                          key={option}
                          disabled={answered}
                          onPress={() => {
                            triggerMediumHaptic();
                            setQuizSelections(prev => ({ ...prev, [quizIndex]: letter }));
                            if (letter === currentAnswer) {
                              setQuizCorrectCount(prev => prev + 1);
                            }
                          }}
                          style={[
                            styles.compOption,
                            answered && isCorrect ? styles.compOptionCorrect : null,
                            answered && picked && !isCorrect ? styles.compOptionWrong : null,
                            answered && !picked && !isCorrect ? styles.compOptionDimmed : null,
                          ]}
                        >
                          <Text style={styles.compOptionText}>
                            {answered && isCorrect ? `✓ ${option}` : option}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {currentSelection ? (
                    <>
                      {currentQuestion.explanation_zh ? (
                        <Text style={styles.compExplanation}>{currentQuestion.explanation_zh}</Text>
                      ) : null}
                      <Pressable
                        onPress={() => {
                          triggerUiFeedback('primary');
                          if (quizIndex >= questions.length - 1) {
                            finishPractice();
                          } else {
                            setQuizIndex(prev => prev + 1);
                          }
                        }}
                        style={styles.compNextButton}
                      >
                        <Text style={styles.compNextButtonText}>
                          {quizIndex >= questions.length - 1
                            ? t('practiceSession.finishPractice')
                            : t('practiceSession.nextQuestion')}
                        </Text>
                      </Pressable>
                    </>
                  ) : null}
                </View>
              ) : (
                <View style={styles.fullWidthActions}>
                  <Text style={styles.hintText}>
                    {t('practiceSession.afterListenCheck')}
                  </Text>
                  <Pressable
                    onPress={() => {
                      triggerUiFeedback('primary');
                      finishPractice();
                    }}
                    style={[styles.choiceButton, styles.choiceButtonPrimary]}
                  >
                    <Text style={styles.choiceButtonPrimaryText}>{t('common.continue')}</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ) : null}

          {step === 5 ? (
            <View style={styles.summaryScreen}>
              <View style={styles.summaryCenter}>
                <Text style={styles.summaryTitle}>{t('practiceSession.summaryTitle')}</Text>
                <View style={styles.summaryRows}>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryValue}>{wordsLooked}</Text>
                    <Text style={styles.summaryLabel}>{t('practiceSession.summaryWords')}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryValue}>{lineCount}</Text>
                    <Text style={styles.summaryLabel}>{t('practiceSession.summarySentences')}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={[styles.summaryValue, styles.summaryValueHard]}>{hardSentences.length}</Text>
                    <Text style={styles.summaryLabel}>{t('practiceSession.summaryHard')}</Text>
                  </View>
                </View>
                {lookedWordsList.length > 0 ? (
                  <View style={styles.summaryWordList}>
                    {lookedWordsList.slice(0, 6).map(item => (
                      <View key={`looked-${item.word}`} style={styles.summaryWordPill}>
                        <Text style={styles.summaryWordText}>{item.word}</Text>
                        {item.cefr ? <Text style={styles.summaryWordBadge}>{item.cefr}</Text> : null}
                      </View>
                    ))}
                  </View>
                ) : null}
                {questions.length > 0 ? (
                  <View style={styles.reviewSection}>
                    <Text style={styles.sectionEyebrow}>{t('practiceSession.quizLabel', { current: quizCorrectCount, total: questions.length })}</Text>
                    <View style={styles.reviewList}>
                      {questions.map((question, index) => {
                        const selection = quizSelections[index] || '';
                        const answer = question.answer?.trim().charAt(0).toUpperCase() || '';
                        const correct = selection === answer;
                        return (
                          <View key={`review-question-${index}`} style={styles.reviewItem}>
                            <Text style={styles.reviewQuestion}>{question.question}</Text>
                            <Text style={[styles.reviewAnswer, !correct && styles.reviewAnswerWrong]}>
                              {correct
                                ? `✓ ${selection || answer}`
                                : `${selection || '—'} → ${answer}`}
                            </Text>
                            {!correct && question.explanation_zh ? (
                              <Text style={styles.reviewExplanation}>{question.explanation_zh}</Text>
                            ) : null}
                          </View>
                        );
                      })}
                    </View>
                  </View>
                ) : null}
                <View style={styles.reviewSection}>
                  <Text style={styles.sectionEyebrow}>{t('practiceSession.previewTitle')}</Text>
                  <View style={[styles.transcriptPanel, { maxHeight: reviewTranscriptHeight }]}>
                    <ScrollView
                      nestedScrollEnabled
                      showsVerticalScrollIndicator
                      contentContainerStyle={styles.transcriptScrollContent}
                    >
                      <View style={styles.reviewList}>
                        {(clip.lines || []).map((line, index) => (
                          <View
                            key={`review-line-${index}-${line.start}`}
                            style={[
                              styles.reviewItem,
                              hardSentences.includes(index) && styles.reviewItemHard,
                            ]}
                          >
                            <Text style={styles.reviewPrimary}>{line.en}</Text>
                            {line.zh ? <Text style={styles.reviewSecondary}>{line.zh}</Text> : null}
                          </View>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                </View>
              </View>
              <View style={styles.summaryActions}>
                <Pressable onPress={() => {
                  triggerUiFeedback('primary');
                  onPracticeAgain();
                }} style={[styles.summaryButton, styles.summaryButtonPrimary]}>
                  <Text style={[styles.summaryButtonText, styles.summaryButtonTextPrimary]}>{t('practiceSession.practiceAnother')}</Text>
                </Pressable>
                <Pressable onPress={() => {
                  triggerUiFeedback('menu');
                  onReturnFeed();
                }} style={styles.summaryButton}>
                  <Text style={styles.summaryButtonText}>{t('practiceSession.backToFeed')}</Text>
                </Pressable>
              </View>
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
                contentKey: clip.contentKey,
                lineIndex: popup.lineIndex ?? undefined,
                clipKey,
                clipTitle: clip.title,
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
    paddingBottom: 8,
    alignItems: 'center',
    zIndex: 2,
  },
  headerInner: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeButton: {
    borderRadius: 999,
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgSurface2,
  },
  closeButtonText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
  stepLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  stepDots: {
    flexDirection: 'row',
    gap: 6,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.textFaint,
  },
  stepDotActive: {
    width: 20,
    borderRadius: 6,
    backgroundColor: colors.accentPractice,
  },
  stepDotDone: {
    backgroundColor: 'rgba(168,85,247,0.5)',
  },
  body: {
    flexGrow: 1,
    paddingBottom: 40,
    justifyContent: 'center',
  },
  centerBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 560,
  },
  sourceCard: {
    width: '100%',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 16,
    backgroundColor: 'rgba(168,85,247,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.24)',
    gap: 6,
  },
  sourceTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '700',
    textAlign: 'center',
  },
  sourceMeta: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
  },
  previewCard: {
    width: '100%',
    marginTop: 18,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: colors.bgSurface1,
    borderWidth: 1,
    borderColor: colors.stroke,
    gap: 10,
  },
  transcriptPanel: {
    width: '100%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.bgApp,
    borderWidth: 1,
    borderColor: colors.stroke,
    overflow: 'hidden',
  },
  transcriptScrollContent: {
    gap: 12,
    paddingBottom: 4,
  },
  sectionEyebrow: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  previewHint: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  previewList: {
    gap: 12,
  },
  previewItem: {
    gap: 4,
  },
  previewPrimary: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
  },
  previewSecondary: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  challengeWordsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  challengeWordPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(168,85,247,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.22)',
  },
  challengeWordText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  challengeWordBadge: {
    color: colors.accentPractice,
    fontSize: 11,
    fontWeight: '700',
  },
  hintText: {
    marginTop: 20,
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
  },
  practiceErrorText: {
    marginTop: 10,
    color: colors.accentError,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  waveRow: {
    marginTop: 32,
    marginBottom: 28,
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  waveBar: {
    width: 5,
    borderRadius: 999,
    backgroundColor: colors.accentPractice,
  },
  primaryPlayWrap: {
    marginBottom: 12,
  },
  choiceRow: {
    marginTop: 36,
    width: '100%',
    gap: 12,
  },
  fullWidthActions: {
    marginTop: 22,
    width: '100%',
    gap: 12,
  },
  choiceButton: {
    borderRadius: 18,
    paddingVertical: 15,
    alignItems: 'center',
    backgroundColor: colors.bgSurface2,
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  choiceButtonPrimary: {
    backgroundColor: colors.accentPractice,
    borderColor: colors.accentPractice,
  },
  choiceButtonDisabled: {
    opacity: 0.45,
  },
  quizStartButton: {
    marginTop: 36,
    width: '100%',
  },
  choiceButtonText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  choiceButtonPrimaryText: {
    color: colors.textOnAccent,
    fontSize: 14,
    fontWeight: '700',
  },
  quizCard: {
    marginTop: 28,
    width: '100%',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 20,
    backgroundColor: colors.bgSurface1,
    borderWidth: 1,
    borderColor: colors.stroke,
    gap: 14,
  },
  compLabel: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    textAlign: 'center',
  },
  compQuestion: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 24,
  },
  compOptions: {
    gap: 10,
  },
  compOption: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.bgSurface2,
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  compOptionCorrect: {
    borderColor: '#4ADE80',
    backgroundColor: 'rgba(74,222,128,0.10)',
  },
  compOptionWrong: {
    borderColor: '#F87171',
    backgroundColor: 'rgba(248,113,113,0.08)',
  },
  compOptionDimmed: {
    opacity: 0.35,
  },
  compOptionText: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  compExplanation: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  compNextButton: {
    alignSelf: 'stretch',
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: colors.accentPractice,
  },
  compNextButtonText: {
    color: colors.textOnAccent,
    fontSize: 14,
    fontWeight: '700',
  },
  quizResultCard: {
    marginTop: 28,
    width: '100%',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 24,
    backgroundColor: colors.bgSurface1,
    borderWidth: 1,
    borderColor: colors.stroke,
    gap: 14,
    alignItems: 'center',
  },
  compResultSub: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '700',
  },
  compResultMsg: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  compRetryText: {
    color: colors.textSecondary,
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  progressText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  practiceLineWrap: {
    marginTop: 24,
    minHeight: 140,
    width: '100%',
  },
  translationToggle: {
    marginTop: 10,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.bgSurface2,
  },
  translationToggleText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
  controlsRow: {
    marginTop: 26,
    flexDirection: 'row',
    gap: 12,
  },
  secondaryCircle: {
    minWidth: 88,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.bgSurface2,
  },
  secondaryCircleText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  actionRow: {
    marginTop: 22,
    width: '100%',
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
  },
  actionButtonEasy: {
    borderColor: 'rgba(76,175,80,0.28)',
    backgroundColor: 'rgba(76,175,80,0.08)',
  },
  actionButtonHard: {
    borderColor: 'rgba(244,67,54,0.28)',
    backgroundColor: 'rgba(244,67,54,0.08)',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  actionButtonTextEasy: {
    color: '#6EE7B7',
  },
  actionButtonTextHard: {
    color: '#FCA5A5',
  },
  flashCard: {
    width: '100%',
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 28,
    backgroundColor: 'rgba(168,85,247,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.22)',
    alignItems: 'center',
  },
  fadeCard: {
    width: '100%',
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 28,
    backgroundColor: 'rgba(168,85,247,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.22)',
    alignItems: 'center',
  },
  flashLabel: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  flashEn: {
    marginTop: 16,
    color: colors.textPrimary,
    fontSize: 20,
    lineHeight: 30,
    textAlign: 'center',
  },
  flashPlayButton: {
    marginTop: 20,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.bgSurface2,
  },
  flashPlayButtonText: {
    color: colors.accentPractice,
    fontSize: 13,
    fontWeight: '700',
  },
  flashHint: {
    marginTop: 12,
    color: colors.textTertiary,
    fontSize: 12,
  },
  flashDivider: {
    width: 46,
    height: 1,
    marginVertical: 18,
    backgroundColor: colors.strokeStrong,
  },
  flashZh: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  flashMeta: {
    marginTop: 14,
    color: colors.textTertiary,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  fadeSentenceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  fadeToken: {
    color: colors.textPrimary,
    fontSize: 22,
    lineHeight: 34,
    fontWeight: '600',
    textAlign: 'center',
  },
  fadeTokenMasked: {
    color: 'transparent',
    backgroundColor: colors.maskBg,
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 2,
    marginHorizontal: 1,
    marginVertical: 2,
  },
  fadeTokenEmphasis: {
    color: colors.accentPractice,
  },
  hardWordsRow: {
    marginTop: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  hardWordPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.bgSurface2,
  },
  hardWordText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  hardWordLevel: {
    color: colors.accentPractice,
    fontSize: 11,
    fontWeight: '700',
  },
  progressWrap: {
    width: '100%',
    marginTop: 22,
  },
  summaryScreen: {
    minHeight: 560,
    width: '100%',
    justifyContent: 'space-between',
  },
  summaryCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
  },
  summaryTitle: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
  },
  summaryRows: {
    gap: 12,
    alignItems: 'center',
  },
  summaryWordList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  summaryWordPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.bgSurface2,
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  summaryWordText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  summaryWordBadge: {
    color: colors.accentPractice,
    fontSize: 11,
    fontWeight: '700',
  },
  reviewSection: {
    width: '100%',
    gap: 10,
  },
  reviewList: {
    width: '100%',
    gap: 10,
  },
  reviewItem: {
    width: '100%',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.bgSurface1,
    borderWidth: 1,
    borderColor: colors.stroke,
    gap: 6,
  },
  reviewItemHard: {
    borderColor: 'rgba(168,85,247,0.35)',
    backgroundColor: 'rgba(168,85,247,0.08)',
  },
  reviewQuestion: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
  },
  reviewAnswer: {
    color: colors.accentPractice,
    fontSize: 13,
    fontWeight: '700',
  },
  reviewAnswerWrong: {
    color: colors.accentError,
  },
  reviewExplanation: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  reviewPrimary: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '600',
  },
  reviewSecondary: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  summaryValue: {
    color: colors.accentPractice,
    fontSize: 28,
    fontWeight: '700',
  },
  summaryValueHard: {
    color: colors.accentError,
  },
  summaryLabel: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  summaryActions: {
    gap: 10,
  },
  summaryButton: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.textFaint,
    backgroundColor: 'transparent',
  },
  summaryButtonPrimary: {
    backgroundColor: colors.accentPractice,
    borderColor: colors.accentPractice,
  },
  summaryButtonText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '500',
  },
  summaryButtonTextPrimary: {
    color: colors.textPrimary,
  },
  });
}
