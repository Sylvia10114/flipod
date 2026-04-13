import { Audio, type AVPlaybackStatus } from 'expo-av';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  buildClipKey,
  findLineAtTime,
  getClipDurationSeconds,
  getSentenceMarkers,
  getSentenceRange,
  getSourceLabel,
  resolveClipAudioUrl,
} from '../clip-utils';
import { triggerMediumHaptic, triggerUiFeedback } from '../feedback';
import type { Clip, ClipLineWord, PracticeRecord, VocabEntry } from '../types';
import { ProgressBar } from './ProgressBar';
import { WordLine } from './WordLine';
import { WordPopup } from './WordPopup';

type Step = 1 | 2 | 3 | 4 | 5;

type PopupState = {
  word: ClipLineWord;
  contextEn: string;
  contextZh: string;
} | null;

type LookedWord = {
  word: string;
  cefr?: string;
};

type Props = {
  visible: boolean;
  clip: Clip | null;
  clipIndex: number;
  vocabWords: string[];
  knownWords: string[];
  onSaveVocab: (entry: VocabEntry) => void;
  onMarkKnown: (word: string) => void;
  onRecordWordLookup: (cefr?: string) => void;
  onComplete: (clipKey: string, record: PracticeRecord) => void;
  onDismiss: () => void;
  onReturnFeed: () => void;
};

function stepLabel(step: Step) {
  if (step === 1) return 'STEP 1 · 盲听';
  if (step === 2) return 'STEP 2 · 逐句精听';
  if (step === 3) return 'STEP 3 · 难句闪卡';
  if (step === 4) return 'STEP 4 · 复听';
  return '练习完成';
}

function getHardWords(lineWords: ClipLineWord[] = []) {
  return lineWords
    .filter(word => {
      const bucket = (word.cefr || '').toUpperCase();
      return bucket && !['A1', 'A2'].includes(bucket);
    })
    .slice(0, 4);
}

