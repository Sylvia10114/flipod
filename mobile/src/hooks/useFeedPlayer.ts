import { Audio, type AVPlaybackStatus } from 'expo-av';
import { useCallback, useEffect, useRef, useState } from 'react';
import { findLineAtTime, findNextSentenceStart, findPrevSentenceStart, resolveClipAudioUrl } from '../clip-utils';
import type { Clip } from '../types';

type PlayerState = {
  activeIndex: number;
  isPlaying: boolean;
  isLoading: boolean;
  positionMillis: number;
  durationMillis: number;
  activeLineIndex: number;
  playbackRate: number;
  errorMessage: string | null;
};

const initialState: PlayerState = {
  activeIndex: 0,
  isPlaying: false,
  isLoading: false,
  positionMillis: 0,
  durationMillis: 0,
  activeLineIndex: 0,
  playbackRate: 1,
  errorMessage: null,
};

export function useFeedPlayer(clips: Clip[], initialPlaybackRate = 1) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const clipsRef = useRef<Clip[]>(clips);
  const activeIndexRef = useRef(0);
  const playbackRateRef = useRef(initialPlaybackRate);
  const loadRequestRef = useRef(0);
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

  const unloadCurrent = useCallback(async () => {
    if (!soundRef.current) return;
    try {
      await soundRef.current.unloadAsync();
    } catch {
    }
    soundRef.current.setOnPlaybackStatusUpdate(null);
    soundRef.current = null;
  }, []);

  const handleStatus = useCallback((clipIndex: number, requestId: number, status: AVPlaybackStatus) => {
    if (requestId !== loadRequestRef.current) return;

    if (!status.isLoaded) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        isPlaying: false,
        errorMessage: status.error ? '音频暂时不可用' : prev.errorMessage,
      }));
      return;
    }

    const clip = clipsRef.current[clipIndex];
    const activeLineIndex = clip ? Math.max(0, findLineAtTime(clip, status.positionMillis / 1000)) : 0;

    setState(prev => ({
      ...prev,
      activeIndex: clipIndex,
      isLoading: false,
      isPlaying: status.isPlaying,
      positionMillis: status.positionMillis,
      durationMillis: status.durationMillis || prev.durationMillis,
      activeLineIndex,
      errorMessage: null,
    }));
  }, []);

  useEffect(() => {
    activeIndexRef.current = state.activeIndex;
  }, [state.activeIndex]);

  const loadClip = useCallback(async (clipIndex: number, shouldPlay: boolean) => {
    const requestId = ++loadRequestRef.current;
    const clip = clipsRef.current[clipIndex];
    if (!clip) return;

    if (soundRef.current && activeIndexRef.current === clipIndex) {
      if (shouldPlay) {
        try {
          await soundRef.current.playAsync();
        } catch {
        }
      }
      return;
    }

    const audioUrl = resolveClipAudioUrl(clip);
    if (!audioUrl) {
      setState(prev => ({
        ...prev,
        activeIndex: clipIndex,
        isPlaying: false,
        isLoading: false,
        positionMillis: 0,
        durationMillis: 0,
        activeLineIndex: 0,
        errorMessage: '当前片段没有可播放音频',
      }));
      return;
    }

    setState(prev => ({
      ...prev,
      activeIndex: clipIndex,
      isLoading: true,
      positionMillis: 0,
      durationMillis: 0,
      activeLineIndex: 0,
      errorMessage: null,
    }));

    await unloadCurrent();
    if (requestId !== loadRequestRef.current) return;

    const sound = new Audio.Sound();
    soundRef.current = sound;
    activeIndexRef.current = clipIndex;
    sound.setOnPlaybackStatusUpdate(status => handleStatus(clipIndex, requestId, status));

    try {
      await sound.loadAsync(
        { uri: audioUrl },
        {
          shouldPlay,
          rate: playbackRateRef.current,
          shouldCorrectPitch: true,
          progressUpdateIntervalMillis: 250,
          positionMillis: 0,
        }
      );

      if (requestId !== loadRequestRef.current) {
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
    } catch {
      if (soundRef.current === sound) {
        sound.setOnPlaybackStatusUpdate(null);
        soundRef.current = null;
      }
      try {
        await sound.unloadAsync();
      } catch {
      }
      setState(prev => ({
        ...prev,
        activeIndex: clipIndex,
        isPlaying: false,
        isLoading: false,
        positionMillis: 0,
        durationMillis: 0,
        activeLineIndex: 0,
        errorMessage: '音频加载失败，请稍后重试',
      }));
    }
  }, [handleStatus, unloadCurrent]);

  const playIndex = useCallback(async (clipIndex: number) => {
    await loadClip(clipIndex, true);
  }, [loadClip]);

  const pause = useCallback(async () => {
    if (!soundRef.current) return;
    try {
      await soundRef.current.pauseAsync();
    } catch {
    }
  }, []);

  const togglePlay = useCallback(async (clipIndex: number) => {
    if (!soundRef.current || state.activeIndex !== clipIndex) {
      await playIndex(clipIndex);
      return;
    }

    if (state.isPlaying) {
      await pause();
      return;
    }

    try {
      await soundRef.current.playAsync();
    } catch {
      await playIndex(clipIndex);
    }
  }, [pause, playIndex, state.activeIndex, state.isPlaying]);

  const seekToRatio = useCallback(async (ratio: number) => {
    if (!soundRef.current || !state.durationMillis) return;
    const bounded = Math.max(0, Math.min(1, ratio));
    try {
      await soundRef.current.setPositionAsync(Math.floor(state.durationMillis * bounded));
    } catch {
    }
  }, [state.durationMillis]);

  const seekBy = useCallback(async (deltaMillis: number) => {
    if (!soundRef.current) return;
    const next = Math.max(0, state.positionMillis + deltaMillis);
    try {
      await soundRef.current.setPositionAsync(next);
    } catch {
    }
  }, [state.positionMillis]);

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
      await soundRef.current.setPositionAsync(Math.max(0, Math.floor(line.start * 1000)));
    } catch {
    }
  }, [state.activeIndex]);

  const seekPrevSentence = useCallback(async () => {
    const clip = clipsRef.current[state.activeIndex];
    if (!clip || !soundRef.current) return;

    const target = findPrevSentenceStart(clip, state.positionMillis / 1000);
    try {
      await soundRef.current.setPositionAsync(Math.max(0, Math.floor(target * 1000)));
    } catch {
    }
  }, [state.activeIndex, state.positionMillis]);

  const seekNextSentence = useCallback(async () => {
    const clip = clipsRef.current[state.activeIndex];
    if (!clip || !soundRef.current) return;

    const target = findNextSentenceStart(clip, state.positionMillis / 1000);
    try {
      await soundRef.current.setPositionAsync(Math.max(0, Math.floor(target * 1000)));
    } catch {
    }
  }, [state.activeIndex, state.positionMillis]);

  useEffect(() => {
    if (!clips.length) return;
    void loadClip(0, false);
  }, [clips, loadClip]);

  useEffect(() => {
    return () => {
      loadRequestRef.current += 1;
      void unloadCurrent();
    };
  }, [unloadCurrent]);

  return {
    ...state,
    playIndex,
    pause,
    togglePlay,
    seekToRatio,
    seekBy,
    seekToSentence,
    seekPrevSentence,
    seekNextSentence,
    setRate,
  };
}
