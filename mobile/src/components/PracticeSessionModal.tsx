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

type StagePlaybackMode = QuizStage | 'blind';

type QuestionBuckets = {
  stage0: ClipQuestion[];
  stage1: ClipQuestion[];
  stage2: ClipQuestion[];
  stage3: ClipQuestion[];
  stage4: ClipQuestion[];
};

type QuizResults = {
  stage0: PracticeTabQuizResult[];
  stage1: PracticeTabQuizResult[];
  stage2: PracticeTabQuizResult[];
  stage3: PracticeTabQuizResult[];
  stage4: PracticeTabQuizResult[];
};

type QuestionFlow = {
  stage: QuizStage;
  index: number;
} | null;

type Props = {
  visible: boolean;
  isActive?: boolean;
  clip: Clip | null;
  clipIndex: number;
  initialStage?: number;
  inline?: boolean;
  level: Level | null;
  nativeLanguage: NativeLanguage;
  vocabWords: string[];
  knownWords: string[];
  completedRecord?: PracticeTabCompletedClip | null;
  readOnly?: boolean;
  onSaveVocab: (entry: VocabEntry) => void;
  onMarkKnown: (word: string) => void;
  onRecordWordLookup: (cefr?: string, details?: { clip?: Clip | null; word?: string }) => void;
  onStageChange: (stage: number) => void;
  onComplete: (completedClip: PracticeTabCompletedClip) => void;
  onDismiss: () => void;
  onNextClip: () => void;
  onReturnListen: () => void;
};

const ATTRIBUTION_REASONS: PracticeTabReason[] = ['unknown', 'unclear', 'meaning'];

function answerIndex(question: ClipQuestion) {
  const normalized = String(question.answer || '').trim().toUpperCase();
  if (/^[A-Z]$/.test(normalized)) {
    return Math.max(0, normalized.charCodeAt(0) - 65);
  }
  if (/^\d+$/.test(normalized)) {
    return Math.max(0, Number(normalized) - 1);
  }
  const optionIndex = (question.options || []).findIndex(option => option.trim().toUpperCase() === normalized);
  return optionIndex >= 0 ? optionIndex : 0;
}

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

function lineCandidateWords(line: Clip['lines'][number]) {
  const seen = new Set<string>();
  return (line.words || []).filter(word => {
    const normalized = word.word.toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    if (!hasReadableCharacters(word.word)) return false;
    seen.add(normalized);
    return true;
  });
}

function explanationForQuestion(
  question: ClipQuestion,
  unavailableMessage: string
) {
  return String(question.explanation_zh || '').trim() || unavailableMessage;
}

function attributionLabel(
  reason: PracticeTabReason,
  t: (key: string, params?: Record<string, string | number>) => string
) {
  if (reason === 'unknown') return t('practiceSession.reasonUnknown');
  if (reason === 'unclear') return t('practiceSession.reasonUnclear');
  return t('practiceSession.reasonMeaning');
}

function deriveStage5ReviewItems(
  clip: Clip,
  selectedVocabPicks: PracticeTabVocabPick[],
  options?: {
    allowFallback?: boolean;
  }
) {
  const pickedItems = selectedVocabPicks.map(item => {
    const line = clip.lines?.[item.sentenceIndex];
    const matchingWord = line?.words?.find(word => word.word.toLowerCase() === item.word.toLowerCase());
    return {
      word: matchingWord?.word || item.word,
      normalizedWord: item.word.toLowerCase(),
      sentenceIndex: item.sentenceIndex,
      line,
      cefr: item.cefr || matchingWord?.cefr,
    };
  }).filter(item => item.line);

  if (pickedItems.length > 0) {
    return pickedItems;
  }

  if (!options?.allowFallback) {
    return [];
  }

  const seen = new Set<string>();
  const fallback: Array<{
    word: string;
    normalizedWord: string;
    sentenceIndex: number;
    line: Clip['lines'][number];
    cefr?: string;
  }> = [];

  clip.lines?.forEach((line, sentenceIndex) => {
    lineCandidateWords(line).forEach(word => {
      const normalizedWord = word.word.toLowerCase();
      if (seen.has(normalizedWord)) return;
      seen.add(normalizedWord);
      fallback.push({
        word: word.word,
        normalizedWord,
        sentenceIndex,
        line,
        cefr: word.cefr,
      });
    });
  });

  return fallback.slice(0, 3);
}

function noop() {}

function practiceDebug(event: string, payload?: Record<string, unknown>) {
  console.log('[practice-inline]', event, payload || {});
}

