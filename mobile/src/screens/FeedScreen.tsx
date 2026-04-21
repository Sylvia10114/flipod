import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Linking,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeTouchEvent,
  type ListRenderItemInfo,
  type ViewToken,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  buildClipKey,
  getClipSourceExternalUrl,
  getSentenceRange,
  getSourceLabel,
  getWordTimestamp,
} from '../clip-utils';
import {
  GlassCard,
  PillButton,
  PlayerLayout,
  ScreenSurface,
} from '../components/AppChrome';
import { ProgressCard, ReviewCard } from '../components/FeedCards';
import { PlayerControls } from '../components/PlayerControls';
import { ProgressBar } from '../components/ProgressBar';
import { ChallengeWordPills } from '../components/ChallengeWordPills';
import { WordLine } from '../components/WordLine';
import { WordPopup } from '../components/WordPopup';
import { radii, spacing, typography } from '../design';
import { triggerMediumHaptic, triggerUiFeedback } from '../feedback';
import { useFeedPlayer } from '../hooks/useFeedPlayer';
import { useUiI18n } from '../i18n';
import { getLocalizedTopicLabel } from '../i18n/helpers';
import { deriveChallengeWords } from '../learning-scaffold';
import { useResponsiveLayout } from '../responsive';
import { useAppTheme } from '../theme';
import type {
  ChallengeWord,
  Clip,
  ClipLine,
  ClipLineWord,
  DominantHand,
  Profile,
  ReviewState,
  SubtitleSize,
  VocabEntry,
} from '../types';

const ONE_DAY = 24 * 60 * 60 * 1000;
const PREVIEW_MIN_DELAY_MS = 3000;
const PREVIEW_HOLD_DELAY_MS = 320;
const PREVIEW_HOLD_MOVE_TOLERANCE = 12;
const DEBUG_FEED_RESTORE = __DEV__;

function previewDurationMsForWordCount(count: number) {
  if (count <= 2) return PREVIEW_MIN_DELAY_MS;
  if (count === 3) return 4000;
  return 5000;
}

