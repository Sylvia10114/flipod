import * as FileSystem from 'expo-file-system';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  buildClipKey,
  clipRelativeToSourceSeconds,
  findLineAtTime,
  getClipDurationSeconds,
  getClipAudioEndSeconds,
  getClipAudioStartSeconds,
  getSourceLabel,
  resolveClipAudioUrl,
} from '../clip-utils';
import { ActionButton, GlassCard, StepDots } from './AppChrome';
import { ChallengeWordPills } from './ChallengeWordPills';
import { CircularProgressPlayButton } from './CircularProgressPlayButton';
import { deriveChallengeWords } from '../learning-scaffold';
import { triggerMediumHaptic, triggerUiFeedback } from '../feedback';
import { useUiI18n } from '../i18n';
import { getLocalizedTopicLabel } from '../i18n/helpers';
import { useResponsiveLayout } from '../responsive';
import { useAppTheme } from '../theme';
import type {
  Clip,
  ClipLineWord,
  ClipQuestion,
  Level,
  NativeLanguage,
  PracticeTabCompletedClip,
  PracticeTabQuizResult,
  PracticeTabReason,
  PracticeTabVocabPick,
  VocabEntry,
} from '../types';
import { WordLine } from './WordLine';
import { WordPopup } from './WordPopup';
import { PracticeCardHeader } from './generated-practice/PracticeCardHeader';
import { PracticeTranscriptPanel } from './generated-practice/PracticeTranscriptPanel';
import { fetchWordTranslation } from '../word-translation';

type Stage = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type QuizStage = 0 | 1 | 2 | 3 | 4;
type AttributionStep = 1 | 2 | null;

type PopupState = {
  word: ClipLineWord;
  contextEn: string;
  contextZh: string;
  lineIndex: number;
} | null;