function normalizeToken(value: string) {
  return String(value || '').replace(/^[^a-zA-Z]+|[^a-zA-Z'-]+$/g, '').toLowerCase();
}

function findActiveOrPreviousLineIndex(clip: Clip | null, timeSeconds: number) {
  if (!clip?.lines?.length) return -1;
  const exactIndex = findLineAtTime(clip, timeSeconds);
  if (exactIndex >= 0) return exactIndex;
  if (timeSeconds >= clip.lines[clip.lines.length - 1].end) {
    return clip.lines.length - 1;
  }
  for (let index = clip.lines.length - 1; index >= 0; index -= 1) {
    if (timeSeconds >= clip.lines[index].start) {
      return index;
    }
  }
  return 0;
}

function buildFadeText(line: Clip['lines'][number], targetWords: Set<string>) {
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

function PlaybackControlStrip({
  uiStyles,
  isPlaying,
  onReplay,
  onRewind,
  onToggle,
  replayLabel,
  pauseLabel,
  playLabel,
}: {
  uiStyles: {
    playbackControlsWrap: object;
    playbackSideButton: object;
    playbackMainButton: object;
  };
  isPlaying: boolean;
  onReplay: () => void;
  onRewind: () => void;
  onToggle: () => void;
  replayLabel: string;
  pauseLabel: string;
  playLabel: string;
}) {
  return (
    <View style={uiStyles.playbackControlsWrap}>
      <ActionButton
        label={replayLabel}
        variant="secondary"
        onPress={onReplay}
        style={uiStyles.playbackSideButton}
      />
      <ActionButton
        label={isPlaying ? pauseLabel : playLabel}
        onPress={onToggle}
        style={uiStyles.playbackMainButton}
      />
      <ActionButton
        label="-3s"
        variant="secondary"
        onPress={onRewind}
        style={uiStyles.playbackSideButton}
      />
    </View>
  );
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
  const [activeQuestionFlow, setActiveQuestionFlow] = useState<QuestionFlow>(null);
  const [currentQuestionSelection, setCurrentQuestionSelection] = useState<number | null>(null);
  const [quizResults, setQuizResults] = useState<QuizResults>({
    stage0: [],
    stage1: [],
    stage2: [],
    stage3: [],
    stage4: [],
  });
  const [shownTranslations, setShownTranslations] = useState<Record<number, boolean>>({});
  const [attributionReasons, setAttributionReasons] = useState<PracticeTabReason[]>([]);
  const [attributionStep, setAttributionStep] = useState<AttributionStep>(null);
  const [selectedVocabPicks, setSelectedVocabPicks] = useState<PracticeTabVocabPick[]>([]);
  const [stage5Decisions, setStage5Decisions] = useState<Record<string, 'learned' | 'review'>>({});
  const [stage5Cursor, setStage5Cursor] = useState(0);
  const [expandedSentenceIndex, setExpandedSentenceIndex] = useState<number | null>(null);
  const [popup, setPopup] = useState<PopupState>(null);

  const clipKey = useMemo(() => {
    if (!clip) return '';
    return buildClipKey(clip, clipIndex);
  }, [clip, clipIndex]);
  const challengeWords = useMemo(
    () => (clip ? deriveChallengeWords(clip, level, knownWords) : []),
    [clip, knownWords, level]
  );
  const previewLines = useMemo(() => {
    return (clip?.lines || []).map((line, index) => ({
      index,
      line,
      localized: nativeLanguage === 'english' ? line.en : line.zh || line.en,
    }));
  }, [clip?.lines, nativeLanguage]);
  const transcriptPanelHeight = Math.min(
    Math.max(metrics.windowHeight * 0.24, 190),
    metrics.isTablet ? 360 : 260
  );
  const transcriptPanelTallHeight = Math.min(
    transcriptPanelHeight + (metrics.isTablet ? 48 : 28),
    metrics.isTablet ? 420 : 300
  );
  const transcriptPanelCompactHeight = Math.max(180, transcriptPanelHeight - 18);

  const alignedPlaybackSeconds = status.positionMillis / 1000;
  const currentLineIndex = findActiveOrPreviousLineIndex(clip, alignedPlaybackSeconds);
  const currentLine = clip?.lines?.[currentLineIndex] || null;
  const fadeTargetWords = useMemo(
    () => new Set(challengeWords.map(item => normalizeToken(item.word))),
    [challengeWords]
  );
  const stagePlaybackFinished = useMemo(() => {
    if (stage !== 1 && stage !== 2 && stage !== 3) {
      return stageAudioFinished;
    }
    const nearEnd = status.durationMillis > 0
      && status.positionMillis >= Math.max(0, status.durationMillis - 180);
    return stageAudioFinished || (nearEnd && !status.isPlaying && !status.isLoading);
  }, [
    stage,
    stageAudioFinished,
    status.durationMillis,
    status.isLoading,
    status.isPlaying,
    status.positionMillis,
  ]);
  const blindStageFinished = blindListenStarted && blindListenFinished;
  const currentQuestionFlow = useMemo<QuestionFlow>(() => {
    if (activeQuestionFlow) return activeQuestionFlow;
    const quizStage = quizStageFromStage(stage);
    if (quizStage === null || quizStage === 0) return null;
    if ((quizStage === 1 || quizStage === 2 || quizStage === 3) && !stagePlaybackFinished) {
      return null;
    }
    if (quizStage === 4 && (!blindStageFinished || attributionStep !== null)) {
      return null;
    }
    const questions = buckets[bucketKey(quizStage)];
    const answered = quizResults[bucketKey(quizStage)].length;
    if (questions.length <= answered) return null;
    return { stage: quizStage, index: answered };
  }, [activeQuestionFlow, attributionStep, blindStageFinished, buckets, quizResults, stage, stagePlaybackFinished]);
  const currentQuestion = useMemo(() => {
    if (!currentQuestionFlow) return null;
    const key = bucketKey(currentQuestionFlow.stage);
    return buckets[key][currentQuestionFlow.index] || null;
  }, [buckets, currentQuestionFlow]);
  const stage1AutoLoading = stage === 1
    && !currentQuestionFlow
    && !stagePlaybackFinished
    && !status.isPlaying
    && (status.isLoading || status.positionMillis <= 120);
  const currentQuestionCorrectIndex = currentQuestion ? answerIndex(currentQuestion) : -1;
  const currentQuestionAnswered = currentQuestionSelection !== null;
  const currentQuestionCorrect = currentQuestionAnswered && currentQuestionSelection === currentQuestionCorrectIndex;
  const currentQuestionCorrectOption = currentQuestion && currentQuestionCorrectIndex >= 0
    ? currentQuestion.options?.[currentQuestionCorrectIndex] || ''
    : '';
  const currentQuestionExplanation = currentQuestion
    ? explanationForQuestion(currentQuestion, t('practiceSession.explanationUnavailable'))
    : '';
  const vocabCandidatesBySentence = useMemo(() => {
    return (clip?.lines || []).map((line, index) => ({
      sentenceIndex: index,
      line,
      words: lineCandidateWords(line),
    })).filter(item => item.words.length > 0);
  }, [clip?.lines]);
  const stage5ReviewItems = useMemo(() => (
    clip
      ? deriveStage5ReviewItems(
          clip,
          selectedVocabPicks,
          { allowFallback: Boolean(readOnly && selectedVocabPicks.length === 0) }
        )
      : []
  ), [clip, readOnly, selectedVocabPicks]);
  const stage5PendingItems = useMemo(
    () => stage5ReviewItems.filter(item => !stage5Decisions[`${item.normalizedWord}:${item.sentenceIndex}`]),
    [stage5Decisions, stage5ReviewItems]
  );
  const activeStage5ReviewItem = stage5ReviewItems.length > 0
    ? stage5ReviewItems[Math.min(stage5Cursor, stage5ReviewItems.length - 1)]
    : null;
  const activeStage5DecisionKey = activeStage5ReviewItem
    ? `${activeStage5ReviewItem.normalizedWord}:${activeStage5ReviewItem.sentenceIndex}`
    : '';

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  useEffect(() => {
    hardSentencesRef.current = hardSentences;
  }, [hardSentences]);

  useEffect(() => {
    wordsLookedRef.current = wordsLooked;
  }, [wordsLooked]);

  useEffect(() => {
    setStage5Cursor(prev => Math.max(0, Math.min(prev, Math.max(0, stage5ReviewItems.length - 1))));
  }, [stage5ReviewItems.length]);

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
    return sourceUrl;
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
    }
    await playWholeClip(status.positionMillis, mode);
  }, [pause, playWholeClip, status.isPlaying, status.positionMillis]);

  const rewindThreeSeconds = useCallback(async () => {
    if (!clip || !soundRef.current) return;
    const clipWindowStartMillis = Math.floor(getClipAudioStartSeconds(clip) * 1000);
    const currentAbsoluteMillis = clipWindowStartMillis + status.positionMillis;
    const nextAbsoluteMillis = Math.max(clipWindowStartMillis, currentAbsoluteMillis - 3000);
    try {
      await soundRef.current.setPositionAsync(nextAbsoluteMillis);
      const seekStatus = await soundRef.current.getStatusAsync();
      handleStatus(seekStatus);
    } catch {
    }
  }, [clip, handleStatus, status.positionMillis]);

  const stageQuestions = useCallback((quizStage: QuizStage) => {
    const key = bucketKey(quizStage);
    return buckets[key];
  }, [buckets]);

  const openNextQuestionIfNeeded = useCallback((quizStage: QuizStage) => {
    const questions = stageQuestions(quizStage);
    const existing = quizResults[bucketKey(quizStage)];
    practiceDebug('open-question-attempt', {
      clipKey,
      stage: quizStage,
      totalQuestions: questions.length,
      answeredQuestions: existing.length,
      visible,
      inline,
    });
    if (questions.length > existing.length) {
      setActiveQuestionFlow({ stage: quizStage, index: existing.length });
      setCurrentQuestionSelection(null);
      practiceDebug('open-question-success', {
        clipKey,
        stage: quizStage,
        questionIndex: existing.length,
      });
      return true;
    }
    practiceDebug('open-question-empty', {
      clipKey,
      stage: quizStage,
      totalQuestions: questions.length,
      answeredQuestions: existing.length,
    });
    return false;
  }, [clipKey, inline, quizResults, stageQuestions, visible]);

  const goToStage = useCallback((nextStage: Stage) => {
    playbackRequestRef.current += 1;
    playbackModeRef.current = null;
    pendingPlaybackRef.current = null;
    stageRunRef.current = '';
    setStage(nextStage);
    setStageAudioFinished(false);
    setBlindListenStarted(false);
    setBlindListenFinished(false);
    setActiveQuestionFlow(null);
    setCurrentQuestionSelection(null);
    setAttributionStep(null);
    setExpandedSentenceIndex(null);
    if (nextStage !== 4) {
      void pause();
    }
  }, [pause]);

  const handleStartStage0Question = useCallback(() => {
    if (!openNextQuestionIfNeeded(0)) {
      goToStage(1);
    }
  }, [goToStage, openNextQuestionIfNeeded]);

  const advanceFromQuizStage = useCallback((quizStage: QuizStage) => {
    if (quizStage === 0) {
      goToStage(1);
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
    setActiveQuestionFlow(null);
    setCurrentQuestionSelection(null);
    setQuizResults({
      stage0: [],
      stage1: [],
      stage2: [],
      stage3: [],
      stage4: [],
    });
    setShownTranslations({});
    setAttributionReasons(readOnly ? (completedRecord?.reasons || []) : []);
    setAttributionStep(null);
    setSelectedVocabPicks(readOnly ? (completedRecord?.vocabPicked || []) : []);
    setStage5Decisions({});
    setStage5Cursor(0);
    setExpandedSentenceIndex(null);
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

  useEffect(() => {
    if (inline && !isActive) return;
    if (!visible || !clip || readOnly) return;
    const runKey = `${clipKey}:${stage}`;
    if (stageRunRef.current === runKey) return;
    stageRunRef.current = runKey;
    if (stage === 0) {
      return;
    }
    if (stage === 1) {
      void startPlaybackForStage(1, 0);
      return;
    }
    if (stage === 2) {
      void startPlaybackForStage(2, 0);
      return;
    }
    if (stage === 3) {
      void startPlaybackForStage(3, 0);
      return;
    }
    if (stage === 4) {
      playbackModeRef.current = null;
      void pause();
      return;
    }
    if (stage === 5) {
      playbackModeRef.current = null;
      void pause();
      return;
    }
    if (stage === 6) {
      playbackModeRef.current = null;
      void pause();
    }
  }, [clip, clipKey, goToStage, inline, isActive, openNextQuestionIfNeeded, pause, readOnly, stage, startPlaybackForStage, visible]);

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

  const handleToggleVocabPick = (word: string, sentenceIndex: number, cefr?: string) => {
    setSelectedVocabPicks(prev => {
      const exists = prev.some(item => item.word === word && item.sentenceIndex === sentenceIndex);
      if (exists) {
        return prev.filter(item => !(item.word === word && item.sentenceIndex === sentenceIndex));
      }
      return [...prev, { word, sentenceIndex, cefr }];
    });
  };

  const handleContinueFromAttribution = () => {
    if (attributionReasons.includes('unknown')) {
      setAttributionStep(2);
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

  const handleConsumeStage5Word = (decision: 'learned' | 'review') => {
    if (!clip || !activeStage5ReviewItem) return;
    const line = activeStage5ReviewItem.line;
    const normalizedWord = activeStage5ReviewItem.normalizedWord;
    onSaveVocab({
      word: normalizedWord,
      cefr: activeStage5ReviewItem.cefr || line?.words?.find(word => word.word.toLowerCase() === normalizedWord)?.cefr,
      context: line?.en || '',
      contextZh: line?.zh || '',
      lineIndex: activeStage5ReviewItem.sentenceIndex,
      clipKey,
      clipTitle: clip.title,
      tag: clip.tag,
      sourceType: 'practice',
      practiced: true,
      reviewStatus: decision,
      known: decision === 'learned',
    });
    if (decision === 'learned') {
      onMarkKnown(normalizedWord);
    }
    setStage5Decisions(prev => {
      const next = {
        ...prev,
        [activeStage5DecisionKey]: decision,
      };
      const nextPendingIndex = stage5ReviewItems.findIndex(item => !next[`${item.normalizedWord}:${item.sentenceIndex}`]);
      if (nextPendingIndex < 0) {
        setTimeout(() => goToStage(6), 0);
      } else {
        setStage5Cursor(nextPendingIndex);
      }
      return next;
    });
  };

  const handleStartBlindListen = useCallback(() => {
    if (status.isPlaying || status.isLoading) return;
    void startPlaybackForStage('blind', 0);
  }, [startPlaybackForStage, status.isLoading, status.isPlaying]);

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
              {currentQuestionCorrect
                ? t('practiceSession.answerCorrectTitle')
                : t('practiceSession.answerIncorrectTitle')}
            </Text>
            {!currentQuestionCorrect && currentQuestionCorrectOption ? (
              <Text style={styles.answerFeedbackMeta}>
                {t('practiceSession.correctAnswerLabel', { answer: currentQuestionCorrectOption })}
              </Text>
            ) : null}
            <Text style={styles.explanationText}>{currentQuestionExplanation}</Text>
          </View>
        ) : null}
      </View>
    );
  }, [
    currentQuestion,
    currentQuestionAnswered,
    currentQuestionCorrect,
    currentQuestionCorrectIndex,
    currentQuestionCorrectOption,
    currentQuestionExplanation,
    currentQuestionFlow?.stage,
    currentQuestionSelection,
    styles.answerFeedbackCard,
    styles.answerFeedbackCardCorrect,
    styles.answerFeedbackCardIncorrect,
    styles.answerFeedbackMeta,
    styles.answerFeedbackTitle,
    styles.answerFeedbackTitleCorrect,
    styles.answerFeedbackTitleIncorrect,
    styles.explanationText,
    styles.inlineQuestionSection,
    styles.optionButton,
    styles.optionButtonCorrect,
    styles.optionButtonIdleLocked,
    styles.optionButtonIncorrect,
    styles.optionButtonSelected,
    styles.optionText,
    styles.optionTextCorrect,
    styles.optionTextIncorrect,
    styles.optionsWrap,
    styles.questionText,
    t,
  ]);

  const playbackProgress = status.durationMillis > 0 ? status.positionMillis / status.durationMillis : 0;
  const activePlaybackLineIndex = findActiveOrPreviousLineIndex(clip, alignedPlaybackSeconds);
  const progressStep = practiceProgressStep(stage);
  const replayableQuizStage = quizStageFromStage(stage);
  const inlineFooterActions = inline ? (
    (() => {
      if (stage === 0) {
        if (currentQuestionFlow?.stage === 0 && currentQuestion) {
          return (
            <ActionButton
              label={t('common.continue')}
              onPress={handleAdvanceQuestion}
              disabled={currentQuestionSelection === null}
            />
          );
        }
        return <ActionButton label={t('practiceSession.startPrediction')} onPress={handleStartStage0Question} />;
      }
      if (stage === 1) {
        if (currentQuestionFlow?.stage === 1 && currentQuestion) {
          return (
            <ActionButton
              label={t('common.continue')}
              onPress={handleAdvanceQuestion}
            />
          );
        }
        return (
          <ActionButton
            label={t('common.continue')}
            onPress={() => goToStage(2)}
            disabled={!stagePlaybackFinished}
          />
        );
      }
      if (stage === 2) {
        return (
          <View style={styles.inlineFooterStack}>
            <PlaybackControlStrip
              uiStyles={styles}
              isPlaying={status.isPlaying}
              onReplay={() => void playWholeClip(0, 2)}
              onRewind={() => void rewindThreeSeconds()}
              onToggle={() => void togglePlay(2)}
              replayLabel={t('common.replay')}
              pauseLabel={t('common.pause')}
              playLabel={t('common.play')}
            />
            {currentQuestionFlow?.stage === 2 && currentQuestion ? (
              <ActionButton
                label={t('common.continue')}
                onPress={handleAdvanceQuestion}
                disabled={!stagePlaybackFinished}
              />
            ) : (
              <ActionButton
                label={t('common.continue')}
                onPress={() => goToStage(3)}
                disabled={!stagePlaybackFinished || status.isPlaying || status.isLoading}
              />
            )}
          </View>
        );
      }
      if (stage === 3) {
        return (
          <View style={styles.inlineFooterStack}>
            <PlaybackControlStrip
              uiStyles={styles}
              isPlaying={status.isPlaying}
              onReplay={() => void playWholeClip(0, 3)}
              onRewind={() => void rewindThreeSeconds()}
              onToggle={() => void togglePlay(3)}
              replayLabel={t('common.replay')}
              pauseLabel={t('common.pause')}
              playLabel={t('common.play')}
            />
            {currentQuestionFlow?.stage === 3 && currentQuestion ? (
              <ActionButton
                label={t('common.continue')}
                onPress={handleAdvanceQuestion}
              />
            ) : (
              <ActionButton
                label={t('common.continue')}
                onPress={() => goToStage(4)}
                disabled={!stagePlaybackFinished}
              />
            )}
          </View>
        );
      }
      if (stage === 4 && blindStageFinished) {
        if (currentQuestionFlow?.stage === 4 && currentQuestion) {
          return (
            <ActionButton
              label={t('common.continue')}
              onPress={handleAdvanceQuestion}
            />
          );
        }
        if (attributionStep === 1) {
          return (
            <View style={styles.inlineFooterStack}>
              <ActionButton
                label={attributionReasons.length === 0 ? t('practiceSession.blindAllClear') : t('common.continue')}
                onPress={handleContinueFromAttribution}
              />
              {attributionReasons.length > 0 ? (
                <ActionButton label={t('practiceSession.blindAllClear')} variant="secondary" onPress={() => goToStage(6)} />
              ) : null}
            </View>
          </View>
        ) : null;
      }
      if (stage === 5) {
        return stage5ReviewItems.length === 0
          ? <ActionButton label={t('common.continue')} onPress={() => goToStage(6)} />
          : null;
      }
      if (stage === 6) {
        return (
          <View style={styles.inlineFooterStack}>
            <ActionButton label={t('practiceSession.finishReturn')} onPress={readOnly ? onReturnListen : onNextClip} />
          </View>
        );
      }
      return null;
    })()
  ) : null;

  if (!clip) return null;

  const selectedWordSaved = popup ? vocabWords.includes(popup.word.word.toLowerCase()) : false;
  const selectedWordKnown = popup ? knownWords.includes(popup.word.word.toLowerCase()) : false;

  const bodyHeader = (
    <View
      style={[
        styles.header,
        {
          paddingTop: inline ? 12 : Math.max(insets.top + 8, 16),
          paddingHorizontal: metrics.pageHorizontalPadding,
        },
      ]}
    >
      <View style={[styles.headerInner, { maxWidth: metrics.modalMaxWidth }]}>
        <Text style={styles.headerTitle}>{clip.title}</Text>
        <Text style={styles.headerMeta}>
          {[getSourceLabel(clip.source), clip.tag ? getLocalizedTopicLabel(clip.tag, t) : ''].filter(Boolean).join(' · ')}
        </Text>
        <StepDots count={5} active={progressStep} />
      </View>
    </View>
  );

  const stageContent = (
    <>
        {stage === 0 ? (
          <View style={styles.stageCard}>
            {currentQuestionFlow?.stage === 0 && currentQuestion ? (
              <GlassCard tone="practice" style={styles.cardBlock}>
                <PracticeCardHeader label={stageLabel(0, t)} />
                {renderQuestionBlock(0)}
              </GlassCard>
            ) : (
              <>
                <GlassCard tone="practice" style={styles.cardBlock}>
                  <PracticeCardHeader label={stageLabel(0, t)} />
                  {challengeWords.length > 0 ? (
                    <ChallengeWordPills words={challengeWords} tone="practice" />
                  ) : null}
                  <Text style={styles.supportText}>{t('practiceSession.previewBody')}</Text>
                </GlassCard>

                <GlassCard tone="practice" style={styles.cardBlock}>
                  <PracticeCardHeader label={t('practiceSession.meaningFirstLabel')} />
                  <View style={[styles.transcriptPanel, { maxHeight: transcriptPanelCompactHeight }]}>
                    <ScrollView nestedScrollEnabled showsVerticalScrollIndicator contentContainerStyle={styles.transcriptScrollContent}>
                      {previewLines.map(item => (
                        <View key={`gist-${item.index}`} style={styles.previewRow}>
                          <Text style={styles.previewPrimary}>{item.localized}</Text>
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                </GlassCard>
              </>
            )}
          </View>
        ) : null}

        {stage === 1 ? (
          <View style={styles.stageCard}>
            <GlassCard tone="practice" style={styles.cardBlock}>
              <PracticeCardHeader label={t('practiceSession.gistLabel')} />
              {currentQuestionFlow?.stage === 1 && currentQuestion ? (
                renderQuestionBlock(1, { onLayout: setStage1QuestionAnchorY })
              ) : (
                <>
                  <Text style={styles.supportText}>{t('practiceSession.gistBody')}</Text>
                  {replayableQuizStage === 1 ? (
                    <View style={styles.stageUtilityRow}>
                      <Pressable
                        onPress={() => handleReplayStage(1)}
                        style={styles.stageReplayButton}
                        hitSlop={8}
                      >
                        <Text style={styles.stageReplayButtonText}>↻ {t('common.replay')}</Text>
                      </Pressable>
                      {stage1AutoLoading ? (
                        <View style={styles.stageUtilitySpinner}>
                          <ActivityIndicator size="small" color={colors.accentPractice} />
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                  <PracticeTranscriptPanel
                    lines={clip.lines || []}
                    currentTime={alignedPlaybackSeconds}
                    maxHeight={transcriptPanelHeight}
                    renderLine={({ index, isActive }) => (
                      <Text
                        style={[
                          styles.previewPrimary,
                          isActive && styles.previewPrimaryActive,
                        ]}
                      >
                        {previewLines[index]?.localized || clip.lines?.[index]?.en || ''}
                      </Text>
                    )}
                  />
                  <View style={styles.heroButtonWrap}>
                    <CircularProgressPlayButton
                      progress={playbackProgress}
                      isPlaying={status.isPlaying}
                      onPress={() => void togglePlay(1)}
                      size={84}
                      buttonSize={68}
                      color={colors.accentPractice}
                    />
                  </View>
                </>
              )}
            </GlassCard>

          </View>
        ) : null}

        {stage === 2 ? (
          <View style={styles.stageCard}>
            <GlassCard tone="practice" style={styles.cardBlock}>
              <PracticeCardHeader label={t('practiceSession.decodeLabel')} />
              {currentQuestionFlow?.stage === 2 && currentQuestion ? (
                renderQuestionBlock(2)
              ) : (
                <>
                  <Text style={styles.supportText}>{t('practiceSession.decodeBody')}</Text>
                  <PracticeTranscriptPanel
                    lines={clip.lines || []}
                    currentTime={alignedPlaybackSeconds}
                    maxHeight={transcriptPanelTallHeight}
                    renderLine={({ line, index, isActive }) => (
                      <Pressable
                        onPress={() => setShownTranslations(prev => ({ ...prev, [index]: !prev[index] }))}
                        style={[
                          styles.decodeLine,
                          isActive && styles.decodeLineActive,
                        ]}
                      >
                        <WordLine
                          line={line}
                          currentTime={isActive ? alignedPlaybackSeconds : 0}
                          isActive={isActive}
                          showZh={Boolean(shownTranslations[index])}
                          compact
                          onWordTap={(word, tappedLine) => handleWordTap(word, tappedLine.en, tappedLine.zh || '', index)}
                        />
                      </Pressable>
                    )}
                  />
                </>
              )}
            </GlassCard>
          </View>
        ) : null}

        {stage === 3 ? (
          <View style={styles.stageCard}>
            {currentQuestionFlow?.stage === 3 && currentQuestion ? null : (
              <GlassCard tone="practice" style={[styles.cardBlock, styles.fadeCard]}>
                <PracticeCardHeader label={t('practiceSession.fadeTitle')} />
                {challengeWords.length > 0 ? (
                  <ChallengeWordPills words={challengeWords} tone="practice" singleRow />
                ) : null}
                <Text style={styles.supportText}>{t('practiceSession.fadeBody')}</Text>
              </GlassCard>
            )}

            <GlassCard tone="practice" style={[styles.cardBlock, styles.fadeTranscriptCard]}>
              <PracticeCardHeader label={t('practiceSession.fadeTitle')} />
              {currentQuestionFlow?.stage === 3 && currentQuestion ? (
                renderQuestionBlock(3)
              ) : (
                <PracticeTranscriptPanel
                  lines={clip.lines || []}
                  currentTime={alignedPlaybackSeconds}
                  maxHeight={Math.max(transcriptPanelHeight, transcriptPanelTallHeight)}
                  renderLine={({ line, isActive }) => {
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
              )}
            </GlassCard>
          </View>
        ) : null}

        {stage === 4 ? (
          <View style={styles.stageCard}>
            {!blindStageFinished ? (
              <GlassCard tone="practice" style={styles.cardBlock}>
                <PracticeCardHeader label={t('practiceSession.blindTitle')} />
                <Text style={styles.supportText}>{t('practiceSession.blindBody')}</Text>
                <View style={styles.heroButtonWrap}>
                  <CircularProgressPlayButton
                    progress={playbackProgress}
                    isPlaying={status.isPlaying}
                    onPress={handleStartBlindListen}
                    size={84}
                    buttonSize={68}
                    color={colors.accentPractice}
                  />
                </View>
                {!blindListenStarted ? (
                  <View style={styles.blindLaunchWrap}>
                    <ActionButton
                      label={t('common.play')}
                      onPress={handleStartBlindListen}
                      style={styles.blindLaunchButton}
                    />
                  </View>
                ) : null}
              </GlassCard>
            ) : currentQuestionFlow?.stage === 4 && currentQuestion ? (
              <GlassCard tone="practice" style={styles.cardBlock}>
                <PracticeCardHeader label={t('practiceSession.blindTitle')} />
                {renderQuestionBlock(4)}
              </GlassCard>
            ) : attributionStep === 1 ? (
              <GlassCard tone="practice" style={styles.cardBlock}>
                <PracticeCardHeader label={t('practiceSession.attributionTitle')} />
                <Text style={styles.supportText}>{t('practiceSession.attributionBody')}</Text>
                <View style={styles.reasonGrid}>
                  {ATTRIBUTION_REASONS.map(reason => (
                    <Pressable
                      key={reason}
                      onPress={() => handleToggleReason(reason)}
                      style={[
                        styles.reasonChip,
                        attributionReasons.includes(reason) && styles.reasonChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.reasonChipText,
                          attributionReasons.includes(reason) && styles.reasonChipTextActive,
                        ]}
                      >
                        {attributionLabel(reason, t)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </GlassCard>
            ) : (
              <GlassCard tone="practice" style={styles.cardBlock}>
                <PracticeCardHeader label={t('practiceSession.wordDrillTitle')} />
                <Text style={styles.supportText}>{t('practiceSession.wordDrillBody')}</Text>
                <View style={[styles.transcriptPanel, { maxHeight: transcriptPanelTallHeight }]}>
                  <ScrollView nestedScrollEnabled showsVerticalScrollIndicator contentContainerStyle={styles.transcriptScrollContent}>
                    {vocabCandidatesBySentence.map(({ sentenceIndex, line, words }) => (
                      <View key={`candidate-${sentenceIndex}`} style={styles.candidateBlock}>
                        <Pressable
                          onPress={() => setExpandedSentenceIndex(prev => (prev === sentenceIndex ? null : sentenceIndex))}
                          style={styles.candidateHeader}
                        >
                          <Text style={styles.candidateSentence}>{line.en}</Text>
                        </Pressable>
                        {expandedSentenceIndex === sentenceIndex ? (
                          <View style={styles.candidateWordWrap}>
                            {words.map(word => {
                              const picked = selectedVocabPicks.some(
                                item => item.word === word.word.toLowerCase() && item.sentenceIndex === sentenceIndex
                              );
                              const cefr = String(word.cefr || '').toUpperCase();
                              const showCefr = cefr === 'B1' || cefr === 'B2' || cefr === 'C1' || cefr === 'C2';
                              return (
                                <Pressable
                                  key={`${sentenceIndex}-${word.word}`}
                                  onPress={() => handleToggleVocabPick(word.word.toLowerCase(), sentenceIndex, word.cefr)}
                                  style={[styles.wordChip, picked && styles.wordChipActive]}
                                >
                                  <Text style={[styles.wordChipText, picked && styles.wordChipTextActive]}>
                                    {word.word}
                                  </Text>
                                  {showCefr ? (
                                    <Text style={[styles.wordChipCefr, picked && styles.wordChipTextActive]}>
                                      {cefr}
                                    </Text>
                                  ) : null}
                                </Pressable>
                              );
                            })}
                          </View>
                        ) : null}
                      </View>
                    ))}
                  </ScrollView>
                </View>
              </View>

        {stage === 5 ? (
          <View style={styles.stageCard}>
            <GlassCard tone="practice" style={styles.cardBlock}>
              <PracticeCardHeader label={t('practiceSession.vocabConsumeTitle')} />
              <Text style={styles.supportText}>{t('practiceSession.vocabConsumeBody')}</Text>
              {activeStage5ReviewItem ? (
                <View style={[styles.transcriptPanel, styles.vocabWorkspace, { maxHeight: transcriptPanelTallHeight }]}>
                  <View style={styles.vocabWorkspaceInner}>
                    <View style={styles.vocabWorkspaceBanner}>
                      <Text style={styles.vocabWorkspaceBannerText}>
                        {t('practiceSession.vocabConsumedCount', {
                          current: stage5ReviewItems.length - stage5PendingItems.length + 1,
                          total: stage5ReviewItems.length,
                        })}
                      </Text>
                    </View>
                    <GlassCard style={styles.vocabReviewCard}>
                      <Text style={styles.vocabWord}>
                        {activeStage5ReviewItem.word}
                        {activeStage5ReviewItem.cefr ? (
                          <Text style={styles.vocabWordCefr}> {activeStage5ReviewItem.cefr}</Text>
                        ) : null}
                      </Text>
                      {stage5Translations[activeStage5ReviewItem.normalizedWord] ? (
                        <Text style={styles.vocabWordTranslation}>
                          {stage5Translations[activeStage5ReviewItem.normalizedWord]}
                        </Text>
                      ) : null}
                      <View style={styles.vocabContextBlock}>
                        <Text style={styles.vocabContext}>{activeStage5ReviewItem.line?.en || ''}</Text>
                        {activeStage5ReviewItem.line?.zh ? (
                          <Text style={styles.vocabContextZh}>{activeStage5ReviewItem.line.zh}</Text>
                        ) : null}
                      </View>
                      <View style={[styles.controlsRow, styles.vocabCardActions]}>
                        <ActionButton
                          label={t('practiceSession.rememberedLabel')}
                          onPress={() => handleConsumeStage5Word('learned')}
                        />
                        <ActionButton
                          label={t('practiceSession.reviewAgainLabel')}
                          variant="secondary"
                          onPress={() => handleConsumeStage5Word('review')}
                        />
                      </View>
                    </GlassCard>
                  </View>
                </View>
              ) : (
                <View style={styles.emptyStateCard}>
                  <Text style={styles.supportText}>{t('practiceSession.vocabReviewBody')}</Text>
                </View>
              )}
            </GlassCard>
          </View>
        ) : null}

        {stage === 6 ? (
          <View style={styles.stageCard}>
            <GlassCard tone="practice" style={styles.cardBlock}>
              <PracticeCardHeader label={t('practice.completedTitle')} />
              <Text style={styles.questionText}>{clip.title}</Text>
              <Text style={styles.supportText}>
                {completedRecord
                  ? new Date(completedRecord.completedAt).toLocaleDateString()
                  : t('practiceSession.clipFinishedBody')}
              </Text>
            </GlassCard>

            <GlassCard tone="practice" style={styles.cardBlock}>
              <PracticeCardHeader label={t('practiceSession.transcriptTitle')} />
              <View style={[styles.transcriptPanel, { maxHeight: transcriptPanelTallHeight }]}>
                <ScrollView nestedScrollEnabled showsVerticalScrollIndicator contentContainerStyle={styles.transcriptScrollContent}>
                  {(clip.lines || []).map((line, index) => (
                    <View key={`summary-${index}`} style={styles.summaryLine}>
                      <Text style={styles.summaryPrimary}>{line.en}</Text>
                      <Text style={styles.summarySecondary}>{line.zh || ''}</Text>
                    </View>
                  ))}
                </ScrollView>
              </View>
            </GlassCard>

            {(completedRecord?.reasons?.length || attributionReasons.length > 0) ? (
              <GlassCard tone="practice" style={styles.cardBlock}>
                <PracticeCardHeader label={t('practiceSession.attributionTitle')} />
                <View style={styles.reasonSummaryWrap}>
                  {(completedRecord?.reasons || attributionReasons).map(reason => (
                    <View key={`summary-reason-${reason}`} style={styles.reasonSummaryChip}>
                      <Text style={styles.reasonSummaryText}>{attributionLabel(reason, t)}</Text>
                    </View>
                  ))}
                </View>
              </GlassCard>
            ) : null}

            {(completedRecord?.vocabPicked?.length || selectedVocabPicks.length > 0) ? (
              <GlassCard tone="practice" style={styles.cardBlock}>
                <PracticeCardHeader label={t('practiceSession.pickedWordsTitle')} />
                <View style={styles.reasonSummaryWrap}>
                  {(completedRecord?.vocabPicked || selectedVocabPicks).map(item => (
                    <View key={`summary-word-${item.word}-${item.sentenceIndex}`} style={styles.reasonSummaryChip}>
                      <Text style={styles.reasonSummaryText}>{item.word}</Text>
                    </View>
                  ))}
                </View>
              </GlassCard>
            ) : null}

            {!inline ? (
              <View style={styles.buttonStack}>
                {readOnly ? (
                  <ActionButton label={t('practiceSession.finishReturn')} onPress={onReturnListen} />
                ) : (
                  <ActionButton label={t('practiceSession.finishReturn')} onPress={onNextClip} />
                )}
                <ActionButton label={t('common.close')} variant="secondary" onPress={onDismiss} />
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
            onSave={info => {
              onSaveVocab({
                word: popup.word.word.toLowerCase(),
                cefr: popup.word.cefr,
                phonetic: info?.phonetic || '',
                definitionZh: info?.definition || '',
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
    inlineRoot: {
      flex: 1,
      minHeight: 0,
      overflow: 'hidden',
      backgroundColor: colors.bgApp,
    },
    safeArea: {
      flex: 1,
      backgroundColor: colors.bgApp,
    },
    header: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.stroke,
      backgroundColor: colors.bgApp,
    },
    headerInner: {
      width: '100%',
      alignSelf: 'center',
      gap: 8,
      paddingBottom: 12,
    },
    headerTitle: {
      color: colors.textPrimary,
      fontSize: 20,
      fontWeight: '700',
    },
    headerMeta: {
      color: colors.textSecondary,
      fontSize: 13,
    },
    body: {
      gap: 14,
      paddingTop: 14,
      width: '100%',
    },
    bodyInline: {
      minHeight: '100%',
    },
    bodyInlineScroller: {
      flex: 1,
      minHeight: 0,
    },
    stageCard: {
      gap: 12,
    },
    cardBlock: {
      gap: 12,
    },
    eyebrow: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
      supportText: {
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 21,
    },
    stageUtilityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-start',
      gap: 10,
      marginTop: -2,
      marginBottom: 2,
    },
    stageUtilitySpinner: {
      height: 32,
      justifyContent: 'center',
    },
    stageReplayButton: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.strokeStrong,
      backgroundColor: colors.bgSurface2,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    stageReplayButtonText: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
    },
    transcriptPanel: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.strokeStrong,
      backgroundColor: colors.bgSurface2,
      overflow: 'hidden',
    },
    transcriptScrollContent: {
      gap: 12,
      padding: 16,
    },
    scrollCueWrap: {
      alignItems: 'center',
      paddingTop: 10,
      paddingBottom: 4,
    },
    scrollCue: {
      width: 42,
      height: 5,
      borderRadius: 999,
      backgroundColor: colors.strokeStrong,
      opacity: 0.9,
    },
    previewRow: {
      gap: 6,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    previewRowActive: {
      borderColor: colors.accentPractice,
      backgroundColor: `${colors.accentPractice}14`,
    },
    previewPrimary: {
      color: colors.textPrimary,
      fontSize: 20,
      lineHeight: 30,
      fontWeight: '600',
    },
    previewPrimaryActive: {
      color: colors.accentPractice,
    },
    heroButtonWrap: {
      alignItems: 'center',
      paddingTop: 10,
      paddingBottom: 4,
    },
    inlineQuestionSection: {
      gap: 12,
      paddingTop: 4,
      paddingHorizontal: 14,
      paddingVertical: 14,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.strokeStrong,
      backgroundColor: colors.bgSurface2,
    },
    inlineQuestionDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.stroke,
      marginTop: 2,
      marginBottom: 2,
    },
    blindLaunchWrap: {
      alignItems: 'center',
      paddingTop: 4,
    },
    blindLaunchButton: {
      width: '100%',
      maxWidth: 188,
    },
    questionText: {
      color: colors.textPrimary,
      fontSize: 18,
      lineHeight: 26,
      fontWeight: '700',
    },
    optionsWrap: {
      gap: 10,
    },
    optionButton: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.strokeStrong,
      backgroundColor: colors.bgSurface3,
      paddingHorizontal: 14,
      paddingVertical: 14,
    },
    optionButtonSelected: {
      borderColor: colors.accentPractice,
      backgroundColor: `${colors.accentPractice}18`,
    },
    optionButtonCorrect: {
      borderColor: colors.accentSuccess,
      backgroundColor: `${colors.accentSuccess}16`,
    },
    optionButtonIncorrect: {
      borderColor: colors.accentError,
      backgroundColor: `${colors.accentError}14`,
    },
    optionButtonIdleLocked: {
      opacity: 0.72,
    },
    optionText: {
      color: colors.textPrimary,
      fontSize: 15,
      lineHeight: 22,
      fontWeight: '600',
    },
    optionTextCorrect: {
      color: colors.accentSuccess,
    },
    optionTextIncorrect: {
      color: colors.accentError,
    },
    answerFeedbackCard: {
      borderRadius: 16,
      borderWidth: 1,
      paddingHorizontal: 14,
      paddingVertical: 14,
      gap: 6,
    },
    answerFeedbackCardCorrect: {
      borderColor: `${colors.accentSuccess}55`,
      backgroundColor: `${colors.accentSuccess}12`,
    },
    answerFeedbackCardIncorrect: {
      borderColor: `${colors.accentError}55`,
      backgroundColor: `${colors.accentError}10`,
    },
    answerFeedbackTitle: {
      fontSize: 15,
      lineHeight: 22,
      fontWeight: '800',
    },
    answerFeedbackTitleCorrect: {
      color: colors.accentSuccess,
    },
    answerFeedbackTitleIncorrect: {
      color: colors.accentError,
    },
    answerFeedbackMeta: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: '600',
    },
    explanationText: {
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 21,
    },
    controlsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    playbackControlsWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      alignSelf: 'center',
      width: '100%',
      maxWidth: 420,
    },
    playbackSideButton: {
      flex: 1,
      minWidth: 88,
      maxWidth: 104,
    },
    playbackMainButton: {
      flex: 1.35,
      minWidth: 124,
      maxWidth: 164,
    },
    inlineFooter: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.stroke,
      backgroundColor: colors.bgApp,
      paddingTop: 10,
      alignItems: 'center',
    },
    inlineFooterInner: {
      width: '100%',
      alignSelf: 'center',
    },
    inlineFooterStack: {
      gap: 10,
    },
    decodeLine: {
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    decodeLineActive: {
      borderColor: colors.accentPractice,
      backgroundColor: `${colors.accentPractice}14`,
    },
    fadeCard: {
      backgroundColor: 'rgba(168,85,247,0.10)',
      borderColor: 'rgba(168,85,247,0.22)',
    },
    fadeTranscriptCard: {
      backgroundColor: colors.bgSurface1,
    },
    fadeLineBlock: {
      gap: 4,
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
    fadeToken: {
      color: colors.textPrimary,
    },
    fadeTokenEmphasis: {
      color: '#D8B4FE',
    },
    fadeTokenMasked: {
      color: colors.textTertiary,
    },
    reasonGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    reasonChip: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.stroke,
      backgroundColor: colors.bgSurface1,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    reasonChipActive: {
      backgroundColor: `${colors.accentPractice}18`,
      borderColor: colors.accentPractice,
    },
    reasonChipText: {
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '600',
    },
    reasonChipTextActive: {
      color: colors.accentPractice,
    },
    buttonStack: {
      gap: 10,
    },
    candidateBlock: {
      gap: 10,
      paddingBottom: 4,
    },
    candidateHeader: {
      borderRadius: 12,
      backgroundColor: colors.bgSurface2,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    candidateSentence: {
      color: colors.textPrimary,
      fontSize: 15,
      lineHeight: 22,
      fontWeight: '600',
    },
    candidateWordWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    wordChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.stroke,
      backgroundColor: colors.bgSurface1,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    wordChipActive: {
      backgroundColor: `${colors.accentPractice}18`,
      borderColor: colors.accentPractice,
    },
    wordChipText: {
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '600',
    },
    wordChipTextActive: {
      color: colors.accentPractice,
    },
    wordChipCefr: {
      color: colors.textTertiary,
      fontSize: 10,
      lineHeight: 12,
      fontWeight: '800',
      letterSpacing: 0.4,
    },
    vocabWorkspace: {
      backgroundColor: `${colors.accentPractice}10`,
      borderColor: `${colors.accentPractice}45`,
      borderWidth: 1.5,
    },
    vocabWorkspaceScrollContent: {
      paddingTop: 8,
      gap: 12,
      paddingHorizontal: 16,
      paddingBottom: 16,
    },
    vocabWorkspaceInner: {
      gap: 12,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: `${colors.strokeStrong}CC`,
      backgroundColor: colors.bgSurface2,
      padding: 12,
    },
    vocabWorkspaceBanner: {
      alignSelf: 'flex-start',
      borderRadius: 999,
      backgroundColor: `${colors.accentPractice}18`,
      borderWidth: 1,
      borderColor: `${colors.accentPractice}38`,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    vocabWorkspaceBannerText: {
      color: colors.accentPractice,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '700',
      letterSpacing: 0.3,
    },
    vocabReviewList: {
      gap: 12,
    },
    vocabReviewCard: {
      gap: 10,
      backgroundColor: colors.bgApp,
      borderWidth: 1.5,
      borderColor: `${colors.strokeStrong}EE`,
      shadowColor: colors.textPrimary,
      shadowOpacity: 0.08,
      shadowOffset: { width: 0, height: 8 },
      shadowRadius: 16,
      elevation: 2,
    },
    vocabWord: {
      color: colors.textPrimary,
      fontSize: 20,
      fontWeight: '700',
    },
    vocabWordCefr: {
      color: colors.textTertiary,
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 0.4,
    },
    vocabWordTranslation: {
      color: colors.accentPractice,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '600',
      marginTop: -4,
    },
    vocabContext: {
      color: colors.textPrimary,
      fontSize: 15,
      lineHeight: 22,
    },
    vocabContextBlock: {
      gap: 6,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.stroke,
      backgroundColor: colors.bgSurface2,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    vocabContextZh: {
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 21,
    },
    vocabCardActions: {
      paddingTop: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.stroke,
    },
    emptyStateCard: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.stroke,
      backgroundColor: colors.bgSurface2,
      paddingHorizontal: 14,
      paddingVertical: 16,
    },
    summaryLine: {
      gap: 6,
      paddingBottom: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.stroke,
    },
    summaryPrimary: {
      color: colors.textPrimary,
      fontSize: 18,
      lineHeight: 26,
      fontWeight: '600',
    },
    summarySecondary: {
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 21,
    },
    reasonSummaryWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    reasonSummaryChip: {
      borderRadius: 999,
      backgroundColor: colors.bgSurface1,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    reasonSummaryText: {
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '600',
    },
    footer: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.stroke,
      backgroundColor: colors.bgApp,
      paddingTop: 12,
    },
    footerButton: {
      alignSelf: 'center',
      width: '100%',
      maxWidth: 520,
    },
  });
}