function formatPreviewDurationLabel(clip: Clip) {
  const timelineDuration = clip.lines?.length ? clip.lines[clip.lines.length - 1].end : 0;
  const explicitDuration = typeof clip.duration === 'number' ? clip.duration : 0;
  const clippedDuration = (
    typeof clip.clip_end_sec === 'number'
    && typeof clip.clip_start_sec === 'number'
  )
    ? clip.clip_end_sec - clip.clip_start_sec
    : 0;
  const totalSeconds = Math.max(0, Math.round(explicitDuration || clippedDuration || timelineDuration));
  if (!totalSeconds) return '';
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return remainder === 0 ? `${minutes}min` : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

type Props = {
  clips: Clip[];
  visibleClipCount: number;
  hasMoreClips: boolean;
  isForeground: boolean;
  contentViewportHeight?: number;
  profile: Profile;
  dominantHand: DominantHand;
  playbackRate: number;
  subtitleSize: SubtitleSize;
  feedState: 'loading' | 'normal' | 'rerank' | 'fallback';
  bookmarkedKeys: string[];
  likedKeys: string[];
  recoTag: string | null;
  minutesListened: number;
  reviewState: ReviewState;
  vocabEntries: VocabEntry[];
  vocabWords: string[];
  knownWords: string[];
  clipsPlayed: number;
  showListenCoach: boolean;
  showNavCoach: boolean;
  showWordCoach: boolean;
  onToggleLike: (clip: Clip, index: number) => void;
  onToggleBookmark: (clip: Clip, index: number) => void;
  onSaveVocab: (entry: VocabEntry) => void;
  onMarkKnown: (word: string) => void;
  onDismissListenCoach: () => void;
  onDismissNavCoach: () => void;
  onShowWordCoach: () => void;
  onRecordWordLookup: (cefr?: string, details?: { clip?: Clip | null; word?: string }) => void;
  onReviewAction: (word: string, action: 'remember' | 'forgot') => void;
  onLoadMoreClips: () => void;
  onPlaybackRateChange: (rate: number) => void;
  onSubtitleSizeChange: () => void;
  onClipStarted: (clip: Clip, index: number) => void;
  onClipCompleted: (clip: Clip, index: number, progressRatio: number) => void;
  onClipSkipped: (clip: Clip, index: number, progressRatio: number, dwellMs: number) => void;
  onVisibleClipChange?: (clip: Clip, index: number) => void;
};

type PopupState = {
  word: ClipLineWord;
  contextEn: string;
  contextZh: string;
  clipKey: string;
  clipTitle: string;
  tag?: string;
  contentKey?: string;
  lineIndex?: number;
} | null;

type FeedClipPage = {
  type: 'clip';
  key: string;
  clip: Clip;
  clipIndex: number;
};

type FeedReviewPage = {
  type: 'review';
  key: string;
  entry: VocabEntry;
};

type FeedProgressPage = {
  type: 'progress';
  key: string;
};

type FeedPage = FeedClipPage | FeedReviewPage | FeedProgressPage;

type PreviewSessionState = {
  clipIndex: number;
  startedAt: number;
  durationMs: number;
  isPaused: boolean;
};

function buildPreviewChallengeWords(
  clip: Clip,
  level: Profile['level'],
  knownWords: string[],
): ChallengeWord[] {
  const derived = deriveChallengeWords(clip, level, knownWords);
  if (derived.length > 0) return derived;

  const fallback: ChallengeWord[] = [];
  const seen = new Set<string>();
  for (let lineIndex = 0; lineIndex < (clip.lines || []).length; lineIndex += 1) {
    const line = clip.lines[lineIndex];
    for (const word of line.words || []) {
      const normalized = String(word.word || '').replace(/^[^a-zA-Z]+|[^a-zA-Z'-]+$/g, '').toLowerCase();
      if (!normalized || normalized.length < 4 || seen.has(normalized)) continue;
      seen.add(normalized);
      fallback.push({
        word: word.word,
        cefr: word.cefr,
        lineIndex,
      });
      if (fallback.length >= 3) return fallback;
    }
  }
  return fallback;
}

export function FeedScreen({
  clips,
  visibleClipCount,
  hasMoreClips,
  isForeground,
  contentViewportHeight = 0,
  profile,
  dominantHand,
  playbackRate,
  subtitleSize,
  feedState,
  bookmarkedKeys,
  likedKeys,
  recoTag,
  minutesListened,
  reviewState,
  vocabEntries,
  vocabWords,
  knownWords,
  clipsPlayed,
  showListenCoach,
  showNavCoach,
  showWordCoach,
  onToggleLike,
  onToggleBookmark,
  onSaveVocab,
  onMarkKnown,
  onDismissListenCoach,
  onDismissNavCoach,
  onShowWordCoach,
  onRecordWordLookup,
  onReviewAction,
  onLoadMoreClips,
  onPlaybackRateChange,
  onSubtitleSizeChange,
  onClipStarted,
  onClipCompleted,
  onClipSkipped,
  onVisibleClipChange,
}: Props) {
  const { colors } = useAppTheme();
  const { t, nativeLanguage } = useUiI18n();
  const metrics = useResponsiveLayout();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const data = useMemo(() => clips.slice(0, visibleClipCount), [clips, visibleClipCount]);
  const pageHeight = Math.max(480, contentViewportHeight > 0 ? contentViewportHeight : metrics.windowHeight - insets.bottom);
  const [showZh, setShowZh] = useState(false);
  const [masked, setMasked] = useState(false);
  const [popup, setPopup] = useState<PopupState>(null);
  const [dismissedCards, setDismissedCards] = useState<Set<string>>(new Set());
  const [transcriptIndex, setTranscriptIndex] = useState<number | null>(null);
  const [helpMenuIndex, setHelpMenuIndex] = useState<number | null>(null);
  const [visibleClipIndex, setVisibleClipIndex] = useState<number | null>(null);
  const [visibleRequestId, setVisibleRequestId] = useState<number | null>(null);
  const [pendingAutoplayIndex, setPendingAutoplayIndex] = useState<number | null>(null);
  const [previewSession, setPreviewSession] = useState<PreviewSessionState | null>(null);
  const [previewNow, setPreviewNow] = useState(() => Date.now());
  const [listenCoachVisible, setListenCoachVisible] = useState(false);
  const [navCoachVisible, setNavCoachVisible] = useState(false);
  const listRef = useRef<FlatList<FeedPage> | null>(null);
  const startedRef = useRef<Set<string>>(new Set());
  const completedRef = useRef<Set<string>>(new Set());
  const loadTriggerRef = useRef(0);
  const autoplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoplayTargetRef = useRef<number | null>(null);
  const visibleRequestIdRef = useRef<number | null>(null);
  const requestCounterRef = useRef(0);
  const wasForegroundRef = useRef(isForeground);
  const restoringForegroundRef = useRef(false);
  const latestViewablePageIndexRef = useRef<number | null>(null);
  const lastScrollPageIndexRef = useRef(0);
  const lastStablePageIndexRef = useRef(0);
  const previewSessionRef = useRef<PreviewSessionState | null>(null);
  const previewHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coachTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const previewTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  const previewPausedRef = useRef(false);
  const previewRemainingMsRef = useRef(0);
  const previewPauseProgress = useRef(new Animated.Value(0)).current;
  const sessionRef = useRef<{
    clip: Clip;
    clipIndex: number;
    clipKey: string;
    startedAt: number;
    lastProgress: number;
  } | null>(null);

  const {
    activeIndex,
    activeLineIndex,
    currentRequestId,
    durationMillis,
    errorMessage,
    pendingClipIndex,
    playbackRate: currentPlaybackRate,
    playbackPhase,
    positionMillis,
    playIndex,
    pause,
    requestAutoplay,
    seekNextSentence,
    seekPrevSentence,
    seekToRatio,
    setRate,
    stop,
  } = useFeedPlayer(clips, playbackRate);
  const isCurrentlyPlaying = playbackPhase === 'playing';

  const dismissCard = useCallback((key: string) => {
    setDismissedCards(prev => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const clearAutoplayTimer = useCallback(() => {
    if (!autoplayTimerRef.current) return;
    clearTimeout(autoplayTimerRef.current);
    autoplayTimerRef.current = null;
  }, []);

  const clearRestoreTimer = useCallback(() => {
    if (!restoreTimerRef.current) return;
    clearTimeout(restoreTimerRef.current);
    restoreTimerRef.current = null;
  }, []);

  const clearPreviewHoldTimer = useCallback(() => {
    if (!previewHoldTimerRef.current) return;
    clearTimeout(previewHoldTimerRef.current);
    previewHoldTimerRef.current = null;
  }, []);

  const clearCoachTimers = useCallback(() => {
    if (!coachTimersRef.current.length) return;
    coachTimersRef.current.forEach(timer => clearTimeout(timer));
    coachTimersRef.current = [];
  }, []);

  const setCurrentVisibleRequestId = useCallback((requestId: number | null) => {
    visibleRequestIdRef.current = requestId;
    setVisibleRequestId(requestId);
  }, []);

  const createRequestId = useCallback(() => {
    requestCounterRef.current += 1;
    return requestCounterRef.current;
  }, []);

  const updatePreviewSession = useCallback((
    value: PreviewSessionState | null | ((prev: PreviewSessionState | null) => PreviewSessionState | null)
  ) => {
    setPreviewSession(prev => {
      const next = typeof value === 'function'
        ? (value as (prev: PreviewSessionState | null) => PreviewSessionState | null)(prev)
        : value;
      previewSessionRef.current = next;
      return next;
    });
  }, []);

  const clearPreviewSession = useCallback(() => {
    previewPausedRef.current = false;
    previewRemainingMsRef.current = 0;
    previewTouchStartRef.current = null;
    clearPreviewHoldTimer();
    updatePreviewSession(null);
  }, [clearPreviewHoldTimer, updatePreviewSession]);

  const schedulePreviewAutoplay = useCallback((clipIndex: number, requestId: number, delayMs: number) => {
    clearAutoplayTimer();
    autoplayTimerRef.current = setTimeout(() => {
      if (autoplayTargetRef.current !== clipIndex) return;
      if (visibleRequestIdRef.current !== requestId) return;
      void requestAutoplay(clipIndex, requestId);
    }, delayMs);
  }, [clearAutoplayTimer, requestAutoplay]);

  const logRestoreEvent = useCallback((event: string, details?: Record<string, unknown>) => {
    if (!DEBUG_FEED_RESTORE) return;
    console.log('[feed-restore]', event, {
      visibleClipIndex,
      activeIndex,
      pendingAutoplayIndex,
      lastStablePageIndex: lastStablePageIndexRef.current,
      latestViewablePageIndex: latestViewablePageIndexRef.current,
      lastScrollPageIndex: lastScrollPageIndexRef.current,
      restoringForeground: restoringForegroundRef.current,
      ...details,
    });
  }, [activeIndex, pendingAutoplayIndex, visibleClipIndex]);

  const getAutoplayDelayMs = useCallback((clip: Clip) => {
    const words = buildPreviewChallengeWords(clip, profile.level, knownWords);
    return previewDurationMsForWordCount(words.length);
  }, [knownWords, profile.level]);

  const handleOpenSource = useCallback(async (clip: Clip) => {
    const url = getClipSourceExternalUrl(clip);
    if (!url) return;
    triggerUiFeedback('menu');
    try {
      await Linking.openURL(url);
    } catch {
    }
  }, []);

  const reviewEntries = useMemo(() => {
    const now = Date.now();
    return vocabEntries
      .filter(entry => {
        const timestamp = getWordTimestamp(entry);
        if (!timestamp || now - timestamp < ONE_DAY) return false;
        const normalized = entry.word.toLowerCase();
        const existing = reviewState[normalized];
        return !existing || existing.nextReview <= now;
      })
      .filter(entry => !dismissedCards.has(`review:${entry.word.toLowerCase()}`))
      .sort((a, b) => getWordTimestamp(a) - getWordTimestamp(b))
      .slice(0, 2);
  }, [dismissedCards, reviewState, vocabEntries]);

  const showProgressCard = clipsPlayed > 0 && !dismissedCards.has('progress');
  const challengeWordsByKey = useMemo(() => {
    const mapping = new Map<string, ChallengeWord[]>();
    data.forEach((clip, index) => {
      mapping.set(
        buildClipKey(clip, index),
        buildPreviewChallengeWords(clip, profile.level, knownWords)
      );
    });
    return mapping;
  }, [data, knownWords, profile.level]);
  const feedPages = useMemo<FeedPage[]>(() => {
    const pages: FeedPage[] = [];
    let reviewIndex = 0;

    data.forEach((clip, clipIndex) => {
      pages.push({
        type: 'clip',
        key: buildClipKey(clip, clipIndex),
        clip,
        clipIndex,
      });

      if (clipIndex === 1 && showProgressCard) {
        pages.push({ type: 'progress', key: 'progress' });
      }

      const clipCounter = clipIndex + 1;
      if (clipCounter > 0 && clipCounter % 4 === 0 && reviewIndex < reviewEntries.length) {
        const entry = reviewEntries[reviewIndex++];
        pages.push({
          type: 'review',
          key: `review:${entry.word.toLowerCase()}`,
          entry,
        });
      }
    });

    return pages;
  }, [data, reviewEntries, showProgressCard]);

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 75 });
  const transcriptClip = typeof transcriptIndex === 'number' ? clips[transcriptIndex] : null;
  const helpMenuClip = typeof helpMenuIndex === 'number' ? clips[helpMenuIndex] : null;
  const currentClip = clips[activeIndex];
  const currentTime = positionMillis / 1000;
  const progress = durationMillis > 0 ? positionMillis / durationMillis : 0;
  const currentSentenceRange = currentClip ? getSentenceRange(currentClip, activeLineIndex) : null;
  const cefrSegments = useMemo(() => {
    const buckets = { a12: 0, b1: 0, b2plus: 0 };
    vocabEntries.forEach(entry => {
      const cefr = (entry.cefr || '').toUpperCase();
      if (cefr === 'B1') {
        buckets.b1 += 1;
      } else if (cefr === 'B2' || cefr === 'C1' || cefr === 'C2') {
        buckets.b2plus += 1;
      } else {
        buckets.a12 += 1;
      }
    });
    return [
      { label: 'A1/A2', value: buckets.a12, color: colors.cefrB1, labelColor: colors.textPrimary },
      { label: 'B1', value: buckets.b1, color: colors.cefrB2, labelColor: colors.cefrB1 },
      { label: 'B2+', value: buckets.b2plus, color: colors.cefrC1, labelColor: colors.cefrB2 },
    ];
  }, [vocabEntries]);
  const playerWidth = metrics.playerContentWidth;
  const feedStatusText = useMemo(() => {
    switch (feedState) {
      case 'loading':
        return t('feed.statusLoading');
      case 'rerank':
        return t('feed.statusRerank');
      case 'fallback':
        return t('feed.statusFallback');
      case 'normal':
      default:
        return t('feed.statusNormal');
    }
  }, [feedState, t]);
  const lineWrapWidth = Math.min(
    Math.max(playerWidth - (metrics.isTablet ? 120 : 72), 240),
    metrics.isTablet ? 560 : 320
  );
  const previewClipIndex = previewSession?.clipIndex ?? null;
  const previewClip = typeof previewClipIndex === 'number' ? clips[previewClipIndex] : null;
  const previewClipKey = previewClip && typeof previewClipIndex === 'number'
    ? buildClipKey(previewClip, previewClipIndex)
    : null;
  const previewChallengeWords = previewClipKey
    ? challengeWordsByKey.get(previewClipKey) || []
    : [];
  const showPreviewOverlay = Boolean(
    previewClip
    && previewSession
    && pendingAutoplayIndex === previewClipIndex
    && visibleClipIndex === previewClipIndex
    && previewChallengeWords.length > 0
  );
  const previewRemainingMs = showPreviewOverlay && previewSession
    ? (
        previewSession.isPaused
          ? previewSession.durationMs
          : Math.max(0, previewSession.durationMs - (previewNow - previewSession.startedAt))
      )
    : 0;
  const previewSeconds = Math.max(1, Math.ceil(previewRemainingMs / 1000));
  const isPreviewPaused = Boolean(previewSession?.isPaused);
  const previewMeta = previewClip
    ? [
        getSourceLabel(previewClip.source),
        previewClip.difficulty || profile.level || '',
        formatPreviewDurationLabel(previewClip),
      ].filter(Boolean).join('  ·  ')
    : '';
  const previewPauseBackdropOpacity = previewPauseProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });
  const previewPauseCardScale = previewPauseProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.985],
  });
  const previewPauseCardTranslateY = previewPauseProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -4],
  });
  const previewPauseBadgeOpacity = previewPauseProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });
  const previewPauseBadgeTranslateY = previewPauseProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [8, 0],
  });
  const previewPauseRingScale = previewPauseProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.06],
  });
  const previewPauseRingWashOpacity = previewPauseProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const finalizeSession = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;

    const dwellMs = Date.now() - session.startedAt;
    if (session.lastProgress < 0.3 && dwellMs >= 3000) {
      onClipSkipped(session.clip, session.clipIndex, session.lastProgress, dwellMs);
    }

    sessionRef.current = null;
  }, [onClipSkipped]);

  const clearVisiblePageState = useCallback(() => {
    autoplayTargetRef.current = null;
    clearPreviewSession();
    setHelpMenuIndex(null);
    setVisibleClipIndex(null);
    setCurrentVisibleRequestId(null);
    setPendingAutoplayIndex(null);
    clearAutoplayTimer();
    finalizeSession();
    void stop();
  }, [clearAutoplayTimer, clearPreviewSession, finalizeSession, setCurrentVisibleRequestId, stop]);

  const pausePreviewCountdown = useCallback(() => {
    const session = previewSessionRef.current;
    if (!session || session.isPaused) return;
    if (pendingAutoplayIndex !== session.clipIndex || visibleClipIndex !== session.clipIndex) return;
    const remainingMs = Math.max(0, session.durationMs - (Date.now() - session.startedAt));
    previewPausedRef.current = true;
    previewRemainingMsRef.current = remainingMs;
    triggerMediumHaptic();
    clearAutoplayTimer();
    setPreviewNow(Date.now());
    updatePreviewSession({
      ...session,
      startedAt: Date.now(),
      durationMs: remainingMs,
      isPaused: true,
    });
  }, [clearAutoplayTimer, pendingAutoplayIndex, updatePreviewSession, visibleClipIndex]);

  const resumePreviewCountdown = useCallback(() => {
    const session = previewSessionRef.current;
    const requestId = visibleRequestIdRef.current;
    if (!session || !session.isPaused || requestId === null) return;
    if (pendingAutoplayIndex !== session.clipIndex || visibleClipIndex !== session.clipIndex) return;
    const remainingMs = Math.max(0, session.durationMs);
    previewPausedRef.current = false;
    previewRemainingMsRef.current = remainingMs;
    if (remainingMs <= 0) {
      void requestAutoplay(session.clipIndex, requestId);
      return;
    }
    updatePreviewSession({
      ...session,
      startedAt: Date.now(),
      isPaused: false,
    });
    setPreviewNow(Date.now());
    schedulePreviewAutoplay(session.clipIndex, requestId, remainingMs);
  }, [pendingAutoplayIndex, requestAutoplay, schedulePreviewAutoplay, updatePreviewSession, visibleClipIndex]);

  const handlePreviewTouchStart = useCallback((event: NativeSyntheticEvent<NativeTouchEvent>) => {
    if (!showPreviewOverlay) return;
    previewTouchStartRef.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
    clearPreviewHoldTimer();
    previewHoldTimerRef.current = setTimeout(() => {
      pausePreviewCountdown();
    }, PREVIEW_HOLD_DELAY_MS);
  }, [clearPreviewHoldTimer, pausePreviewCountdown, showPreviewOverlay]);

  const handlePreviewTouchMove = useCallback((event: NativeSyntheticEvent<NativeTouchEvent>) => {
    if (!showPreviewOverlay || previewPausedRef.current) return;
    const start = previewTouchStartRef.current;
    if (!start || !previewHoldTimerRef.current) return;
    const dx = event.nativeEvent.pageX - start.x;
    const dy = event.nativeEvent.pageY - start.y;
    if (Math.hypot(dx, dy) > PREVIEW_HOLD_MOVE_TOLERANCE) {
      clearPreviewHoldTimer();
      previewTouchStartRef.current = null;
    }
  }, [clearPreviewHoldTimer, showPreviewOverlay]);

  const handlePreviewTouchEnd = useCallback(() => {
    clearPreviewHoldTimer();
    previewTouchStartRef.current = null;
    if (previewPausedRef.current) {
      resumePreviewCountdown();
    }
  }, [clearPreviewHoldTimer, resumePreviewCountdown]);

  const activateVisibleClipPage = useCallback((page: FeedClipPage) => {
    logRestoreEvent('activate-visible-clip-page', {
      pageIndex: feedPages.findIndex(candidate => candidate.key === page.key),
      clipIndex: page.clipIndex,
      title: page.clip.title,
    });
    setHelpMenuIndex(prev => (prev !== page.clipIndex ? null : prev));
    setVisibleClipIndex(page.clipIndex);
    onVisibleClipChange?.(page.clip, page.clipIndex);
    const loadThreshold = Math.max(0, data.length - 3);
    if (hasMoreClips && page.clipIndex >= loadThreshold && loadTriggerRef.current < data.length) {
      loadTriggerRef.current = data.length;
      onLoadMoreClips();
    }

    const sameClipAlreadyStable = page.clipIndex === activeIndex
      && (playbackPhase === 'playing' || playbackPhase === 'loading');
    if (sameClipAlreadyStable) {
      autoplayTargetRef.current = page.clipIndex;
      setPendingAutoplayIndex(null);
      clearPreviewSession();
      clearAutoplayTimer();
      setCurrentVisibleRequestId(currentRequestId);
      return;
    }

    if (autoplayTargetRef.current === page.clipIndex && pendingAutoplayIndex === page.clipIndex) {
      return;
    }

    finalizeSession();
    autoplayTargetRef.current = page.clipIndex;
    const requestId = createRequestId();
    const previewDurationMs = getAutoplayDelayMs(page.clip);
    setCurrentVisibleRequestId(requestId);
    setPendingAutoplayIndex(page.clipIndex);
    previewPausedRef.current = false;
    previewRemainingMsRef.current = previewDurationMs;
    updatePreviewSession({
      clipIndex: page.clipIndex,
      startedAt: Date.now(),
      durationMs: previewDurationMs,
      isPaused: false,
    });
    void stop();
    schedulePreviewAutoplay(page.clipIndex, requestId, previewDurationMs);
  }, [
    activeIndex,
    clearAutoplayTimer,
    clearPreviewSession,
    createRequestId,
    currentRequestId,
    data.length,
    finalizeSession,
    getAutoplayDelayMs,
    hasMoreClips,
    onLoadMoreClips,
    onVisibleClipChange,
    pendingAutoplayIndex,
    playbackPhase,
    requestAutoplay,
    schedulePreviewAutoplay,
    setCurrentVisibleRequestId,
    stop,
    feedPages,
    updatePreviewSession,
    logRestoreEvent,
  ]);

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (!isForeground) return;
    const firstVisible = viewableItems.find(viewable => viewable.isViewable && typeof viewable.index === 'number');
    if (!firstVisible || typeof firstVisible.index !== 'number') return;
    latestViewablePageIndexRef.current = firstVisible.index;
    const firstPage = feedPages[firstVisible.index];
    logRestoreEvent('viewable-change', {
      pageIndex: firstVisible.index,
      pageType: firstPage?.type,
      clipIndex: firstPage?.type === 'clip' ? firstPage.clipIndex : null,
      title: firstPage?.type === 'clip' ? firstPage.clip.title : null,
    });
    if (restoringForegroundRef.current) return;

    const page = firstPage;
    if (!page) return;

    if (page.type === 'clip') {
      lastStablePageIndexRef.current = firstVisible.index;
      activateVisibleClipPage(page);
      return;
    }

    clearVisiblePageState();
  }, [
    activateVisibleClipPage,
    clearVisiblePageState,
    feedPages,
    isForeground,
    logRestoreEvent,
  ]);

  const onMomentumScrollEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextPageIndex = Math.max(0, Math.round(event.nativeEvent.contentOffset.y / pageHeight));
    lastScrollPageIndexRef.current = nextPageIndex;
    const page = feedPages[nextPageIndex];
    if (page?.type === 'clip' && !restoringForegroundRef.current) {
      lastStablePageIndexRef.current = nextPageIndex;
      activateVisibleClipPage(page);
    } else if (page && page.type !== 'clip' && !restoringForegroundRef.current) {
      clearVisiblePageState();
    }
    logRestoreEvent('momentum-scroll-end', {
      pageIndex: nextPageIndex,
      pageType: page?.type,
      clipIndex: page?.type === 'clip' ? page.clipIndex : null,
      title: page?.type === 'clip' ? page.clip.title : null,
    });
  }, [activateVisibleClipPage, clearVisiblePageState, feedPages, logRestoreEvent, pageHeight]);

  React.useEffect(() => {
    if (loadTriggerRef.current > data.length || visibleClipCount <= 10) {
      loadTriggerRef.current = 0;
    }
  }, [data.length, visibleClipCount]);

  React.useEffect(() => {
    if (pendingAutoplayIndex === null) return;
    if (activeIndex !== pendingAutoplayIndex) return;
    if (currentRequestId === null || currentRequestId !== visibleRequestIdRef.current) return;
    if (
      playbackPhase !== 'loading'
      && playbackPhase !== 'playing'
      && playbackPhase !== 'paused'
      && playbackPhase !== 'error'
    ) {
      return;
    }
    setPendingAutoplayIndex(null);
    clearPreviewSession();
  }, [activeIndex, clearPreviewSession, currentRequestId, pendingAutoplayIndex, playbackPhase]);

  React.useEffect(() => {
    if (!isCurrentlyPlaying) return;

    const clip = clips[activeIndex];
    if (!clip) return;

    const clipKey = buildClipKey(clip, activeIndex);
    if (sessionRef.current?.clipKey !== clipKey) {
      finalizeSession();
      sessionRef.current = {
        clip,
        clipIndex: activeIndex,
        clipKey,
        startedAt: Date.now(),
        lastProgress: progress,
      };
    } else {
      sessionRef.current.lastProgress = progress;
    }

    if (!startedRef.current.has(clipKey)) {
      startedRef.current.add(clipKey);
      onClipStarted(clip, activeIndex);
    }
  }, [activeIndex, clips, finalizeSession, isCurrentlyPlaying, onClipStarted, progress]);

  React.useEffect(() => {
    if (!isCurrentlyPlaying) return;
    const clip = clips[activeIndex];
    if (!clip || progress < 0.8) return;

    const clipKey = buildClipKey(clip, activeIndex);
    if (completedRef.current.has(clipKey)) return;
    completedRef.current.add(clipKey);
    onClipCompleted(clip, activeIndex, progress);
  }, [activeIndex, clips, isCurrentlyPlaying, onClipCompleted, progress]);

  React.useEffect(() => {
    return () => {
      clearRestoreTimer();
      clearAutoplayTimer();
      clearPreviewHoldTimer();
      clearCoachTimers();
      finalizeSession();
    };
  }, [clearAutoplayTimer, clearCoachTimers, clearPreviewHoldTimer, clearRestoreTimer, finalizeSession]);

  React.useEffect(() => {
    if (!previewSession || previewSession.isPaused) return;
    const timer = setInterval(() => {
      setPreviewNow(Date.now());
    }, 80);
    return () => clearInterval(timer);
  }, [previewSession]);

  React.useEffect(() => {
    Animated.spring(previewPauseProgress, {
      toValue: isPreviewPaused ? 1 : 0,
      useNativeDriver: true,
      tension: 170,
      friction: 18,
    }).start();
  }, [isPreviewPaused, previewPauseProgress]);

  React.useEffect(() => {
    if (wasForegroundRef.current && !isForeground) {
      wasForegroundRef.current = false;
      restoringForegroundRef.current = false;
      const capturePageIndex = typeof latestViewablePageIndexRef.current === 'number'
        ? latestViewablePageIndexRef.current
        : lastScrollPageIndexRef.current;
      const capturePage = feedPages[capturePageIndex];
      if (capturePage?.type === 'clip') {
        lastStablePageIndexRef.current = capturePageIndex;
      }
      logRestoreEvent('foreground-hide', {
        capturedPageIndex: capturePageIndex,
        capturedPageType: capturePage?.type,
        capturedClipIndex: capturePage?.type === 'clip' ? capturePage.clipIndex : null,
        capturedTitle: capturePage?.type === 'clip' ? capturePage.clip.title : null,
      });
      latestViewablePageIndexRef.current = null;
      clearRestoreTimer();
      clearVisiblePageState();
      clearCoachTimers();
      setListenCoachVisible(false);
      setNavCoachVisible(false);
      setTranscriptIndex(null);
      sessionRef.current = null;
      return;
    }

    if (!wasForegroundRef.current && isForeground) {
      wasForegroundRef.current = true;
      restoringForegroundRef.current = true;
      clearRestoreTimer();
      const fallbackPageIndex = Math.max(0, Math.min(lastStablePageIndexRef.current, Math.max(feedPages.length - 1, 0)));
      logRestoreEvent('foreground-show', {
        fallbackPageIndex,
        fallbackPageType: feedPages[fallbackPageIndex]?.type,
        fallbackClipIndex: feedPages[fallbackPageIndex]?.type === 'clip' ? feedPages[fallbackPageIndex].clipIndex : null,
        fallbackTitle: feedPages[fallbackPageIndex]?.type === 'clip' ? feedPages[fallbackPageIndex].clip.title : null,
      });
      requestAnimationFrame(() => {
        listRef.current?.scrollToIndex({ index: fallbackPageIndex, animated: false });
      });
      restoreTimerRef.current = setTimeout(() => {
        restoringForegroundRef.current = false;
        const latestIndex = latestViewablePageIndexRef.current;
        const candidateIndex = typeof latestIndex === 'number' ? latestIndex : fallbackPageIndex;
        const candidatePage = feedPages[candidateIndex];
        logRestoreEvent('foreground-restore-finalize', {
          candidateIndex,
          candidatePageType: candidatePage?.type,
          candidateClipIndex: candidatePage?.type === 'clip' ? candidatePage.clipIndex : null,
          candidateTitle: candidatePage?.type === 'clip' ? candidatePage.clip.title : null,
        });
        if (candidatePage?.type === 'clip') {
          lastStablePageIndexRef.current = candidateIndex;
          activateVisibleClipPage(candidatePage);
          return;
        }
        const fallbackPage = feedPages[fallbackPageIndex];
        if (fallbackPage?.type === 'clip') {
          lastStablePageIndexRef.current = fallbackPageIndex;
          activateVisibleClipPage(fallbackPage);
          return;
        }
        clearVisiblePageState();
      }, 180);
    }
  }, [activateVisibleClipPage, clearRestoreTimer, clearVisiblePageState, feedPages, isForeground]);

  React.useEffect(() => {
    const scheduleNavCoach = (delayMs: number) => {
      coachTimersRef.current.push(setTimeout(() => {
        setNavCoachVisible(true);
      }, delayMs));
      coachTimersRef.current.push(setTimeout(() => {
        setNavCoachVisible(false);
        onDismissNavCoach();
      }, delayMs + 2600));
    };

    clearCoachTimers();
    setListenCoachVisible(false);
    setNavCoachVisible(false);

    if (!isForeground || visibleClipIndex === null || popup || showPreviewOverlay) {
      return;
    }

    if (showListenCoach) {
      coachTimersRef.current.push(setTimeout(() => {
        setListenCoachVisible(true);
      }, 700));
      coachTimersRef.current.push(setTimeout(() => {
        setListenCoachVisible(false);
        onDismissListenCoach();
        if (showNavCoach) {
          scheduleNavCoach(260);
        }
      }, 3300));
      return () => clearCoachTimers();
    }

    if (showNavCoach) {
      scheduleNavCoach(480);
    }

    return () => clearCoachTimers();
  }, [
    clearCoachTimers,
    isForeground,
    onDismissListenCoach,
    onDismissNavCoach,
    popup,
    showListenCoach,
    showNavCoach,
    showPreviewOverlay,
    visibleClipIndex,
  ]);

  return (
    <ScreenSurface edges={['left', 'right', 'bottom']}>
      <View
        style={styles.screenBody}
        onTouchStart={handlePreviewTouchStart}
        onTouchMove={handlePreviewTouchMove}
        onTouchEnd={handlePreviewTouchEnd}
        onTouchCancel={handlePreviewTouchEnd}
      >
        <FlatList
          ref={listRef}
          data={feedPages}
          keyExtractor={item => item.key}
          pagingEnabled
          snapToInterval={pageHeight}
          getItemLayout={(_, index) => ({
            length: pageHeight,
            offset: pageHeight * index,
            index,
          })}
          decelerationRate="fast"
          showsVerticalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          onMomentumScrollEnd={onMomentumScrollEnd}
          viewabilityConfig={viewabilityConfig.current}
          renderItem={({ item }: ListRenderItemInfo<FeedPage>) => {
          if (item.type === 'review') {
            return (
              <View
                style={[
                  styles.cardPage,
                  {
                    height: pageHeight,
                    paddingBottom: 18 + insets.bottom,
                    paddingHorizontal: metrics.pageHorizontalPadding,
                  },
                ]}
              >
                <ReviewCard
                  entry={item.entry}
                  onForgot={() => {
                    onReviewAction(item.entry.word, 'forgot');
                    dismissCard(`review:${item.entry.word.toLowerCase()}`);
                  }}
                  onRemember={() => {
                    onReviewAction(item.entry.word, 'remember');
                    dismissCard(`review:${item.entry.word.toLowerCase()}`);
                  }}
                />
              </View>
            );
          }

          if (item.type === 'progress') {
            return (
              <View
                style={[
                  styles.cardPage,
                  {
                    height: pageHeight,
                    paddingBottom: 18 + insets.bottom,
                    paddingHorizontal: metrics.pageHorizontalPadding,
                  },
                ]}
              >
                <ProgressCard
                  clipsPlayed={clipsPlayed}
                  minutesListened={minutesListened}
                  newWordsCount={vocabEntries.length}
                  cefrSegments={cefrSegments}
                  onDismiss={() => dismissCard('progress')}
                />
              </View>
            );
          }

          const clip = item.clip;
          const index = item.clipIndex;
          const isActive = index === activeIndex;
          const isVisible = index === visibleClipIndex;
          const showLoadingOverlay = isVisible
            && isActive
            && playbackPhase === 'loading'
            && pendingClipIndex === index
            && (visibleRequestId === null || currentRequestId === visibleRequestId);
          const line = isActive ? clip.lines?.[activeLineIndex] : clip.lines?.[0];
          const clipKey = item.key;
          const liked = likedKeys.includes(clipKey);
          const saved = bookmarkedKeys.includes(clipKey);
          const challengeWords = challengeWordsByKey.get(clipKey) || [];

          return (
            <View
              pointerEvents={showPreviewOverlay && isVisible ? 'none' : 'auto'}
              style={[styles.page, { height: pageHeight, paddingBottom: 18 + insets.bottom }]}
            >
              <PlayerLayout
                header={
                  <View style={[styles.headerBlock, { width: playerWidth }]}>
                    <View style={styles.headerStatusRow}>
                      <View style={styles.headerStatusSpacer} />
                      <Text style={styles.feedStatusText}>{feedStatusText}</Text>
                      <Pressable
                        onPress={() => {
                          triggerUiFeedback('menu');
                          setHelpMenuIndex(index);
                        }}
                        style={styles.iconButton}
                        hitSlop={12}
                      >
                        <Feather name="help-circle" size={18} color={colors.textSecondary} />
                      </Pressable>
                    </View>
                    <View style={styles.headerCopy}>
                      <Text style={styles.clipTitle}>{clip.title}</Text>
                      <Text style={styles.clipSource}>
                        {getSourceLabel(clip.source)}
                        {clip.tag ? ` · ${getLocalizedTopicLabel(clip.tag, t)}` : ''}
                      </Text>
                      {clip._aiReason ? <Text style={styles.clipReason}>{clip._aiReason}</Text> : null}
                      {isVisible && listenCoachVisible ? (
                        <View style={styles.coachHintWrap}>
                          <GlassCard style={styles.coachHintCard}>
                            <Text style={styles.coachHintText}>{t('feedCoach.listenHint')}</Text>
                          </GlassCard>
                        </View>
                      ) : null}
                    </View>
                  </View>
                }
                controls={
                  <View style={[styles.controlsWrap, { width: playerWidth }]}>
                    <PlayerControls
                      playbackPhase={isActive ? playbackPhase : 'idle'}
                      disabled={isActive && playbackPhase === 'loading'}
                      positionMillis={isActive ? positionMillis : 0}
                      durationMillis={isActive ? durationMillis : 0}
                      playbackRate={currentPlaybackRate}
                      subtitleSize={subtitleSize}
                      dominantHand={dominantHand}
                      showZh={showZh}
                      masked={masked}
                      progressBar={(
                        <ProgressBar
                          progress={isActive ? progress : 0}
                          markers={[]}
                          currentSentenceRange={isActive ? currentSentenceRange : null}
                          onSeek={ratio => {
                            if (!isActive) return;
                            void seekToRatio(ratio);
                          }}
                        />
                      )}
                      onTogglePlay={() => {
                        autoplayTargetRef.current = index;
                        setVisibleClipIndex(index);
                        clearAutoplayTimer();
                        if (isActive && playbackPhase === 'loading') {
                          return;
                        }
                        if (isActive && playbackPhase === 'playing') {
                          void pause();
                          return;
                        }
                        const requestId = (index === pendingAutoplayIndex) && visibleRequestIdRef.current
                          ? visibleRequestIdRef.current
                          : createRequestId();
                        setCurrentVisibleRequestId(requestId);
                        setPendingAutoplayIndex(null);
                        void playIndex(index, requestId);
                      }}
                      onSeekPrevSentence={() => {
                        if (!isActive) return;
                        void seekPrevSentence();
                      }}
                      onSeekNextSentence={() => {
                        if (!isActive) return;
                        void seekNextSentence();
                      }}
                      onSetRate={rate => {
                        void setRate(rate);
                        onPlaybackRateChange(rate);
                      }}
                      onCycleSubtitleSize={onSubtitleSizeChange}
                      onToggleZh={() => {
                        if (showListenCoach) {
                          clearCoachTimers();
                          setListenCoachVisible(false);
                          onDismissListenCoach();
                          if (showNavCoach) {
                            coachTimersRef.current.push(setTimeout(() => {
                              setNavCoachVisible(true);
                            }, 180));
                            coachTimersRef.current.push(setTimeout(() => {
                              setNavCoachVisible(false);
                              onDismissNavCoach();
                            }, 2780));
                          }
                        }
                        setShowZh(prev => !prev);
                      }}
                      onToggleMask={() => setMasked(prev => !prev)}
                    />
                    {isVisible && navCoachVisible ? (
                      <View style={styles.navCoachWrap}>
                        <Text style={styles.navCoachText}>{t('feedCoach.navHint')}</Text>
                      </View>
                    ) : null}
                  </View>
                }
              >
                <View style={[styles.contentStage, { width: playerWidth }]}>
                  {showLoadingOverlay ? (
                    <View style={styles.loadingOverlay}>
                      <View style={styles.loadingOverlayCard}>
                        <ActivityIndicator size="small" color={colors.textPrimary} />
                        <Text style={styles.loadingOverlayText}>{t('feed.preparingPlayback')}</Text>
                      </View>
                    </View>
                  ) : null}
                  <View style={[styles.sideRail, styles.sideRailRight]}>
                    <Pressable
                      onPress={() => onToggleLike(clip, index)}
                      style={styles.sideButton}
                    >
                      <Ionicons
                        name={liked ? 'heart' : 'heart-outline'}
                        size={24}
                        color={liked ? colors.textPrimary : colors.textTertiary}
                      />
                    </Pressable>
                    <Pressable onPress={() => onToggleBookmark(clip, index)} style={styles.sideButton}>
                      <Ionicons
                        name={saved ? 'bookmark' : 'bookmark-outline'}
                        size={24}
                        color={saved ? colors.textPrimary : colors.textTertiary}
                      />
                    </Pressable>
                  </View>

                  <View style={[styles.lineWrap, { width: lineWrapWidth }]}>
                    {line ? (
                      <WordLine
                        line={line}
                        currentTime={isActive ? currentTime : 0}
                        isActive={isActive}
                        showZh={showZh}
                        masked={masked}
                        subtitleSize={subtitleSize}
                        onWordTap={(word: ClipLineWord, lineData: ClipLine) => {
                          onRecordWordLookup(word.cefr, {
                            clip,
                            word: word.word,
                          });
                          if (showWordCoach) {
                            onShowWordCoach();
                          }
                          triggerUiFeedback('card');
                          setPopup({
                            word,
                            contextEn: lineData.en,
                            contextZh: lineData.zh || '',
                            clipKey,
                            clipTitle: clip.title,
                            tag: clip.tag,
                            contentKey: clip.contentKey,
                            lineIndex: isActive ? activeLineIndex : 0,
                          });
                        }}
                      />
                    ) : null}
                    {!showZh ? <View style={styles.translationBar} /> : null}
                    {isVisible && errorMessage ? <Text style={styles.audioStateError}>{errorMessage}</Text> : null}
                  </View>
                </View>
              </PlayerLayout>
            </View>
          );
          }}
        />

        {showPreviewOverlay && previewClip ? (
          <View pointerEvents="none" style={styles.previewOverlay}>
            <Animated.View
              pointerEvents="none"
              style={[styles.previewPauseBackdrop, { opacity: previewPauseBackdropOpacity }]}
            />
            <View style={[styles.page, { height: pageHeight, paddingBottom: 18 + insets.bottom }]}>
              <View style={[styles.primingPage, { width: playerWidth }]}>
                <View style={styles.primingPageHeader} />

                <View style={styles.primingPageBody}>
                  <View style={styles.primingTopInfo}>
                    <Text style={styles.primingMetaLine}>{previewMeta}</Text>
                    <Text style={styles.primingSummary}>{previewClip.title}</Text>
                  </View>

                  <Animated.View
                    style={{
                      transform: [
                        { scale: previewPauseCardScale },
                        { translateY: previewPauseCardTranslateY },
                      ],
                    }}
                  >
                    <GlassCard style={[styles.primingPreviewPageCard, { width: Math.min(playerWidth, 360) }]}>
                      <Animated.View
                        style={[
                          styles.primingPauseBadge,
                          {
                            opacity: previewPauseBadgeOpacity,
                            transform: [{ translateY: previewPauseBadgeTranslateY }],
                          },
                        ]}
                      >
                        <Ionicons name="pause" size={12} color={colors.textPrimary} />
                        <Text style={styles.primingPauseBadgeText}>{t('common.pause')}</Text>
                      </Animated.View>
                      <Animated.View
                        pointerEvents="none"
                        style={[styles.primingPreviewPauseWash, { opacity: previewPauseBackdropOpacity }]}
                      />
                      <Text style={styles.primingPreviewLabel}>
                        {t('feed.primingPreview', { count: previewChallengeWords.length })}
                      </Text>
                      <ChallengeWordPills words={previewChallengeWords} tone="feed" variant="preview" />
                    </GlassCard>
                  </Animated.View>

                  <Text style={styles.primingSwipeHint}>{t('feed.previewSwipeHint')}</Text>

                  <View style={styles.primingCountdownWrap}>
                    <Animated.View
                      style={[
                        styles.primingCountdownRing,
                        { transform: [{ scale: previewPauseRingScale }] },
                      ]}
                    >
                      <Animated.View
                        pointerEvents="none"
                        style={[styles.primingCountdownRingWash, { opacity: previewPauseRingWashOpacity }]}
                      />
                      <View style={styles.primingCountdownInner}>
                        <Text style={styles.primingCountdownText}>{previewSeconds}</Text>
                        <Animated.View
                          style={[
                            styles.primingCountdownPauseRow,
                            { opacity: previewPauseBadgeOpacity },
                          ]}
                        >
                          <Ionicons name="pause" size={10} color={colors.textPrimary} />
                          <Text style={styles.primingCountdownPauseLabel}>{t('common.pause')}</Text>
                        </Animated.View>
                      </View>
                    </Animated.View>
                    <Text style={[styles.primingHoldHint, isPreviewPaused ? styles.primingHoldHintPaused : null]}>
                      {isPreviewPaused ? t('menu.continueListening') : t('feed.previewHoldHint')}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </View>
        ) : null}

        <Modal
          visible={Boolean(helpMenuClip)}
          transparent
          animationType="fade"
          onRequestClose={() => setHelpMenuIndex(null)}
        >
          <View style={styles.helpMenuOverlay}>
            <Pressable style={styles.helpMenuBackdrop} onPress={() => setHelpMenuIndex(null)} />
            <View
              style={[
                styles.helpMenuSheetWrap,
                {
                  paddingBottom: insets.bottom + 12,
                  paddingHorizontal: metrics.pageHorizontalPadding,
                },
              ]}
            >
              <GlassCard style={[styles.helpMenuCard, { maxWidth: metrics.modalMaxWidth }]}>
                <Pressable
                  onPress={() => {
                    if (helpMenuIndex === null) return;
                    setHelpMenuIndex(null);
                    triggerUiFeedback('menu');
                    setTranscriptIndex(helpMenuIndex);
                  }}
                  style={({ pressed }) => [styles.helpMenuItem, pressed && styles.helpMenuItemPressed]}
                >
                  <Text style={styles.helpMenuLabel}>{t('feed.menuTranscript')}</Text>
                </Pressable>

                <Pressable
                  disabled={!helpMenuClip || !getClipSourceExternalUrl(helpMenuClip)}
                  onPress={() => {
                    if (!helpMenuClip) return;
                    setHelpMenuIndex(null);
                    void handleOpenSource(helpMenuClip);
                  }}
                  style={({ pressed }) => [
                    styles.helpMenuItem,
                    (!helpMenuClip || !getClipSourceExternalUrl(helpMenuClip)) ? styles.helpMenuItemDisabled : null,
                    pressed && helpMenuClip && getClipSourceExternalUrl(helpMenuClip) ? styles.helpMenuItemPressed : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.helpMenuLabel,
                      (!helpMenuClip || !getClipSourceExternalUrl(helpMenuClip)) ? styles.helpMenuLabelDisabled : null,
                    ]}
                  >
                    {t('feed.menuOriginalPodcast')}
                  </Text>
                  {!helpMenuClip || !getClipSourceExternalUrl(helpMenuClip) ? (
                    <Text style={styles.helpMenuBadge}>{t('feed.menuUnavailable')}</Text>
                  ) : null}
                </Pressable>

                <Pressable style={[styles.helpMenuItem, styles.helpMenuItemDisabled]} disabled>
                  <Text style={[styles.helpMenuLabel, styles.helpMenuLabelDisabled]}>{t('feed.menuFeedback')}</Text>
                  <Text style={styles.helpMenuBadge}>{t('feed.comingSoon')}</Text>
                </Pressable>
              </GlassCard>
            </View>
          </View>
        </Modal>

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
                contentKey: popup.contentKey,
                lineIndex: popup.lineIndex,
                clipKey: popup.clipKey,
                clipTitle: popup.clipTitle,
                tag: popup.tag,
                sourceType: 'feed',
                practiced: false,
              });
            }}
            onMarkKnown={() => onMarkKnown(popup.word.word.toLowerCase())}
            onDismiss={() => setPopup(null)}
          />
        ) : null}

        <Modal
          visible={Boolean(transcriptClip)}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setTranscriptIndex(null)}
        >
          <SafeAreaView style={styles.transcriptSafeArea}>
            <View style={[styles.transcriptHeader, { paddingHorizontal: metrics.pageHorizontalPadding }]}>
              <View style={[styles.transcriptHeaderInner, { maxWidth: metrics.modalMaxWidth }]}>
                <View style={styles.transcriptHeaderCopy}>
                  <Text style={styles.transcriptTitle}>{transcriptClip?.title}</Text>
                  <Text style={styles.transcriptMeta}>
                    {transcriptClip ? getSourceLabel(transcriptClip.source) : ''}
                  </Text>
                </View>
                <PillButton label={t('common.close')} onPress={() => setTranscriptIndex(null)} />
              </View>
            </View>

            <ScrollView
              contentContainerStyle={[
                styles.transcriptBody,
                {
                  paddingHorizontal: metrics.pageHorizontalPadding,
                  maxWidth: metrics.modalMaxWidth,
                  alignSelf: 'center',
                  width: '100%',
                },
              ]}
            >
              {(transcriptClip?.lines || []).map((entry, idx) => (
                <GlassCard key={`${idx}-${entry.start}`} style={styles.transcriptLine}>
                  <Text
                    style={[
                      styles.transcriptEn,
                      subtitleSize === 'sm' && styles.transcriptEnSmall,
                      subtitleSize === 'lg' && styles.transcriptEnLarge,
                    ]}
                  >
                    {entry.en}
                  </Text>
                  <Text
                    style={[
                      styles.transcriptZh,
                      subtitleSize === 'sm' && styles.transcriptZhSmall,
                      subtitleSize === 'lg' && styles.transcriptZhLarge,
                    ]}
                  >
                    {entry.zh}
                  </Text>
                </GlassCard>
              ))}
            </ScrollView>
          </SafeAreaView>
        </Modal>
      </View>
    </ScreenSurface>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
