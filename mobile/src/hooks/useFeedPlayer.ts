import { Audio, type AVPlaybackStatus } from 'expo-av';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clipRelativeToSourceSeconds,
  findLineAtTime,
  findNextSentenceStart,
  findPrevSentenceStart,
  getClipAudioEndSeconds,
  getClipAudioStartSeconds,
  getClipDurationSeconds,
  resolveClipAudioSource,
  sourceToClipRelativeSeconds,
} from '../clip-utils';
import { useUiI18n } from '../i18n';
import type { Clip, PlaybackPhase } from '../types';

type PendingPlaybackStart = {
  transportRequestId: number;
  publicRequestId: number;
  clipIndex: number;
  sourcePositionMillis: number;
  requestedAtMs: number;
};

type PlayerState = {
  activeIndex: number;
  playbackPhase: PlaybackPhase;
  currentRequestId: number | null;
  pendingClipIndex: number | null;
  positionMillis: number;
  durationMillis: number;
  activeLineIndex: number;
  playbackRate: number;
  errorMessage: string | null;
};

const MIN_LOADING_FEEDBACK_MS = 240;
const PLAYBACK_STARTED_THRESHOLD_MS = 120;
const PLAYBACK_START_MAX_WAIT_MS = 1200;

const initialState: PlayerState = {
  activeIndex: 0,
  playbackPhase: 'idle',
  currentRequestId: null,
  pendingClipIndex: null,
  positionMillis: 0,
  durationMillis: 0,
  activeLineIndex: 0,
  playbackRate: 1,
  errorMessage: null,
};

