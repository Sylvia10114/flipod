import { Audio, type AVPlaybackStatus } from 'expo-av';
import { useCallback, useEffect, useRef, useState } from 'react';
import { findLineAtTime, resolveClipAudioUrl } from '../clip-utils';
import type { Clip } from '../types';

type PlayerState = {
  activeIndex: number;
  isPlaying: boolean;
  isLoading: boolean;
  positionMillis: number;
  durationMillis: number;
  activeLineIndex: number;
  playbackRate: number;
};

const initialState: PlayerState = {
  activeIndex: 0,
  isPlaying: false,
  isLoading: false,
  positionMillis: 0,
  durationMillis: 0,
  activeLineIndex: 0,
  playbackRate: 1,
};

export function useFeedPlayer(clips: Clip[]) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const clipsRef = useRef<Clip[]>(clips);
  const activeIndexRef = useRef(0);
  const [state, setState] = useState<PlayerState>(initialState);

  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);

  const unloadCurrent = useCallback(async () => {
    if (!soundRef.current) return;
    try {
      await soundRef.current.unloadAsync();
    } catch {
    }
    soundRef.current.setOnPlaybackStatusUpdate(null);
    soundRef.current = null;
  }, []);

  const handleStatus = useCallback((clipIndex: number, status: AVPlaybackStatus) => {
    if (!status.isLoaded) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        isPlaying: false,
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
    }));
  }, []);

  useEffect(() => {
    activeIndexRef.current = state.activeIndex;
  }, [state.activeIndex]);

  const loadClip = useCallback(async (clipIndex: number, shouldPlay: boolean) => {
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
    }));

    await unloadCurrent();

    const sound = new Audio.Sound();
    soundRef.current = sound;
    sound.setOnPlaybackStatusUpdate(status => handleStatus(clipIndex, status));

    await sound.loadAsync(
      { uri: audioUrl },
      {
        shouldPlay,
        progressUpdateIntervalMillis: 250,
        positionMillis: 0,
      }
    );
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

  useEffect(() => {
    if (!clips.length) return;
    void loadClip(0, false);
  }, [clips, loadClip]);

  useEffect(() => {
    return () => {
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
    setRate,
  };
}