export function PracticeSessionModal({
  visible,
  clip,
  clipIndex,
  vocabWords,
  knownWords,
  onSaveVocab,
  onMarkKnown,
  onRecordWordLookup,
  onComplete,
  onDismiss,
  onReturnFeed,
}: Props) {
  const soundRef = useRef<Audio.Sound | null>(null);
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
  });
  const [blindFinished, setBlindFinished] = useState(false);
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [showSentenceZh, setShowSentenceZh] = useState(false);
  const [hardSentences, setHardSentences] = useState<number[]>([]);
  const [wordsLooked, setWordsLooked] = useState(0);
  const [lookedWordsList, setLookedWordsList] = useState<LookedWord[]>([]);
  const [flashQueue, setFlashQueue] = useState<number[]>([]);
  const [flashCursor, setFlashCursor] = useState(0);
  const [flashRevealed, setFlashRevealed] = useState(false);
  const [popup, setPopup] = useState<PopupState>(null);
  const [quizStarted, setQuizStarted] = useState(false);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizSelections, setQuizSelections] = useState<Record<number, string>>({});
  const [quizCorrectCount, setQuizCorrectCount] = useState(0);
  const [showQuizResult, setShowQuizResult] = useState(false);

  const clipKey = useMemo(() => {
    if (!clip) return '';
    return buildClipKey(clip, clipIndex);
  }, [clip, clipIndex]);

  const questions = clip?.questions || [];
  const currentQuestion = questions[quizIndex];
  const currentSelection = quizSelections[quizIndex];

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
    if (!soundRef.current) return;
    try {
      await soundRef.current.unloadAsync();
    } catch {
    }
    soundRef.current.setOnPlaybackStatusUpdate(null);
    soundRef.current = null;
  }, []);

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
      }));
      return;
    }

    setStatus({
      isPlaying: nextStatus.isPlaying,
      isLoading: false,
      positionMillis: nextStatus.positionMillis,
      durationMillis: nextStatus.durationMillis || nextStatus.positionMillis || 0,
    });

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

    if (!nextStatus.didJustFinish) return;

    segmentEndRef.current = null;
    if (stepRef.current === 1) {
      setBlindFinished(true);
    } else if (stepRef.current === 4) {
      finishPractice();
    }
  }, [finishPractice]);

  const loadSound = useCallback(async () => {
    if (!clip || !visible) return;
    const audioUrl = resolveClipAudioUrl(clip);
    if (!audioUrl) {
      setStatus({
        isPlaying: false,
        isLoading: false,
        positionMillis: 0,
        durationMillis: Math.floor(getClipDurationSeconds(clip) * 1000),
      });
      setBlindFinished(true);
      return;
    }

    setStatus(prev => ({ ...prev, isLoading: true }));
    await unloadSound();

    const sound = new Audio.Sound();
    soundRef.current = sound;
    sound.setOnPlaybackStatusUpdate(handleStatus);

    await sound.loadAsync(
      { uri: audioUrl },
      {
        shouldPlay: false,
        progressUpdateIntervalMillis: 120,
        positionMillis: 0,
      }
    );
  }, [clip, handleStatus, unloadSound, visible]);

  const playWholeClip = useCallback(async (fromMillis = 0) => {
    if (!soundRef.current) return;
    segmentEndRef.current = null;
    try {
      await soundRef.current.setPositionAsync(Math.max(0, fromMillis));
      await soundRef.current.playAsync();
    } catch {
    }
  }, []);

  const playSentence = useCallback(async (lineIndex: number) => {
    if (!clip || !soundRef.current) return;
    const line = clip.lines?.[lineIndex];
    if (!line) return;

    segmentEndRef.current = Math.floor(line.end * 1000);
    try {
      await soundRef.current.setPositionAsync(Math.max(0, Math.floor(line.start * 1000)));
      await soundRef.current.playAsync();
    } catch {
    }
  }, [clip]);

  const pause = useCallback(async () => {
    if (!soundRef.current) return;
    try {
      await soundRef.current.pauseAsync();
    } catch {
    }
  }, []);

  const togglePlay = useCallback(async () => {
    if (!soundRef.current) return;

    if (status.isPlaying) {
      await pause();
      return;
    }

    try {
      await soundRef.current.playAsync();
    } catch {
    }
  }, [pause, status.isPlaying]);

  useEffect(() => {
    if (!visible || !clip) return;

    completionSavedRef.current = false;
    segmentEndRef.current = null;
    setStep(1);
    setBlindFinished(false);
    setSentenceIndex(0);
    setShowSentenceZh(false);
    setHardSentences([]);
    setWordsLooked(0);
    setLookedWordsList([]);
    setFlashQueue([]);
    setFlashCursor(0);
    setFlashRevealed(false);
    setPopup(null);
    setQuizStarted(false);
    setQuizIndex(0);
    setQuizSelections({});
    setQuizCorrectCount(0);
    setShowQuizResult(false);
    wordsLookedRef.current = 0;
    hardSentencesRef.current = [];

    void loadSound();

    return () => {
      void unloadSound();
    };
  }, [clip, loadSound, unloadSound, visible]);

  useEffect(() => {
    if (!visible || !clip || step !== 2) return;
    setShowSentenceZh(false);
    void playSentence(sentenceIndex);
  }, [clip, playSentence, sentenceIndex, step, visible]);

  useEffect(() => {
    if (!visible || !clip || step !== 3 || flashQueue.length === 0) return;
    setFlashRevealed(false);
    void playSentence(flashQueue[flashCursor]);
  }, [clip, flashCursor, flashQueue, playSentence, step, visible]);

  useEffect(() => {
    if (!visible || !clip || step !== 4) return;
    void playWholeClip(0);
  }, [clip, playWholeClip, step, visible]);

  const lineCount = clip?.lines?.length || 0;
  const currentLineIndex = clip ? Math.max(0, findLineAtTime(clip, status.positionMillis / 1000)) : 0;
  const currentLine = clip?.lines?.[currentLineIndex] || null;
  const sentenceLine = clip?.lines?.[sentenceIndex] || null;
  const markers = clip ? getSentenceMarkers(clip) : [];
  const currentSentenceRange = clip ? getSentenceRange(clip, currentLineIndex) : null;
  const hardRanges = useMemo(() => {
    if (!clip || step !== 4) return [];
    return hardSentences
      .map(lineIndex => {
        const range = getSentenceRange(clip, lineIndex);
        if (!range) return null;
        return { ...range, color: 'rgba(139,156,247,0.22)', opacity: 1 };
      })
      .filter(Boolean) as { start: number; end: number; color?: string; opacity?: number }[];
  }, [clip, hardSentences, step]);

  const flashLineIndex = typeof flashQueue[flashCursor] === 'number' ? flashQueue[flashCursor] : -1;
  const flashLine = flashLineIndex >= 0 ? clip?.lines?.[flashLineIndex] || null : null;

  if (!clip) return null;

  const handleWordTap = (word: ClipLineWord, contextEn: string, contextZh: string) => {
    onRecordWordLookup(word.cefr);
    setWordsLooked(prev => prev + 1);
    setLookedWordsList(prev => {
      const normalized = word.word.toLowerCase();
      if (prev.some(item => item.word === normalized)) return prev;
      return [...prev, { word: normalized, cefr: word.cefr }];
    });
    setPopup({ word, contextEn, contextZh });
  };

  const moveToNextSentence = () => {
    const nextIndex = sentenceIndex + 1;
    if (nextIndex < lineCount) {
      setSentenceIndex(nextIndex);
      return;
    }
    if (hardSentencesRef.current.length > 0) {
      setFlashQueue(hardSentencesRef.current);
      setFlashCursor(0);
      setStep(3);
      return;
    }
    setStep(4);
  };

  const retryQuiz = () => {
    setQuizStarted(false);
    setQuizIndex(0);
    setQuizSelections({});
    setQuizCorrectCount(0);
    setShowQuizResult(false);
    setBlindFinished(false);
    triggerMediumHaptic();
    void playWholeClip(0);
  };

  const currentAnswer = currentQuestion?.answer?.trim().charAt(0).toUpperCase() || '';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onDismiss}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable onPress={() => {
            triggerUiFeedback('menu');
            onDismiss();
          }} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>关闭</Text>
          </Pressable>
          <Text style={styles.stepLabel}>{stepLabel(step)}</Text>
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

        <ScrollView contentContainerStyle={styles.body}>
          {step === 1 ? (
            <View style={styles.centerBlock}>
              <View style={styles.sourceCard}>
                <Text style={styles.sourceTitle}>{clip.title}</Text>
                <Text style={styles.sourceMeta}>
                  {getSourceLabel(clip.source)}
                  {clip.tag ? ` · ${clip.tag}` : ''}
                </Text>
              </View>

              <Text style={styles.hintText}>
                {blindFinished
                  ? questions.length > 0
                    ? '听完了，看看你抓住了多少'
                    : '听完了，判断一下自己掌握得怎么样'
                  : '先完整听一遍，不用急着逐句分析'}
              </Text>

              {!blindFinished ? (
                <>
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
                  <Pressable
                    onPress={() => {
                      triggerMediumHaptic();
                      if (status.isPlaying) {
                        void pause();
                        return;
                      }
                      const restart = status.positionMillis >= Math.max(0, status.durationMillis - 300);
                      void playWholeClip(restart ? 0 : status.positionMillis);
                    }}
                    style={styles.primaryCircle}
                  >
                    <Text style={styles.primaryCircleText}>{status.isPlaying ? '暂停' : '播放'}</Text>
                  </Pressable>
                </>
              ) : null}

              {blindFinished && questions.length === 0 ? (
                <View style={styles.choiceRow}>
                  <Pressable onPress={() => {
                    triggerUiFeedback('correct');
                    setStep(4);
                  }} style={[styles.choiceButton, styles.choiceButtonPrimary]}>
                    <Text style={styles.choiceButtonPrimaryText}>大部分听懂了</Text>
                  </Pressable>
                  <Pressable onPress={() => {
                    triggerUiFeedback('primary');
                    setStep(2);
                  }} style={styles.choiceButton}>
                    <Text style={styles.choiceButtonText}>有些没听清</Text>
                  </Pressable>
                </View>
              ) : null}

              {blindFinished && questions.length > 0 && !quizStarted ? (
                <Pressable onPress={() => {
                  triggerUiFeedback('primary');
                  setQuizStarted(true);
                }} style={[styles.choiceButton, styles.choiceButtonPrimary, styles.quizStartButton]}>
                  <Text style={styles.choiceButtonPrimaryText}>开始答题</Text>
                </Pressable>
              ) : null}

              {blindFinished && questions.length > 0 && quizStarted && !showQuizResult && currentQuestion ? (
                <View style={styles.quizCard}>
                  <Text style={styles.compLabel}>COMPREHENSION · {quizIndex + 1}/{questions.length}</Text>
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
                      <Pressable onPress={() => {
                        triggerUiFeedback('primary');
                        if (quizIndex >= questions.length - 1) {
                          setShowQuizResult(true);
                        } else {
                          setQuizIndex(prev => prev + 1);
                        }
                      }} style={styles.compNextButton}>
                        <Text style={styles.compNextButtonText}>
                          {quizIndex >= questions.length - 1 ? '查看结果 →' : '下一题 →'}
                        </Text>
                      </Pressable>
                    </>
                  ) : null}
                </View>
              ) : null}

              {blindFinished && questions.length > 0 && quizStarted && showQuizResult ? (
                <View style={styles.quizResultCard}>
                  <Text style={styles.compResultSub}>{quizCorrectCount}/{questions.length}</Text>
                  <Text style={styles.compResultMsg}>
                    {quizCorrectCount === questions.length
                      ? '完全听懂了'
                      : quizCorrectCount >= 1
                        ? '核心意思抓到了，细节再听听'
                        : '没关系，我们一句句来'}
                  </Text>
                  <Pressable onPress={() => {
                    triggerUiFeedback('primary');
                    if (quizCorrectCount === questions.length) {
                      setStep(4);
                    } else {
                      setStep(2);
                    }
                  }} style={styles.compNextButton}>
                    <Text style={styles.compNextButtonText}>
                      {quizCorrectCount === questions.length ? '跳到复听 →' : '逐句精听 →'}
                    </Text>
                  </Pressable>
                  <Pressable onPress={retryQuiz}>
                    <Text style={styles.compRetryText}>从头再听一遍</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}

          {step === 2 && sentenceLine ? (
            <View style={styles.centerBlock}>
              <Text style={styles.progressText}>第 {sentenceIndex + 1} / {lineCount} 句</Text>
              <View style={styles.practiceLineWrap}>
                <WordLine
                  line={sentenceLine}
                  currentTime={status.positionMillis / 1000}
                  isActive
                  showZh={showSentenceZh}
                  compact
                  onWordTap={(word, line) => handleWordTap(word, line.en, line.zh || '')}
                />
              </View>

              <Pressable onPress={() => {
                triggerMediumHaptic();
                setShowSentenceZh(prev => !prev);
              }} style={styles.translationToggle}>
                <Text style={styles.translationToggleText}>{showSentenceZh ? '隐藏中文' : '显示中文'}</Text>
              </Pressable>

              <View style={styles.controlsRow}>
                <Pressable onPress={() => {
                  triggerMediumHaptic();
                  void playSentence(sentenceIndex);
                }} style={styles.secondaryCircle}>
                  <Text style={styles.secondaryCircleText}>重播</Text>
                </Pressable>
                <Pressable onPress={() => {
                  triggerMediumHaptic();
                  void togglePlay();
                }} style={styles.secondaryCircle}>
                  <Text style={styles.secondaryCircleText}>{status.isPlaying ? '暂停' : '播放'}</Text>
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
                  <Text style={[styles.actionButtonText, styles.actionButtonTextEasy]}>✓ 没问题</Text>
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

                    const nextIndex = sentenceIndex + 1;
                    if (nextIndex < lineCount) {
                      setSentenceIndex(nextIndex);
                      return;
                    }
                    if (nextHard.length > 0) {
                      setFlashQueue(nextHard);
                      setFlashCursor(0);
                      setStep(3);
                      return;
                    }
                    setStep(4);
                  }}
                  style={[styles.actionButton, styles.actionButtonHard]}
                >
                  <Text style={[styles.actionButtonText, styles.actionButtonTextHard]}>✗ 有难度</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {step === 3 && flashLine ? (
            <View style={styles.centerBlock}>
              <Pressable onPress={() => {
                triggerUiFeedback('card');
                setFlashRevealed(true);
              }} style={styles.flashCard}>
                <Text style={styles.flashLabel}>难句 {flashCursor + 1} / {flashQueue.length}</Text>
                <Text style={styles.flashEn}>{flashLine.en}</Text>
                {!flashRevealed ? (
                  <>
                    <Pressable
                      onPress={event => {
                        event.stopPropagation();
                        triggerMediumHaptic();
                        void playSentence(flashLineIndex);
                      }}
                      style={styles.flashPlayButton}
                    >
                      <Text style={styles.flashPlayButtonText}>再听一遍</Text>
                    </Pressable>
                    <Text style={styles.flashHint}>点开卡片查看翻译和难词</Text>
                  </>
                ) : (
                  <>
                    <View style={styles.flashDivider} />
                    <Text style={styles.flashZh}>{flashLine.zh || ''}</Text>
                    <View style={styles.hardWordsRow}>
                      {getHardWords(flashLine.words).length > 0 ? (
                        getHardWords(flashLine.words).map(word => (
                          <View key={`${flashLine.start}-${word.word}`} style={styles.hardWordPill}>
                            <Text style={styles.hardWordText}>{word.word}</Text>
                            {word.cefr ? <Text style={styles.hardWordLevel}>{word.cefr}</Text> : null}
                          </View>
                        ))
                      ) : (
                        <Text style={styles.flashMeta}>这一句主要是句法难，词汇不算太难。</Text>
                      )}
                    </View>
                  </>
                )}
              </Pressable>

              {flashRevealed ? (
                <View style={styles.actionRow}>
                  <Pressable
                    onPress={() => {
                      triggerUiFeedback('correct');
                      const nextCursor = flashCursor + 1;
                      if (nextCursor < flashQueue.length) {
                        setFlashCursor(nextCursor);
                      } else {
                        setStep(4);
                      }
                    }}
                    style={[styles.actionButton, styles.actionButtonEasy]}
                  >
                    <Text style={[styles.actionButtonText, styles.actionButtonTextEasy]}>搞懂了</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      triggerUiFeedback('error');
                      const nextCursor = flashCursor + 1;
                      if (nextCursor < flashQueue.length) {
                        setFlashCursor(nextCursor);
                      } else {
                        setStep(4);
                      }
                    }}
                    style={[styles.actionButton, styles.actionButtonHard]}
                  >
                    <Text style={[styles.actionButtonText, styles.actionButtonTextHard]}>还是不太清楚</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}

          {step === 4 ? (
            <View style={styles.centerBlock}>
              <View style={styles.practiceLineWrap}>
                {currentLine ? (
                  <WordLine
                    line={currentLine}
                    currentTime={status.positionMillis / 1000}
                    isActive
                    showZh
                    compact
                    practiced={hardSentences.includes(currentLineIndex)}
                    onWordTap={(word, line) => handleWordTap(word, line.en, line.zh || '')}
                  />
                ) : (
                  <Text style={styles.hintText}>准备开始复听…</Text>
                )}
              </View>

              <View style={styles.progressWrap}>
                <ProgressBar
                  progress={status.durationMillis > 0 ? status.positionMillis / status.durationMillis : 0}
                  markers={markers}
                  currentSentenceRange={currentSentenceRange}
                  highlightRanges={hardRanges}
                  onSeek={ratio => {
                    if (!soundRef.current || !status.durationMillis) return;
                    void soundRef.current.setPositionAsync(Math.floor(status.durationMillis * ratio));
                  }}
                />
              </View>

              <View style={styles.controlsRow}>
                <Pressable onPress={() => {
                  triggerMediumHaptic();
                  void togglePlay();
                }} style={styles.secondaryCircle}>
                  <Text style={styles.secondaryCircleText}>{status.isPlaying ? '暂停' : '播放'}</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    triggerMediumHaptic();
                    void pause();
                    finishPractice();
                  }}
                  style={styles.secondaryCircle}
                >
                  <Text style={styles.secondaryCircleText}>跳过</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {step === 5 ? (
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>这段练完了</Text>
              <View style={styles.summaryStats}>
                <View style={styles.summaryStat}>
                  <Text style={styles.summaryValue}>{wordsLooked}</Text>
                  <Text style={styles.summaryLabel}>查了词</Text>
                </View>
                <View style={styles.summaryStat}>
                  <Text style={styles.summaryValue}>{lineCount}</Text>
                  <Text style={styles.summaryLabel}>精听句数</Text>
                </View>
                <View style={styles.summaryStat}>
                  <Text style={styles.summaryValue}>{hardSentences.length}</Text>
                  <Text style={styles.summaryLabel}>难句</Text>
                </View>
              </View>

              <View style={styles.summarySection}>
                <Text style={styles.summarySectionTitle}>这次查过的词 · 想加入词汇本就点词查看</Text>
                <View style={styles.summaryChipRow}>
                  {lookedWordsList.length > 0 ? (
                    lookedWordsList.map(item => (
                      <View key={item.word} style={styles.summaryChip}>
                        <Text style={styles.summaryChipText}>{item.word}</Text>
                        {item.cefr ? <Text style={styles.summaryChipMeta}>{item.cefr}</Text> : null}
                      </View>
                    ))
                  ) : (
                    <Text style={styles.summaryEmpty}>这次没有点开查词，说明你已经很顺了。</Text>
                  )}
                </View>
              </View>

              <View style={styles.summarySection}>
                <Text style={styles.summarySectionTitle}>回看这些难句</Text>
                <View style={styles.summaryList}>
                  {hardSentences.length > 0 ? (
                    hardSentences.map(lineIndex => {
                      const line = clip.lines?.[lineIndex];
                      if (!line) return null;
                      return (
                        <View key={`${lineIndex}-${line.start}`} style={styles.summaryItem}>
                          <Text style={styles.summaryItemEn}>{line.en}</Text>
                          <Text style={styles.summaryItemZh}>{line.zh}</Text>
                        </View>
                      );
                    })
                  ) : (
                    <Text style={styles.summaryEmpty}>这一段没有留下明显的难句，可以继续往前刷了。</Text>
                  )}
                </View>
              </View>

              <Pressable onPress={() => {
                triggerUiFeedback('bookmark');
                onReturnFeed();
              }} style={styles.summaryInlineButton}>
                <Text style={styles.summaryInlineButtonText}>回 Feed 收藏更多内容</Text>
              </Pressable>

              <View style={styles.summaryActions}>
                <Pressable onPress={() => {
                  triggerUiFeedback('menu');
                  onReturnFeed();
                }} style={styles.summaryButton}>
                  <Text style={styles.summaryButtonText}>回到 Feed</Text>
                </Pressable>
                <Pressable onPress={() => {
                  triggerUiFeedback('primary');
                  onDismiss();
                }} style={[styles.summaryButton, styles.summaryButtonPrimary]}>
                  <Text style={[styles.summaryButtonText, styles.summaryButtonTextPrimary]}>再练一段</Text>
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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#09090B',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeButton: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  closeButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  stepLabel: {
    color: 'rgba(255,255,255,0.68)',
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
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  stepDotActive: {
    width: 20,
    borderRadius: 6,
    backgroundColor: '#8B9CF7',
  },
  stepDotDone: {
    backgroundColor: 'rgba(139,156,247,0.5)',
  },
  body: {
    flexGrow: 1,
    paddingHorizontal: 24,
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
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 6,
  },
  sourceTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '700',
    textAlign: 'center',
  },
  sourceMeta: {
    color: 'rgba(255,255,255,0.48)',
    fontSize: 13,
    textAlign: 'center',
  },
  hintText: {
    marginTop: 20,
    color: 'rgba(255,255,255,0.62)',
    fontSize: 14,
    lineHeight: 22,
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
    backgroundColor: '#8B9CF7',
  },
  primaryCircle: {
    width: 82,
    height: 82,
    borderRadius: 41,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8B9CF7',
  },
  primaryCircleText: {
    color: '#09090B',
    fontSize: 16,
    fontWeight: '700',
  },
  choiceRow: {
    marginTop: 36,
    width: '100%',
    gap: 12,
  },
  choiceButton: {
    borderRadius: 18,
    paddingVertical: 15,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  choiceButtonPrimary: {
    backgroundColor: '#8B9CF7',
    borderColor: '#8B9CF7',
  },
  quizStartButton: {
    marginTop: 36,
    width: '100%',
  },
  choiceButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  choiceButtonPrimaryText: {
    color: '#09090B',
    fontSize: 14,
    fontWeight: '700',
  },
  quizCard: {
    marginTop: 28,
    width: '100%',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 14,
  },
  compLabel: {
    color: 'rgba(255,255,255,0.38)',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    textAlign: 'center',
  },
  compQuestion: {
    color: '#FFFFFF',
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
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
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
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 20,
  },
  compExplanation: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 13,
    lineHeight: 20,
  },
  compNextButton: {
    alignSelf: 'stretch',
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#8B9CF7',
  },
  compNextButtonText: {
    color: '#09090B',
    fontSize: 14,
    fontWeight: '700',
  },
  quizResultCard: {
    marginTop: 28,
    width: '100%',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 24,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 14,
    alignItems: 'center',
  },
  compResultSub: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 16,
    fontWeight: '700',
  },
  compResultMsg: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  compRetryText: {
    color: 'rgba(255,255,255,0.54)',
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  progressText: {
    color: 'rgba(255,255,255,0.48)',
    fontSize: 12,
    fontWeight: '600',
  },
  practiceLineWrap: {
    marginTop: 24,
    minHeight: 140,
    justifyContent: 'center',
    width: '100%',
  },
  translationToggle: {
    marginTop: 10,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  translationToggleText: {
    color: '#FFFFFF',
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
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  secondaryCircleText: {
    color: '#FFFFFF',
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
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  flashLabel: {
    color: 'rgba(255,255,255,0.38)',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  flashEn: {
    marginTop: 16,
    color: '#FFFFFF',
    fontSize: 20,
    lineHeight: 30,
    textAlign: 'center',
  },
  flashPlayButton: {
    marginTop: 20,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  flashPlayButtonText: {
    color: '#8B9CF7',
    fontSize: 13,
    fontWeight: '700',
  },
  flashHint: {
    marginTop: 12,
    color: 'rgba(255,255,255,0.42)',
    fontSize: 12,
  },
  flashDivider: {
    width: 46,
    height: 1,
    marginVertical: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  flashZh: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  flashMeta: {
    marginTop: 14,
    color: 'rgba(255,255,255,0.42)',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
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
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  hardWordText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  hardWordLevel: {
    color: '#AFC0FF',
    fontSize: 11,
    fontWeight: '700',
  },
  progressWrap: {
    width: '100%',
    marginTop: 22,
  },
  summaryCard: {
    marginTop: 40,
    borderRadius: 28,
    paddingHorizontal: 24,
    paddingVertical: 28,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 20,
  },
  summaryTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  summaryStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryStat: {
    flex: 1,
    alignItems: 'center',
  },
  summaryValue: {
    color: '#8B9CF7',
    fontSize: 28,
    fontWeight: '700',
  },
  summaryLabel: {
    marginTop: 6,
    color: 'rgba(255,255,255,0.46)',
    fontSize: 12,
  },
  summarySection: {
    gap: 12,
  },
  summarySectionTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  summaryChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  summaryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  summaryChipText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  summaryChipMeta: {
    color: '#AFC0FF',
    fontSize: 11,
    fontWeight: '700',
  },
  summaryList: {
    gap: 12,
  },
  summaryItem: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    gap: 6,
  },
  summaryItemEn: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 22,
  },
  summaryItemZh: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    lineHeight: 20,
  },
  summaryEmpty: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    lineHeight: 20,
  },
  summaryInlineButton: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  summaryInlineButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  summaryActions: {
    flexDirection: 'row',
    gap: 12,
  },
  summaryButton: {
    flex: 1,
    borderRadius: 18,
    paddingVertical: 15,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  summaryButtonPrimary: {
    backgroundColor: '#8B9CF7',
  },
  summaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  summaryButtonTextPrimary: {
    color: '#09090B',
  },
});
