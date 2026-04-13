import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';

type FeedbackSound =
  | 'clickGo'
  | 'clickFlow'
  | 'onboardNext'
  | 'collection'
  | 'follow'
  | 'card'
  | 'correct'
  | 'wrong'
  | 'practiceWin'
  | 'signFinish';

export type UiFeedbackKind =
  | 'primary'
  | 'menu'
  | 'onboarding'
  | 'bookmark'
  | 'like'
  | 'card'
  | 'success'
  | 'correct'
  | 'error'
  | 'practiceComplete';

const SOUND_ASSETS: Record<FeedbackSound, number> = {
  clickGo: require('../assets/sfx/click_go.mp3'),
  clickFlow: require('../assets/sfx/click_flow.mp3'),
  onboardNext: require('../assets/sfx/onboard_next.mp3'),
  collection: require('../assets/sfx/contacts_click_collection.mp3'),
  follow: require('../assets/sfx/click_follow.mp3'),
  card: require('../assets/sfx/click_on_card.mp3'),
  correct: require('../assets/sfx/correct.mp3'),
  wrong: require('../assets/sfx/wrong.mp3'),
  practiceWin: require('../assets/sfx/practice_win.mp3'),
  signFinish: require('../assets/sfx/sign_finish.mp3'),
};

const SOUND_FOR_KIND: Record<UiFeedbackKind, FeedbackSound> = {
  primary: 'clickGo',
  menu: 'clickFlow',
  onboarding: 'onboardNext',
  bookmark: 'collection',
  like: 'follow',
  card: 'card',
  success: 'signFinish',
  correct: 'correct',
  error: 'wrong',
  practiceComplete: 'practiceWin',
};

const soundCache = new Map<FeedbackSound, Audio.Sound>();
let primePromise: Promise<void> | null = null;

async function getLoadedSound(soundKey: FeedbackSound) {
  const existing = soundCache.get(soundKey);
  if (existing) return existing;

  const sound = new Audio.Sound();
  await sound.loadAsync(SOUND_ASSETS[soundKey], {
    shouldPlay: false,
    isLooping: false,
    volume: 0.42,
  });
  soundCache.set(soundKey, sound);
  return sound;
}

async function playSound(soundKey: FeedbackSound) {
  const sound = await getLoadedSound(soundKey);
  try {
    await sound.replayAsync();
  } catch {
    try {
      await sound.setPositionAsync(0);
      await sound.playAsync();
    } catch {
    }
  }
}

export function triggerMediumHaptic() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export function triggerUiFeedback(
  kind: UiFeedbackKind,
  options: { sound?: boolean; haptic?: boolean } = {}
) {
  if (options.haptic !== false) {
    triggerMediumHaptic();
  }

  if (options.sound === false) return;
  void playSound(SOUND_FOR_KIND[kind]).catch(() => {});
}

export function primeUiFeedback() {
  if (primePromise) return primePromise;
  primePromise = Promise.all(
    Object.keys(SOUND_ASSETS).map(soundKey => getLoadedSound(soundKey as FeedbackSound).catch(() => null))
  ).then(() => undefined);
  return primePromise;
}

export async function disposeUiFeedback() {
  const sounds = Array.from(soundCache.values());
  soundCache.clear();
  primePromise = null;
  await Promise.all(sounds.map(sound => sound.unloadAsync().catch(() => undefined)));
}