return StyleSheet.create({
  screenBody: {
    flex: 1,
  },
  page: {
    justifyContent: 'space-between',
  },
  previewOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
    backgroundColor: colors.bgApp,
  },
  previewPauseBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(7, 10, 18, 0.12)',
  },
  cardPage: {
    justifyContent: 'center',
    paddingHorizontal: spacing.page,
  },
  headerBlock: {
    gap: spacing.sm,
  },
  challengeWordRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: 2,
  },
  challengeWordPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(139,156,247,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(139,156,247,0.24)',
  },
  challengeWordText: {
    color: colors.textPrimary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  challengeWordBadge: {
    color: colors.accentFeed,
    fontSize: typography.micro,
    fontWeight: '700',
  },
  headerStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerStatusSpacer: {
    width: 28,
    height: 28,
  },
  iconButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedStatusText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: typography.micro,
    lineHeight: 18,
    textAlign: 'center',
  },
  headerCopy: {
    alignItems: 'center',
    gap: 6,
  },
  coachHintWrap: {
    marginTop: spacing.xs,
  },
  coachHintCard: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.bgSurface1,
  },
  coachHintText: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    lineHeight: 18,
    textAlign: 'center',
    maxWidth: 260,
  },
  clipTitle: {
    color: colors.textPrimary,
    fontSize: typography.title,
    fontWeight: '700',
    textAlign: 'center',
  },
  clipSource: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    textAlign: 'center',
  },
  clipReason: {
    color: colors.textSecondary,
    fontSize: typography.micro,
    lineHeight: 18,
    textAlign: 'center',
    maxWidth: 260,
  },
  helpMenuOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  helpMenuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 6, 23, 0.42)',
  },
  helpMenuSheetWrap: {
    width: '100%',
  },
  helpMenuCard: {
    alignSelf: 'center',
    width: '100%',
    paddingVertical: 4,
    gap: 0,
  },
  helpMenuItem: {
    minHeight: 52,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  helpMenuItemPressed: {
    backgroundColor: colors.bgSurface2,
  },
  helpMenuItemDisabled: {
    opacity: 0.72,
  },
  helpMenuLabel: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '600',
  },
  helpMenuLabelDisabled: {
    color: colors.textSecondary,
  },
  helpMenuBadge: {
    color: colors.textSecondary,
    fontSize: typography.micro,
    fontWeight: '700',
  },
  controlsWrap: {
    gap: spacing.md,
  },
  navCoachWrap: {
    alignItems: 'center',
  },
  navCoachText: {
    color: colors.textTertiary,
    fontSize: typography.micro,
    lineHeight: 18,
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  contentStage: {
    minHeight: 260,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  primingPage: {
    flex: 1,
    width: '100%',
    maxWidth: '100%',
    alignSelf: 'center',
    paddingHorizontal: spacing.page,
    justifyContent: 'space-between',
  },
  primingPageHeader: {
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primingPageBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingBottom: spacing.xl,
  },
  primingTopInfo: {
    alignItems: 'center',
    gap: 6,
    maxWidth: 320,
  },
  primingMetaLine: {
    color: colors.textTertiary,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  primingSummary: {
    color: '#B8B5C0',
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.18)',
    borderRadius: radii.xl,
  },
  loadingOverlayCard: {
    minWidth: 168,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: radii.lg,
    backgroundColor: colors.bgSurface1,
    borderWidth: 1,
    borderColor: colors.strokeStrong,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  primingPreviewPageCard: {
    position: 'relative',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 0,
    borderColor: 'transparent',
    borderRadius: 10,
  },
  primingPauseBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(10, 12, 20, 0.66)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  primingPauseBadgeText: {
    color: colors.textPrimary,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  primingPreviewPauseWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(148, 163, 255, 0.08)',
  },
  primingPreviewLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 0.4,
  },
  primingSwipeHint: {
    color: '#4A4955',
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  primingCountdownWrap: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  primingCountdownRing: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 3,
    borderColor: '#9BA7E8',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  primingCountdownRingWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(155, 167, 232, 0.16)',
  },
  primingCountdownInner: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgApp,
    gap: 1,
  },
  primingCountdownText: {
    color: '#F0EEF2',
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '600',
    textAlign: 'center',
  },
  primingCountdownPauseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  primingCountdownPauseLabel: {
    color: colors.textSecondary,
    fontSize: 8,
    lineHeight: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  primingHoldHint: {
    color: '#6A6875',
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  primingHoldHintPaused: {
    color: colors.textPrimary,
  },
  loadingOverlayText: {
    color: colors.textPrimary,
    fontSize: typography.caption,
    fontWeight: '600',
    textAlign: 'center',
  },
  sideRail: {
    position: 'absolute',
    bottom: -18,
    gap: spacing.sm,
  },
  sideRailLeft: {
    left: 0,
  },
  sideRailRight: {
    right: -6,
  },
  sideButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineWrap: {
    alignItems: 'center',
    gap: 12,
  },
  translationBar: {
    width: 190,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.bgSurface2,
    marginTop: 6,
  },
  audioStateError: {
    color: '#FCA5A5',
    fontSize: typography.caption,
    textAlign: 'center',
  },
  transcriptSafeArea: {
    flex: 1,
    backgroundColor: colors.bgApp,
  },
  transcriptHeader: {
    paddingTop: 12,
    paddingBottom: 12,
    alignItems: 'center',
  },
  transcriptHeaderInner: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  transcriptHeaderCopy: {
    flex: 1,
    gap: 4,
  },
  transcriptTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
  },
  transcriptMeta: {
    color: colors.textSecondary,
    fontSize: typography.caption,
  },
  transcriptBody: {
    paddingBottom: 32,
    gap: spacing.sm,
  },
  transcriptLine: {
    gap: spacing.sm,
  },
  transcriptEn: {
    color: colors.textPrimary,
    fontSize: typography.bodyLg,
    lineHeight: 22,
  },
  transcriptEnSmall: {
    fontSize: 14,
    lineHeight: 20,
  },
  transcriptEnLarge: {
    fontSize: 17,
    lineHeight: 25,
  },
  transcriptZh: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  transcriptZhSmall: {
    fontSize: 11,
    lineHeight: 16,
  },
  transcriptZhLarge: {
    fontSize: 13,
    lineHeight: 20,
  },
});
}