export function useFeedPlayer(clips: Clip[], initialPlaybackRate = 1) {
  const { t } = useUiI18n();
  const soundRef = useRef<Audio.Sound | null>(null);
  const clipsRef = useRef<Clip[]>(clips);
  const activeIndexRef = useRef(0);
  const playbackRateRef = useRef(initialPlaybackRate);
  const transportRequestRef = useRef(0);
  const manualRequestRef = useRef(0);
  const pendingPlaybackStartRef = useRef<PendingPlaybackStart | null>(null);
  const [state, setState] = useState<PlayerState>({
    ...initialState,
    playbackRate: initialPlaybackRate,
  });

  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);

  useEffect(() => {
    playbackRateRef.current = initialPlaybackRate;
    setState(prev => {
      if (prev.playbackRate === initialPlaybackRate) return prev;
      return { ...prev, playbackRate: initialPlaybackRate };
    });
  }, [initialPlaybackRate]);

  useEffect(() => {
    playbackRateRef.current = state.playbackRate;
  }, [state.playbackRate]);

  useEffect(() => {
    activeIndexRef.current = state.activeIndex;
  }, [state.activeIndex]);

  const waitForMinimumLoadingFeedback = useCallback(async (startedAt: number) => {
    const elapsed = Date.now() - startedAt;
    const remaining = MIN_LOADING_FEEDBACK_MS - elapsed;
    if (remaining <= 0) return;
    await new Promise(resolve => setTimeout(resolve, remaining));
  }, []);

  const createManualRequestId = useCallback(() => {
    manualRequestRef.current += 1;
    return manualRequestRef.current;
  }, []);

  const clearPendingPlaybackStart = useCallback((transportRequestId?: number, clipIndex?: number) => {
    const pending = pendingPlaybackStartRef.current;
    if (!pending) return;
    if (
      typeof transportRequestId === 'number'
      && typeof clipIndex === 'number'
      && (pending.transportRequestId !== transportRequestId || pending.clipIndex !== clipIndex)
    ) {
      return;
    }
    pendingPlaybackStartRef.current = null;
  }, []);

  const unloadCurrent = useCallback(async () => {
    if (!soundRef.current) return;
    try {
      await soundRef.current.unloadAsync();
    } catch {
    }
    soundRef.current.setOnPlaybackStatusUpdate(null);
    soundRef.current = null;
  }, []);

  const handleStatus = useCallback((clipIndex: number, transportRequestId: number, status: AVPlaybackStatus) => {
    if (transportRequestId !== transportRequestRef.current) return;

    if (!status.isLoaded) {
      clearPendingPlaybackStart(transportRequestId, clipIndex);
      setState(prev => ({
        ...prev,
        playbackPhase: status.error ? 'error' : prev.playbackPhase,
        pendingClipIndex: null,
        errorMessage: status.error ? t('feed.audioUnavailable') : prev.errorMessage,
      }));
      return;
    }

    const clip = clipsRef.current[clipIndex];
    const windowStartSec = clip ? getClipAudioStartSeconds(clip) : 0;
    const windowEndSec = clip ? getClipAudioEndSeconds(clip) : 0;
    const clipDurationMillis = clip ? Math.max(0, Math.floor(getClipDurationSeconds(clip) * 1000)) : 0;
    const relativePositionMillis = clip
      ? Math.max(0, Math.floor(sourceToClipRelativeSeconds(clip, status.positionMillis / 1000) * 1000))
      : status.positionMillis;
    const activeLineIndex = clip ? Math.max(0, findLineAtTime(clip, relativePositionMillis / 1000)) : 0;

    const reachedClipEnd = clip
      && windowEndSec > windowStartSec
      && status.positionMillis >= Math.floor(windowEndSec * 1000) - 160;

    if (reachedClipEnd && soundRef.current) {
      clearPendingPlaybackStart(transportRequestId, clipIndex);
      void soundRef.current.pauseAsync().catch(() => {});
      if (clipDurationMillis > 0) {
        void soundRef.current.setPositionAsync(Math.floor(windowEndSec * 1000)).catch(() => {});
      }
    }

    const pending = pendingPlaybackStartRef.current;
    const awaitingPlaybackStart = pending?.transportRequestId === transportRequestId
      && pending.clipIndex === clipIndex;
    const playbackProgressSinceRequest = awaitingPlaybackStart
      ? Math.max(0, status.positionMillis - pending.sourcePositionMillis)
      : 0;
    const elapsedSincePlaybackRequest = awaitingPlaybackStart
      ? Date.now() - pending.requestedAtMs
      : 0;
    const playbackConfirmed = awaitingPlaybackStart
      && status.isPlaying
      && !status.isBuffering
      && (
        playbackProgressSinceRequest >= PLAYBACK_STARTED_THRESHOLD_MS
        || elapsedSincePlaybackRequest >= PLAYBACK_START_MAX_WAIT_MS
      );

    if (playbackConfirmed) {
      clearPendingPlaybackStart(transportRequestId, clipIndex);
    }

    setState(prev => {
      let playbackPhase: PlaybackPhase = prev.playbackPhase;

      if (reachedClipEnd) {
        playbackPhase = 'paused';
      } else if (awaitingPlaybackStart) {
        playbackPhase = playbackConfirmed ? 'playing' : 'loading';
      } else if (status.isPlaying) {
        playbackPhase = 'playing';
      } else if (prev.playbackPhase === 'idle' && !status.shouldPlay) {
        playbackPhase = 'idle';
      } else if (prev.playbackPhase === 'error') {
        playbackPhase = 'error';
      } else {
        playbackPhase = 'paused';
      }

      return {
        ...prev,
        activeIndex: clipIndex,
        playbackPhase,
        currentRequestId: pending?.publicRequestId ?? prev.currentRequestId,
        pendingClipIndex: playbackPhase === 'loading' ? clipIndex : null,
        positionMillis: clipDurationMillis > 0
          ? Math.min(relativePositionMillis, clipDurationMillis)
          : relativePositionMillis,
        durationMillis: clipDurationMillis || prev.durationMillis,
        activeLineIndex,
        errorMessage: playbackPhase === 'error' ? prev.errorMessage : null,
      };
    });
  }, [clearPendingPlaybackStart, t]);

  const startPlayback = useCallback(async (clipIndex: number, publicRequestId?: number) => {
    const clip = clipsRef.current[clipIndex];
    if (!clip) return;

    const requestId = publicRequestId ?? createManualRequestId();
    const transportRequestId = ++transportRequestRef.current;
    const loadingStartedAt = Date.now();
    const clipDurationMillis = Math.max(0, Math.floor(getClipDurationSeconds(clip) * 1000));
    const clipStartPositionMillis = Math.floor(getClipAudioStartSeconds(clip) * 1000);
    const clipEndPositionMillis = Math.floor(getClipAudioEndSeconds(clip) * 1000);
    let targetSourcePositionMillis = clipStartPositionMillis;

    if (soundRef.current && activeIndexRef.current === clipIndex) {
      try {
        const currentStatus = await soundRef.current.getStatusAsync();
        if (currentStatus.isLoaded) {
          if (currentStatus.positionMillis >= clipEndPositionMillis - 300) {
            targetSourcePositionMillis = clipStartPositionMillis;
            await soundRef.current.setPositionAsync(targetSourcePositionMillis);
          } else {
            targetSourcePositionMillis = currentStatus.positionMillis;
          }
        }

        pendingPlaybackStartRef.current = {
          transportRequestId,
          publicRequestId: requestId,
          clipIndex,
          sourcePositionMillis: targetSourcePositionMillis,
          requestedAtMs: Date.now(),
        };
        soundRef.current.setOnPlaybackStatusUpdate(status => handleStatus(clipIndex, transportRequestId, status));

        setState(prev => ({
          ...prev,
          activeIndex: clipIndex,
          playbackPhase: 'loading',
          currentRequestId: requestId,
          pendingClipIndex: clipIndex,
          positionMillis: Math.max(0, Math.floor(sourceToClipRelativeSeconds(clip, targetSourcePositionMillis / 1000) * 1000)),
          durationMillis: clipDurationMillis || prev.durationMillis,
          activeLineIndex: Math.max(0, findLineAtTime(clip, Math.max(0, sourceToClipRelativeSeconds(clip, targetSourcePositionMillis / 1000)))),
          errorMessage: null,
        }));

        await waitForMinimumLoadingFeedback(loadingStartedAt);
        if (transportRequestId !== transportRequestRef.current) return;
        await soundRef.current.playAsync();
        return;
      } catch {
        clearPendingPlaybackStart(transportRequestId, clipIndex);
        setState(prev => ({
          ...prev,
          activeIndex: clipIndex,
          playbackPhase: 'error',
          currentRequestId: requestId,
          pendingClipIndex: null,
          errorMessage: t('practiceSession.loadError'),
        }));
        return;
      }
    }

    const audioSource = resolveClipAudioSource(clip);
    if (!audioSource) {
      clearPendingPlaybackStart(transportRequestId, clipIndex);
      setState(prev => ({
        ...prev,
        activeIndex: clipIndex,
        playbackPhase: 'error',
        currentRequestId: requestId,
        pendingClipIndex: null,
        positionMillis: 0,
        durationMillis: 0,
        activeLineIndex: 0,
        errorMessage: t('practiceSession.noAudio'),
      }));
      return;
    }

    pendingPlaybackStartRef.current = {
      transportRequestId,
      publicRequestId: requestId,
      clipIndex,
      sourcePositionMillis: clipStartPositionMillis,
      requestedAtMs: Date.now(),
    };

    setState(prev => ({
      ...prev,
      activeIndex: clipIndex,
      playbackPhase: 'loading',
      currentRequestId: requestId,
      pendingClipIndex: clipIndex,
      positionMillis: 0,
      durationMillis: 0,
      activeLineIndex: 0,
      errorMessage: null,
    }));

    await unloadCurrent();
    if (transportRequestId !== transportRequestRef.current) return;

    const sound = new Audio.Sound();
    soundRef.current = sound;
    activeIndexRef.current = clipIndex;
    sound.setOnPlaybackStatusUpdate(status => handleStatus(clipIndex, transportRequestId, status));

    try {
      await sound.loadAsync(
        audioSource,
        {
          shouldPlay: false,
          rate: playbackRateRef.current,
          shouldCorrectPitch: true,
          progressUpdateIntervalMillis: 250,
          positionMillis: clipStartPositionMillis,
        }
      );

      if (transportRequestId !== transportRequestRef.current) {
        sound.setOnPlaybackStatusUpdate(null);
        if (soundRef.current === sound) {
          soundRef.current = null;
        }
        try {
          await sound.unloadAsync();
        } catch {
        }
        return;
      }

      await waitForMinimumLoadingFeedback(loadingStartedAt);
      if (transportRequestId !== transportRequestRef.current) {
        sound.setOnPlaybackStatusUpdate(null);
        if (soundRef.current === sound) {
          soundRef.current = null;
        }
        clearPendingPlaybackStart(transportRequestId, clipIndex);
        try {
          await sound.unloadAsync();
        } catch {
        }
        return;
      }

      await sound.playAsync();
    } catch {
      if (soundRef.current === sound) {
        sound.setOnPlaybackStatusUpdate(null);
        soundRef.current = null;
      }
      clearPendingPlaybackStart(transportRequestId, clipIndex);
      try {
        await sound.unloadAsync();
      } catch {
      }
      setState(prev => ({
        ...prev,
        activeIndex: clipIndex,
        playbackPhase: 'error',
        currentRequestId: requestId,
        pendingClipIndex: null,
        positionMillis: 0,
        durationMillis: 0,
        activeLineIndex: 0,
        errorMessage: t('practiceSession.loadError'),
      }));
    }
  }, [
    clearPendingPlaybackStart,
    createManualRequestId,
    handleStatus,
    t,
    unloadCurrent,
    waitForMinimumLoadingFeedback,
  ]);

  const requestAutoplay = useCallback(async (clipIndex: number, requestId: number) => {
    await startPlayback(clipIndex, requestId);
  }, [startPlayback]);

  const playIndex = useCallback(async (clipIndex: number, requestId?: number) => {
    await startPlayback(clipIndex, requestId);
  }, [startPlayback]);

  const pause = useCallback(async () => {
    clearPendingPlaybackStart();
    if (!soundRef.current) {
      setState(prev => ({ ...prev, playbackPhase: 'paused', pendingClipIndex: null }));
      return;
    }
    try {
      await soundRef.current.pauseAsync();
    } catch {
    }
    setState(prev => ({
      ...prev,
      playbackPhase: 'paused',
      pendingClipIndex: null,
    }));
  }, [clearPendingPlaybackStart]);

  const stop = useCallback(async () => {
    transportRequestRef.current += 1;
    clearPendingPlaybackStart();
    setState(prev => ({
      ...prev,
      playbackPhase: 'idle',
      currentRequestId: null,
      pendingClipIndex: null,
      errorMessage: null,
    }));
    await unloadCurrent();
  }, [clearPendingPlaybackStart, unloadCurrent]);

  const togglePlay = useCallback(async (clipIndex: number, requestId?: number) => {
    if (state.activeIndex === clipIndex && state.playbackPhase === 'playing') {
      await pause();
      return;
    }
    await playIndex(clipIndex, requestId);
  }, [pause, playIndex, state.activeIndex, state.playbackPhase]);

  const seekToRatio = useCallback(async (ratio: number) => {
    if (!soundRef.current || !state.durationMillis) return;
    const clip = clipsRef.current[state.activeIndex];
    if (!clip) return;
    const bounded = Math.max(0, Math.min(1, ratio));
    try {
      const nextRelativeMillis = Math.floor(state.durationMillis * bounded);
      const nextSourceMillis = Math.floor(
        clipRelativeToSourceSeconds(clip, nextRelativeMillis / 1000) * 1000
      );
      await soundRef.current.setPositionAsync(nextSourceMillis);
    } catch {
    }
  }, [state.activeIndex, state.durationMillis]);

  const seekBy = useCallback(async (deltaMillis: number) => {
    if (!soundRef.current) return;
    const clip = clipsRef.current[state.activeIndex];
    if (!clip) return;
    const clipDurationMillis = Math.floor(getClipDurationSeconds(clip) * 1000);
    const nextRelativeMillis = Math.max(0, Math.min(clipDurationMillis, state.positionMillis + deltaMillis));
    try {
      await soundRef.current.setPositionAsync(
        Math.floor(clipRelativeToSourceSeconds(clip, nextRelativeMillis / 1000) * 1000)
      );
    } catch {
    }
  }, [state.activeIndex, state.positionMillis]);

  const setRate = useCallback(async (rate: number) => {
    setState(prev => ({ ...prev, playbackRate: rate }));
    if (!soundRef.current) return;
    try {
      await soundRef.current.setRateAsync(rate, true);
    } catch {
    }
  }, []);

  const seekToSentence = useCallback(async (lineIndex: number) => {
    const clip = clipsRef.current[state.activeIndex];
    const line = clip?.lines?.[lineIndex];
    if (!clip || !line || !soundRef.current) return;

    try {
      await soundRef.current.setPositionAsync(
        Math.max(0, Math.floor(clipRelativeToSourceSeconds(clip, line.start) * 1000))
      );
    } catch {
    }
  }, [state.activeIndex]);

  const seekPrevSentence = useCallback(async () => {
    const clip = clipsRef.current[state.activeIndex];
    if (!clip || !soundRef.current) return;

    const target = findPrevSentenceStart(clip, state.positionMillis / 1000);
    try {
      await soundRef.current.setPositionAsync(
        Math.max(0, Math.floor(clipRelativeToSourceSeconds(clip, target) * 1000))
      );
    } catch {
    }
  }, [state.activeIndex, state.positionMillis]);

  const seekNextSentence = useCallback(async () => {
    const clip = clipsRef.current[state.activeIndex];
    if (!clip || !soundRef.current) return;

    const target = findNextSentenceStart(clip, state.positionMillis / 1000);
    try {
      await soundRef.current.setPositionAsync(
        Math.max(0, Math.floor(clipRelativeToSourceSeconds(clip, target) * 1000))
      );
    } catch {
    }
  }, [state.activeIndex, state.positionMillis]);

  useEffect(() => {
    return () => {
      transportRequestRef.current += 1;
      clearPendingPlaybackStart();
      void unloadCurrent();
    };
  }, [clearPendingPlaybackStart, unloadCurrent]);

  return {
    ...state,
    isLoading: state.playbackPhase === 'loading',
    isPlaying: state.playbackPhase === 'playing',
    requestAutoplay,
    playIndex,
    pause,
    stop,
    togglePlay,
    seekToRatio,
    seekBy,
    seekToSentence,
    seekPrevSentence,
    seekNextSentence,
    setRate,
  };
}