type PendingPlayback = {
  targetStartMillis: number;
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

function hashPracticeAudioKey(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

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

function stageLabel(stage: Stage, t: (key: string, params?: Record<string, string | number>) => string) {
  if (stage === 0) return t('practiceSession.previewTitle');
  if (stage === 1) return t('practiceSession.gistLabel');
  if (stage === 2) return t('practiceSession.decodeLabel');
  if (stage === 3) return t('practiceSession.fadeTitle');
  if (stage === 4) return t('practiceSession.blindTitle');
  if (stage === 5) return t('practiceSession.vocabReviewTitle');
  return t('practiceSession.finishPractice');
}

function practiceProgressStep(stage: Stage) {
  if (stage <= 1) return 1;
  if (stage === 2) return 2;
  if (stage === 3) return 3;
  if (stage === 4) return 4;
  return 5;
}

function bucketKey(stage: QuizStage) {
  if (stage === 0) return 'stage0';
  if (stage === 1) return 'stage1';
  if (stage === 2) return 'stage2';
  if (stage === 3) return 'stage3';
  return 'stage4';
}

function quizStageFromStage(stage: Stage): QuizStage | null {
  if (stage === 0) return 0;
  if (stage === 1) return 1;
  if (stage === 2) return 2;
  if (stage === 3) return 3;
  if (stage === 4) return 4;
  return null;
}

function questionBuckets(clip: Clip | null): QuestionBuckets {
  const buckets: QuestionBuckets = {
    stage0: [],
    stage1: [],
    stage2: [],
    stage3: [],
    stage4: [],
  };

  (clip?.questions || []).forEach((question, index) => {
    if (typeof question.stage === 'number') {
      if (question.stage === 0) buckets.stage0.push(question);
      else if (question.stage === 1) buckets.stage1.push(question);
      else if (question.stage === 2) buckets.stage2.push(question);
      else if (question.stage === 3) buckets.stage3.push(question);
      else buckets.stage4.push(question);
      return;
    }

    if (index === 0) buckets.stage0.push(question);
    else if (index === 1) buckets.stage1.push(question);
    else if (index === 2) buckets.stage2.push(question);
    else if (index === 3) buckets.stage3.push(question);
    else buckets.stage4.push(question);
  });

  return buckets;
}

function hasReadableCharacters(value: string) {
  return /[A-Za-z]/.test(value);
}

function lineCandidateWords(line: Clip['lines'][number], knownWords: string[]) {
  const known = new Set(knownWords.map(item => item.toLowerCase()));
  const seen = new Set<string>();
  return (line.words || []).filter(word => {
    const normalized = word.word.toLowerCase();
    if (!normalized || seen.has(normalized) || known.has(normalized)) return false;
    if (!hasReadableCharacters(word.word)) return false;
    const cefr = String(word.cefr || '').toUpperCase();
    const advanced = cefr === 'B2' || cefr === 'C1' || cefr === 'C2';
    if (!advanced && word.word.length < 8) return false;
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
  knownWords: string[],
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
      cefr: matchingWord?.cefr,
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
    lineCandidateWords(line, knownWords).forEach(word => {
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
  isActive = true,
  clip,
  clipIndex,
  initialStage = 0,
  inline = false,
  level,
  nativeLanguage,
  vocabWords,
  knownWords,
  completedRecord = null,
  readOnly = false,
  onSaveVocab,
  onMarkKnown,
  onRecordWordLookup,
  onStageChange,
  onComplete,
  onDismiss,
  onNextClip,
  onReturnListen,
}: Props) {
  const { colors } = useAppTheme();
  const { t } = useUiI18n();
  const metrics = useResponsiveLayout();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const soundRef = useRef<Audio.Sound | null>(null);
  const onStageChangeRef = useRef(onStageChange);
  const onPlaybackEndedRef = useRef<(mode: StagePlaybackMode) => void>(noop);
  const bodyScrollRef = useRef<ScrollView | null>(null);
  const loadSoundRef = useRef<() => Promise<boolean>>(async () => false);
  const unloadSoundRef = useRef<() => Promise<void>>(async () => {});
  const soundReadyRef = useRef(false);
  const preparedAudioUriRef = useRef<string | null>(null);
  const preparedAudioKeyRef = useRef('');
  const prepareAudioPromiseRef = useRef<Promise<string | null> | null>(null);
  const loadPromiseRef = useRef<Promise<boolean> | null>(null);
  const playbackRequestRef = useRef(0);
  const playbackModeRef = useRef<StagePlaybackMode | null>(null);
  const pendingPlaybackRef = useRef<PendingPlayback | null>(null);
  const completionSavedRef = useRef(false);
  const stageRunRef = useRef('');

  const [stage, setStage] = useState<Stage>(readOnly ? 6 : (Math.max(0, Math.min(initialStage, 6)) as Stage));
  const [status, setStatus] = useState({
    isPlaying: false,
    isLoading: false,
    positionMillis: 0,
    durationMillis: 0,
    errorMessage: null as string | null,
  });
  const [stageAudioFinished, setStageAudioFinished] = useState(false);
  const [blindListenStarted, setBlindListenStarted] = useState(false);
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
  const [expandedSentenceIndex, setExpandedSentenceIndex] = useState<number | null>(null);
  const [popup, setPopup] = useState<PopupState>(null);
  const [stage1QuestionAnchorY, setStage1QuestionAnchorY] = useState<number | null>(null);
  const [stage5Translations, setStage5Translations] = useState<Record<string, string>>({});

  const clipKey = useMemo(() => (clip ? buildClipKey(clip, clipIndex) : ''), [clip, clipIndex]);
  const buckets = useMemo(() => questionBuckets(clip), [clip]);
  const challengeWords = useMemo(
    () => (clip ? deriveChallengeWords(clip, level, knownWords).slice(0, 3) : []),
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
      words: lineCandidateWords(line, knownWords),
    })).filter(item => item.words.length > 0);
  }, [clip?.lines, knownWords]);
  const stage5ReviewItems = useMemo(() => (
    clip
      ? deriveStage5ReviewItems(
          clip,
          selectedVocabPicks,
          knownWords,
          { allowFallback: Boolean(readOnly && selectedVocabPicks.length === 0) }
        )
      : []
  ), [clip, knownWords, readOnly, selectedVocabPicks]);

  useEffect(() => {
    if (nativeLanguage === 'english' || stage5ReviewItems.length === 0) {
      setStage5Translations({});
      return;
    }

    let cancelled = false;
    const uniqueWords = [...new Set(stage5ReviewItems.map(item => item.word.trim()).filter(Boolean))];

    void Promise.all(
      uniqueWords.map(async word => [word, await fetchWordTranslation(word, nativeLanguage)] as const)
    ).then(entries => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      entries.forEach(([word, translation]) => {
        if (translation) {
          next[word.toLowerCase()] = translation;
        }
      });
      setStage5Translations(next);
    });

    return () => {
      cancelled = true;
    };
  }, [nativeLanguage, stage5ReviewItems]);

  const unloadSound = useCallback(async () => {
    soundReadyRef.current = false;
    playbackModeRef.current = null;
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
        prepareAudioPromiseRef.current = null;
      }
    })();

    prepareAudioPromiseRef.current = currentPrepare;
    return currentPrepare;
  }, [clip]);

  const handleStatus = useCallback((nextStatus: AVPlaybackStatus) => {
    if (!clip) return;
    if (!nextStatus.isLoaded) {
      setStatus(prev => ({
        ...prev,
        isLoading: false,
        isPlaying: false,
        errorMessage: nextStatus.error ? t('practiceSession.loadError') : prev.errorMessage,
      }));
      return;
    }

    const clipWindowStartMillis = Math.floor(getClipAudioStartSeconds(clip) * 1000);
    const clipWindowEndMillis = Math.floor(getClipAudioEndSeconds(clip) * 1000);
    const clipDurationMillis = Math.floor(getClipDurationSeconds(clip) * 1000);
    const relativePositionMillis = Math.max(0, nextStatus.positionMillis - clipWindowStartMillis);

    if (pendingPlaybackRef.current) {
      const deltaFromTarget = nextStatus.positionMillis - pendingPlaybackRef.current.targetStartMillis;
      const settled = Math.abs(deltaFromTarget) <= 400
        || (deltaFromTarget > 0 && deltaFromTarget <= 1200);
      if (!settled) return;
      pendingPlaybackRef.current = null;
    }

    const reachedClipEnd = clipWindowEndMillis > clipWindowStartMillis
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

    if (reachedClipEnd || nextStatus.didJustFinish) {
      const mode = playbackModeRef.current;
      playbackModeRef.current = null;
      if (mode) {
        // Only unlock the next question flow for the playback run that this stage started.
        setStageAudioFinished(true);
        onPlaybackEndedRef.current(mode);
      }
    }
  }, [clip, t]);

  const loadSound = useCallback(async () => {
    if (!clip || !visible || readOnly) return false;
    if (soundRef.current && soundReadyRef.current) {
      return true;
    }
    if (loadPromiseRef.current) {
      return loadPromiseRef.current;
    }

    setStatus(prev => ({ ...prev, isLoading: true, errorMessage: null }));
    const preparedAudioUri = await ensurePreparedAudioUri();
    if (!preparedAudioUri) {
      setStatus(prev => ({
        ...prev,
        isLoading: false,
        errorMessage: t('practiceSession.noAudio'),
      }));
      return false;
    }

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
            progressUpdateIntervalMillis: 240,
            positionMillis: Math.floor(getClipAudioStartSeconds(clip) * 1000),
          }
        );
        await sound.setProgressUpdateIntervalAsync(240);
        soundReadyRef.current = true;
        const initialStatus = await sound.getStatusAsync();
        handleStatus(initialStatus);
        return true;
      } catch {
        try {
          await sound.unloadAsync();
        } catch {
        }
        sound.setOnPlaybackStatusUpdate(null);
        if (soundRef.current === sound) {
          soundRef.current = null;
        }
        setStatus(prev => ({
          ...prev,
          isPlaying: false,
          isLoading: false,
          errorMessage: t('practiceSession.loadError'),
        }));
        return false;
      } finally {
        loadPromiseRef.current = null;
      }
    })();

    loadPromiseRef.current = currentLoad;
    return currentLoad;
  }, [clip, ensurePreparedAudioUri, handleStatus, readOnly, t, unloadSound, visible]);

  const playWholeClip = useCallback(async (fromMillis = 0, mode?: StagePlaybackMode) => {
    if (!clip || readOnly) return;
    if (mode) {
      playbackModeRef.current = mode;
      setStageAudioFinished(false);
    }
    const requestId = playbackRequestRef.current + 1;
    playbackRequestRef.current = requestId;
    const targetStartMillis = Math.max(0, Math.floor(clipRelativeToSourceSeconds(clip, fromMillis / 1000) * 1000));
    pendingPlaybackRef.current = { targetStartMillis };
    const ready = await loadSound();
    if (!ready || requestId !== playbackRequestRef.current || !soundRef.current) return;
    try {
      await soundRef.current.pauseAsync().catch(noop);
      await soundRef.current.setPositionAsync(targetStartMillis);
      const seekStatus = await soundRef.current.getStatusAsync();
      handleStatus(seekStatus);
      await soundRef.current.playAsync();
    } catch {
      if (requestId !== playbackRequestRef.current) return;
      setStatus(prev => ({
        ...prev,
        isPlaying: false,
        isLoading: false,
        errorMessage: t('practiceSession.loadError'),
      }));
    }
  }, [clip, handleStatus, loadSound, readOnly, t]);

  const pause = useCallback(async () => {
    playbackRequestRef.current += 1;
    pendingPlaybackRef.current = null;
    if (!soundRef.current) return;
    try {
      await soundRef.current.pauseAsync();
    } catch {
    }
  }, []);

  const togglePlay = useCallback(async (mode?: StagePlaybackMode) => {
    if (status.isPlaying) {
      await pause();
      return;
    }
    if (mode) {
      playbackModeRef.current = mode;
    }
    if (soundRef.current && soundReadyRef.current) {
      try {
        await soundRef.current.playAsync();
        return;
      } catch {
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

  const advanceFromQuizStage = useCallback((quizStage: QuizStage) => {
    if (quizStage === 0) {
      goToStage(1);
      return;
    }
    if (quizStage === 1) {
      goToStage(2);
      return;
    }
    if (quizStage === 2) {
      goToStage(3);
      return;
    }
    if (quizStage === 3) {
      goToStage(4);
      return;
    }
    setAttributionStep(1);
  }, [goToStage]);

  const startPlaybackForStage = useCallback(async (mode: StagePlaybackMode, fromMillis = 0) => {
    playbackModeRef.current = mode;
    setStageAudioFinished(false);
    if (mode === 'blind') {
      setBlindListenStarted(true);
      setBlindListenFinished(false);
    }
    await playWholeClip(fromMillis, mode);
  }, [playWholeClip]);

  const completePractice = useCallback(() => {
    if (!clip || !clipKey || completionSavedRef.current || readOnly) return;
    completionSavedRef.current = true;
    const completedClip: PracticeTabCompletedClip = {
      clipKey,
      title: clip.title,
      tag: clip.tag,
      completedAt: Date.now(),
      tabEnteredFrom: 'practice',
      reasons: attributionReasons,
      vocabPicked: selectedVocabPicks,
      quizResults,
      durationSec: Math.round(getClipDurationSeconds(clip)),
    };
    onComplete(completedClip);
  }, [attributionReasons, clip, clipKey, onComplete, quizResults, readOnly, selectedVocabPicks]);

  useEffect(() => {
    if (!visible || !clip || !clipKey) return;
    completionSavedRef.current = false;
    stageRunRef.current = '';
    playbackRequestRef.current += 1;
    preparedAudioKeyRef.current = '';
    preparedAudioUriRef.current = null;
    prepareAudioPromiseRef.current = null;
    loadPromiseRef.current = null;
    pendingPlaybackRef.current = null;
    setStage(readOnly ? 6 : (Math.max(0, Math.min(initialStage, 6)) as Stage));
    setStatus({
      isPlaying: false,
      isLoading: false,
      positionMillis: 0,
      durationMillis: Math.floor(getClipDurationSeconds(clip) * 1000),
      errorMessage: null,
    });
    setStageAudioFinished(false);
    setBlindListenStarted(false);
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
    setExpandedSentenceIndex(null);
    setPopup(null);
    setStage1QuestionAnchorY(null);
    if (!readOnly) {
      void loadSoundRef.current();
    }
    return () => {
      loadPromiseRef.current = null;
      void unloadSoundRef.current();
    };
  }, [
    clipKey,
    completedRecord?.clipKey,
    completedRecord?.completedAt,
    readOnly,
    visible,
  ]);

  useEffect(() => {
    onStageChangeRef.current = onStageChange;
  }, [onStageChange]);

  useEffect(() => {
    loadSoundRef.current = loadSound;
  }, [loadSound]);

  useEffect(() => {
    unloadSoundRef.current = unloadSound;
  }, [unloadSound]);

  const handlePlaybackEnded = useCallback((mode: StagePlaybackMode) => {
    practiceDebug('playback-ended', {
      clipKey,
      mode,
      stage,
      visible,
      inline,
    });
    if (mode === 'blind') {
      setBlindListenFinished(true);
      const opened = openNextQuestionIfNeeded(4);
      if (!opened) {
        setAttributionStep(1);
      }
      return;
    }
    void openNextQuestionIfNeeded(mode);
  }, [clipKey, inline, openNextQuestionIfNeeded, stage, visible]);

  useEffect(() => {
    onPlaybackEndedRef.current = handlePlaybackEnded;
  }, [handlePlaybackEnded]);

  useEffect(() => {
    if (!visible || readOnly) return;
    onStageChangeRef.current(stage);
  }, [clipKey, inline, readOnly, stage, visible]);

  useEffect(() => {
    if (!inline || !visible || stage !== 1) return;
    if (currentQuestionFlow?.stage !== 1 || !currentQuestion) return;
    const timer = setTimeout(() => {
      bodyScrollRef.current?.scrollTo({
        y: Math.max(0, (stage1QuestionAnchorY || 0) - 20),
        animated: true,
      });
    }, 120);
    return () => clearTimeout(timer);
  }, [currentQuestion, currentQuestionFlow?.stage, inline, stage, stage1QuestionAnchorY, visible]);

  useEffect(() => {
    if (inline && !isActive) return;
    if (!visible || readOnly || !stagePlaybackFinished) return;
    if (stage !== 1 && stage !== 2 && stage !== 3) return;
    if (currentQuestionFlow) return;
    practiceDebug('stage-audio-finished', {
      clipKey,
      stage,
      visible,
      inline,
      activeQuestionStage: null,
    });
    void openNextQuestionIfNeeded(stage);
  }, [clipKey, currentQuestionFlow, inline, isActive, openNextQuestionIfNeeded, readOnly, stage, stagePlaybackFinished, visible]);

  useEffect(() => {
    if (inline && !isActive) return;
    if (!visible || !clip || readOnly) return;
    const runKey = `${clipKey}:${stage}`;
    if (stageRunRef.current === runKey) return;
    stageRunRef.current = runKey;
    if (stage === 0) {
      void openNextQuestionIfNeeded(0);
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

  useEffect(() => {
    if (stage === 6) {
      completePractice();
    }
  }, [completePractice, stage]);

  const handleWordTap = useCallback((word: ClipLineWord, contextEn: string, contextZh: string, lineIndex: number) => {
    onRecordWordLookup(word.cefr, {
      clip,
      word: word.word,
    });
    setPopup({
      word,
      contextEn,
      contextZh,
      lineIndex,
    });
  }, [clip, onRecordWordLookup]);

  useEffect(() => {
    if (!inline || !visible || !isActive) {
      if (status.isPlaying) {
        void pause();
      }
      return;
    }
  }, [inline, isActive, pause, status.isPlaying, visible]);

  const handleAdvanceQuestion = useCallback(() => {
    const questionFlow = currentQuestionFlow;
    if (!questionFlow || !currentQuestion) return;
    const selection = currentQuestionSelection;
    if (selection === null) {
      if (
        questionFlow.stage === 1
        || questionFlow.stage === 2
        || questionFlow.stage === 3
        || questionFlow.stage === 4
      ) {
        setActiveQuestionFlow(null);
        setCurrentQuestionSelection(null);
        advanceFromQuizStage(questionFlow.stage);
      }
      return;
    }
    const correctIndex = answerIndex(currentQuestion);
    const result: PracticeTabQuizResult = {
      qIdx: questionFlow.index,
      picked: selection,
      correct: selection === correctIndex,
    };
    const key = bucketKey(questionFlow.stage);
    setQuizResults(prev => ({
      ...prev,
      [key]: [...prev[key], result],
    }));
    const questions = stageQuestions(questionFlow.stage);
    if (questionFlow.index + 1 < questions.length) {
      setActiveQuestionFlow({
        stage: questionFlow.stage,
        index: questionFlow.index + 1,
      });
      setCurrentQuestionSelection(null);
      return;
    }
    setActiveQuestionFlow(null);
    setCurrentQuestionSelection(null);
    advanceFromQuizStage(questionFlow.stage);
  }, [advanceFromQuizStage, currentQuestion, currentQuestionFlow, currentQuestionSelection, stageQuestions]);

  const quizExplanation = currentQuestion
    ? explanationForQuestion(currentQuestion, t('practiceSession.explanationUnavailable'))
    : '';

  const handleToggleReason = (reason: PracticeTabReason) => {
    setAttributionReasons(prev => (
      prev.includes(reason)
        ? prev.filter(item => item !== reason)
        : [...prev, reason]
    ));
  };

  const handleToggleVocabPick = (word: string, sentenceIndex: number) => {
    setSelectedVocabPicks(prev => {
      const exists = prev.some(item => item.word === word && item.sentenceIndex === sentenceIndex);
      if (exists) {
        return prev.filter(item => !(item.word === word && item.sentenceIndex === sentenceIndex));
      }
      return [...prev, { word, sentenceIndex }];
    });
  };

  const handleContinueFromAttribution = () => {
    if (attributionReasons.includes('unknown')) {
      setAttributionStep(2);
      return;
    }
    goToStage(6);
  };

  const handleCompleteAttributionStep2 = () => {
    goToStage(5);
  };

  const handleStartBlindListen = useCallback(() => {
    if (status.isPlaying || status.isLoading) return;
    void startPlaybackForStage('blind', 0);
  }, [startPlaybackForStage, status.isLoading, status.isPlaying]);

  const handleReplayStage = useCallback((targetStage: QuizStage) => {
    if (readOnly) return;
    setStageAudioFinished(false);
    if (targetStage === 4) {
      setBlindListenStarted(false);
      setBlindListenFinished(false);
      setAttributionStep(null);
      setExpandedSentenceIndex(null);
      setSelectedVocabPicks([]);
    }
    if (currentQuestionFlow?.stage === targetStage) {
      setActiveQuestionFlow(null);
      setCurrentQuestionSelection(null);
    }
    void startPlaybackForStage(targetStage, 0);
  }, [currentQuestionFlow?.stage, readOnly, startPlaybackForStage]);

  const renderQuestionBlock = useCallback((quizStage: QuizStage, options?: { onLayout?: (y: number) => void }) => {
    if (currentQuestionFlow?.stage !== quizStage || !currentQuestion) return null;
    return (
      <View
        style={styles.inlineQuestionSection}
        onLayout={options?.onLayout ? event => options.onLayout?.(event.nativeEvent.layout.y) : undefined}
      >
        <PracticeCardHeader label={t('practiceSession.questionLabel')} />
        <Text style={styles.questionText}>{currentQuestion.question}</Text>
        <View style={styles.optionsWrap}>
          {(currentQuestion.options || []).map((option, index) => {
            const locked = currentQuestionAnswered;
            const isSelected = currentQuestionSelection === index;
            const isCorrectOption = currentQuestionAnswered && index === currentQuestionCorrectIndex;
            const isIncorrectSelection = currentQuestionAnswered && isSelected && !currentQuestionCorrect;
            return (
              <Pressable
                key={option}
                onPress={() => {
                  if (locked) return;
                  setCurrentQuestionSelection(index);
                  if (index === currentQuestionCorrectIndex) {
                    triggerUiFeedback('success');
                  } else {
                    triggerMediumHaptic();
                  }
                }}
                hitSlop={8}
                style={[
                  styles.optionButton,
                  isSelected && styles.optionButtonSelected,
                  isCorrectOption && styles.optionButtonCorrect,
                  isIncorrectSelection && styles.optionButtonIncorrect,
                  locked && !isSelected && !isCorrectOption && styles.optionButtonIdleLocked,
                ]}
              >
                <Text
                  style={[
                    styles.optionText,
                    isCorrectOption && styles.optionTextCorrect,
                    isIncorrectSelection && styles.optionTextIncorrect,
                  ]}
                >
                  {option}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {currentQuestionAnswered ? (
          <View
            style={[
              styles.answerFeedbackCard,
              currentQuestionCorrect ? styles.answerFeedbackCardCorrect : styles.answerFeedbackCardIncorrect,
            ]}
          >
            <Text
              style={[
                styles.answerFeedbackTitle,
                currentQuestionCorrect ? styles.answerFeedbackTitleCorrect : styles.answerFeedbackTitleIncorrect,
              ]}
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
        return <ActionButton label={t('common.continue')} onPress={() => goToStage(1)} />;
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
          );
        }
        return attributionStep === 2 ? (
          <View style={styles.inlineFooterStack}>
            <ActionButton
              label={selectedVocabPicks.length > 0 ? t('common.continue') : t('practiceSession.blindCantTell')}
              onPress={handleCompleteAttributionStep2}
            />
            {selectedVocabPicks.length > 0 ? (
              <ActionButton label={t('practiceSession.blindCantTell')} variant="secondary" onPress={() => goToStage(6)} />
            ) : null}
          </View>
        ) : null;
      }
      if (stage === 5) {
        return <ActionButton label={t('common.continue')} onPress={() => goToStage(6)} />;
      }
      if (stage === 6) {
        return (
          <View style={styles.inlineFooterStack}>
            {!readOnly ? <ActionButton label={t('practiceSession.nextClip')} onPress={onNextClip} /> : null}
            <ActionButton label={t('home.listenTab')} variant="secondary" onPress={onReturnListen} />
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

            {currentQuestionFlow?.stage === 0 && currentQuestion ? (
              <GlassCard tone="practice" style={styles.cardBlock}>
                {renderQuestionBlock(0)}
              </GlassCard>
            ) : null}
          </View>
        ) : null}

        {stage === 1 ? (
          <View style={styles.stageCard}>
            <GlassCard tone="practice" style={styles.cardBlock}>
              <PracticeCardHeader label={t('practiceSession.gistLabel')} />
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
              {currentQuestionFlow?.stage === 1 && currentQuestion ? (
                renderQuestionBlock(1, { onLayout: setStage1QuestionAnchorY })
              ) : (
                <>
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
              <Text style={styles.supportText}>{t('practiceSession.decodeBody')}</Text>
              {currentQuestionFlow?.stage === 2 && currentQuestion ? (
                renderQuestionBlock(2)
              ) : (
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
              )}
            </GlassCard>
          </View>
        ) : null}

        {stage === 3 ? (
          <View style={styles.stageCard}>
            <GlassCard tone="practice" style={[styles.cardBlock, styles.fadeCard]}>
              <PracticeCardHeader label={t('practiceSession.fadeTitle')} />
              {challengeWords.length > 0 ? (
                <ChallengeWordPills words={challengeWords} tone="practice" singleRow />
              ) : null}
              <Text style={styles.supportText}>{t('practiceSession.fadeBody')}</Text>
            </GlassCard>

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
                              return (
                                <Pressable
                                  key={`${sentenceIndex}-${word.word}`}
                                  onPress={() => handleToggleVocabPick(word.word.toLowerCase(), sentenceIndex)}
                                  style={[styles.wordChip, picked && styles.wordChipActive]}
                                >
                                  <Text style={[styles.wordChipText, picked && styles.wordChipTextActive]}>
                                    {word.word}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        ) : null}
                      </View>
                    ))}
                  </ScrollView>
                </View>
              </GlassCard>
            )}
          </View>
        ) : null}

        {stage === 5 ? (
          <View style={styles.stageCard}>
            <GlassCard tone="practice" style={styles.cardBlock}>
              <PracticeCardHeader label={t('practiceSession.vocabReviewTitle')} />
              <Text style={styles.supportText}>{t('practiceSession.vocabReviewBody')}</Text>
              <View style={[styles.transcriptPanel, styles.vocabWorkspace, { maxHeight: transcriptPanelTallHeight }]}>
                <View style={styles.scrollCueWrap}>
                  <View style={styles.scrollCue} />
                </View>
                <ScrollView
                  nestedScrollEnabled
                  showsVerticalScrollIndicator
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.vocabWorkspaceScrollContent}
                >
                  <View style={styles.vocabWorkspaceInner}>
                    <View style={styles.vocabWorkspaceBanner}>
                      <Text style={styles.vocabWorkspaceBannerText}>{t('practiceSession.pickedWordsTitle')}</Text>
                    </View>
                    <View style={styles.vocabReviewList}>
                      {stage5ReviewItems.map(item => {
                        const line = item.line;
                        const normalizedWord = item.normalizedWord;
                        const saved = vocabWords.includes(normalizedWord);
                        const known = knownWords.includes(normalizedWord);
                        return (
                          <GlassCard key={`${item.word}-${item.sentenceIndex}`} style={styles.vocabReviewCard}>
                            <Text style={styles.vocabWord}>{item.word}</Text>
                            {stage5Translations[normalizedWord] ? (
                              <Text style={styles.vocabWordTranslation}>{stage5Translations[normalizedWord]}</Text>
                            ) : null}
                            <View style={styles.vocabContextBlock}>
                              <Text style={styles.vocabContext}>{line?.en || ''}</Text>
                              {line?.zh ? <Text style={styles.vocabContextZh}>{line.zh}</Text> : null}
                            </View>
                            <View style={[styles.controlsRow, styles.vocabCardActions]}>
                              <ActionButton
                                label={saved ? t('practiceSession.savedLabel') : t('practiceSession.saveLabel')}
                                variant="secondary"
                                onPress={() => {
                                  if (!line) return;
                                  onSaveVocab({
                                    word: normalizedWord,
                                    cefr: item.cefr || line.words?.find(word => word.word.toLowerCase() === normalizedWord)?.cefr,
                                    context: line.en,
                                    contextZh: line.zh,
                                    lineIndex: item.sentenceIndex,
                                    clipKey,
                                    clipTitle: clip.title,
                                    tag: clip.tag,
                                    sourceType: 'practice',
                                  });
                                }}
                              />
                              <ActionButton
                                label={known ? t('practiceSession.knownLabel') : t('practiceSession.markKnownLabel')}
                                variant="secondary"
                                onPress={() => onMarkKnown(normalizedWord)}
                              />
                            </View>
                          </GlassCard>
                        );
                      })}
                    </View>
                  </View>
                </ScrollView>
              </View>
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
                {!readOnly ? (
                  <ActionButton label={t('practiceSession.nextClip')} onPress={onNextClip} />
                ) : null}
                <ActionButton label={t('home.listenTab')} variant="secondary" onPress={onReturnListen} />
                <ActionButton label={t('common.close')} variant="secondary" onPress={onDismiss} />
              </View>
            ) : null}
          </View>
        ) : null}
    </>
  );

  const inlineFooterReservedSpace = Math.max(insets.bottom + 112, 132);

  const bodyScroller = inline ? (
    <ScrollView
      ref={bodyScrollRef}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
      style={styles.bodyInlineScroller}
      contentContainerStyle={[
        styles.body,
        styles.bodyInline,
        {
          paddingHorizontal: metrics.pageHorizontalPadding,
          paddingBottom: inlineFooterReservedSpace,
          maxWidth: metrics.modalMaxWidth,
          alignSelf: 'center',
          width: '100%',
        },
      ]}
    >
      {stageContent}
    </ScrollView>
  ) : (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.body,
        {
          paddingHorizontal: metrics.pageHorizontalPadding,
          paddingBottom: Math.max(insets.bottom + 28, 28),
          maxWidth: metrics.modalMaxWidth,
          alignSelf: 'center',
          width: '100%',
        },
      ]}
    >
      {stageContent}
    </ScrollView>
  );

  const bodyContent = (
    <>
      {bodyHeader}
      {bodyScroller}

      {inline && inlineFooterActions ? (
        <View
          style={[
            styles.inlineFooter,
            {
              paddingBottom: Math.max(insets.bottom + 10, 14),
              paddingHorizontal: metrics.pageHorizontalPadding,
            },
          ]}
        >
          <View style={[styles.inlineFooterInner, { maxWidth: metrics.modalMaxWidth }]}>
            {inlineFooterActions}
          </View>
        </View>
      ) : null}

      {!inline ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom + 12, 16), paddingHorizontal: metrics.pageHorizontalPadding }]}>
          <ActionButton
            label={readOnly ? t('common.close') : t('common.cancel')}
            variant="secondary"
            onPress={onDismiss}
            style={styles.footerButton}
          />
        </View>
      ) : null}

      {popup ? (
        <WordPopup
          word={popup.word}
          contextEn={popup.contextEn}
          contextZh={popup.contextZh}
          isSaved={selectedWordSaved}
          isKnown={selectedWordKnown}
          onDismiss={() => setPopup(null)}
          onSave={info => {
            onSaveVocab({
              word: popup.word.word.toLowerCase(),
              cefr: popup.word.cefr,
              phonetic: info.phonetic,
              definitionZh: info.definition,
              context: popup.contextEn,
              contextZh: popup.contextZh,
              lineIndex: popup.lineIndex,
              clipKey,
              clipTitle: clip.title,
              tag: clip.tag,
              sourceType: 'practice',
            });
          }}
          onMarkKnown={() => {
            onMarkKnown(popup.word.word.toLowerCase());
          }}
        />
      ) : null}
    </>
  );

  if (inline) {
    return (
      <View style={styles.inlineRoot}>
        {bodyContent}
      </View>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onDismiss}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        {bodyContent}
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
