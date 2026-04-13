import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type ViewToken,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  buildClipKey,
  getSentenceRange,
  getSourceLabel,
  getWordTimestamp,
} from '../clip-utils';
import { triggerUiFeedback } from '../feedback';
import { RecoCard, ReviewCard } from '../components/FeedCards';
import { PlayerControls } from '../components/PlayerControls';
import { ProgressBar } from '../components/ProgressBar';
import { WordLine } from '../components/WordLine';
import { WordPopup } from '../components/WordPopup';
import { useFeedPlayer } from '../hooks/useFeedPlayer';
import type {
  Clip,
  ClipLine,
  ClipLineWord,
  DominantHand,
  Profile,
  ReviewState,
  VocabEntry,
} from '../types';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const ONE_DAY = 24 * 60 * 60 * 1000;

type Props = {
  clips: Clip[];
  profile: Profile;
  dominantHand: DominantHand;
  playbackRate: number;
  feedState: 'loading' | 'normal' | 'rerank' | 'fallback';
  bookmarkedKeys: string[];
  likedKeys: string[];
  recoTag: string | null;
  reviewState: ReviewState;
  vocabEntries: VocabEntry[];
  vocabWords: string[];
  knownWords: string[];
  clipsPlayed: number;
  onToggleLike: (clip: Clip, index: number) => void;
  onToggleBookmark: (clip: Clip, index: number) => void;
  onSaveVocab: (entry: VocabEntry) => void;
  onMarkKnown: (word: string) => void;
  onRecordWordLookup: (cefr?: string) => void;
  onReviewAction: (word: string, action: 'remember' | 'forgot') => void;
  onOpenMenu: () => void;
  onPromoteInterest: (tag: string) => void;
  onPlaybackRateChange: (rate: number) => void;
  onClipPlayed: (clipKey: string) => void;
};

type PopupState = {
  word: ClipLineWord;
  contextEn: string;
  contextZh: string;
  clipKey: string;
  clipTitle: string;
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

type FeedRecoPage = {
  type: 'reco';
  key: string;
};

type FeedPage = FeedClipPage | FeedReviewPage | FeedRecoPage;

export function FeedScreen({
  clips,
  profile,
  dominantHand,
  playbackRate,
  feedState,
  bookmarkedKeys,
  likedKeys,
  recoTag,
  reviewState,
  vocabEntries,
  vocabWords,
  knownWords,
  clipsPlayed,
  onToggleLike,
  onToggleBookmark,
  onSaveVocab,
  onMarkKnown,
  onRecordWordLookup,
  onReviewAction,
  onOpenMenu,
  onPromoteInterest,
  onPlaybackRateChange,
  onClipPlayed,
}: Props) {
  const insets = useSafeAreaInsets();
  const data = useMemo(() => clips.slice(0, 20), [clips]);
  const pageHeight = Math.max(480, SCREEN_HEIGHT - insets.top - insets.bottom);
  const [showZh, setShowZh] = useState(false);
  const [masked, setMasked] = useState(false);
  const [popup, setPopup] = useState<PopupState>(null);
  const [dismissedCards, setDismissedCards] = useState<Set<string>>(new Set());
  const [transcriptIndex, setTranscriptIndex] = useState<number | null>(null);
  const playedRef = useRef<Set<string>>(new Set());

  const {
    activeIndex,
    activeLineIndex,
    durationMillis,
    errorMessage,
    isLoading,
    isPlaying,
    pause,
    playbackRate: currentPlaybackRate,
    positionMillis,
    playIndex,
    seekNextSentence,
    seekPrevSentence,
    seekToRatio,
    setRate,
    togglePlay,
  } = useFeedPlayer(data, playbackRate);

  const dismissCard = useCallback((key: string) => {
    setDismissedCards(prev => new Set(prev).add(key));
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
      .slice(0, 3);
  }, [dismissedCards, reviewState, vocabEntries]);

  const shouldShowReco = clipsPlayed >= 3 && Boolean(recoTag) && !dismissedCards.has('reco');
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

      if (clipIndex === 2 && shouldShowReco) {
        pages.push({
          type: 'reco',
          key: 'reco',
        });
      }

      const clipCounter = clipIndex + 1;
      if (
        clipCounter > 0 &&
        clipCounter % 4 === 0 &&
        reviewIndex < reviewEntries.length
      ) {
        const entry = reviewEntries[reviewIndex++];
        pages.push({
          type: 'review',
          key: `review:${entry.word.toLowerCase()}`,
          entry,
        });
      }
    });

    return pages;
  }, [data, reviewEntries, shouldShowReco]);

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 75 });
  const transcriptClip = typeof transcriptIndex === 'number' ? data[transcriptIndex] : null;
  const currentClip = data[activeIndex];
  const currentTime = positionMillis / 1000;
  const progress = durationMillis > 0 ? positionMillis / durationMillis : 0;
  const currentSentenceRange = currentClip ? getSentenceRange(currentClip, activeLineIndex) : null;
  const feedHint = useMemo(() => {
    if (feedState === 'loading') return 'AI 正在为你排列内容...';
    if (feedState === 'rerank') return '刚刚根据你的表现重新调整了顺序';
    if (feedState === 'fallback') return '这几条已经替你排好了';
    return '已根据你的偏好排列';
  }, [feedState]);

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const firstVisible = viewableItems.find(viewable => viewable.isViewable && typeof viewable.index === 'number');
    if (!firstVisible || typeof firstVisible.index !== 'number') return;

    const page = feedPages[firstVisible.index];
    if (!page) return;

    if (page.type === 'clip') {
      void playIndex(page.clipIndex);
      return;
    }

    void pause();
  }, [feedPages, pause, playIndex]);

  React.useEffect(() => {
    if (!isPlaying) return;
    const clip = data[activeIndex];
    if (!clip) return;
    const key = buildClipKey(clip, activeIndex);
    if (playedRef.current.has(key)) return;
    playedRef.current.add(key);
    onClipPlayed(key);
  }, [activeIndex, data, isPlaying, onClipPlayed]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlatList
        data={feedPages}
        keyExtractor={item => item.key}
        pagingEnabled
        snapToInterval={pageHeight}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig.current}
        renderItem={({ item }: ListRenderItemInfo<FeedPage>) => {
          if (item.type === 'review') {
            return (
              <View style={[styles.feedCardPage, { minHeight: pageHeight, paddingBottom: 18 + insets.bottom }]}>
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

          if (item.type === 'reco') {
            return (
              <View style={[styles.feedCardPage, { minHeight: pageHeight, paddingBottom: 18 + insets.bottom }]}>
                <RecoCard
                  interests={profile.interests}
                  recoTag={recoTag}
                  onAccept={tag => {
                    void onPromoteInterest(tag);
                    dismissCard('reco');
                  }}
                  onDismiss={() => dismissCard('reco')}
                />
              </View>
            );
          }

          const clip = item.clip;
          const index = item.clipIndex;
          const isActive = index === activeIndex;
          const line = isActive ? clip.lines?.[activeLineIndex] : clip.lines?.[0];
          const clipKey = item.key;
          const bookmarkLabel = bookmarkedKeys.includes(clipKey) ? '已收' : '收藏';
          const liked = likedKeys.includes(clipKey);

          return (
            <View style={[styles.card, { minHeight: pageHeight, paddingBottom: 18 + insets.bottom }]}>
              <View style={styles.topArea}>
                <View style={styles.topRow}>
                  <Text
                    style={[
                      styles.topHint,
                      feedState === 'loading' ? styles.topHintLoading : null,
                      feedState === 'rerank' ? styles.topHintRerank : null,
                      feedState === 'fallback' ? styles.topHintFallback : null,
                    ]}
                  >
                    {feedHint}
                  </Text>
                  <Pressable onPress={() => {
                    triggerUiFeedback('menu');
                    setTranscriptIndex(index);
                  }} style={styles.smallChip}>
                    <Text style={styles.smallChipText}>Transcript</Text>
                  </Pressable>
                </View>

                <View style={styles.topInfo}>
                  <Text style={styles.title}>{clip.title}</Text>
                  <Text style={styles.source}>
                    {getSourceLabel(clip.source)}
                    {clip.tag ? ` · ${clip.tag}` : ''}
                  </Text>
                </View>
              </View>

              <View style={styles.subtitleWrap}>
                <View style={[styles.sideRail, dominantHand === 'left' ? styles.sideRailLeft : styles.sideRailRight]}>
                  <Pressable onPress={() => onToggleLike(clip, index)} style={[styles.sideRailButton, liked && styles.sideRailButtonActive]}>
                    <Text style={[styles.sideRailButtonIcon, liked && styles.sideRailButtonIconActive]}>♥</Text>
                  </Pressable>
                  <Pressable onPress={() => onToggleBookmark(clip, index)} style={styles.sideRailButton}>
                    <Text style={styles.sideRailButtonText}>{bookmarkLabel}</Text>
                  </Pressable>
                </View>

                {line ? (
                  <WordLine
                    line={line}
                    currentTime={isActive ? currentTime : 0}
                    isActive={isActive}
                    showZh={showZh}
                    masked={masked}
                    onWordTap={(word: ClipLineWord, lineData: ClipLine) => {
                      onRecordWordLookup(word.cefr);
                      triggerUiFeedback('card');
                      setPopup({ word, contextEn: lineData.en, contextZh: lineData.zh || '', clipKey, clipTitle: clip.title });
                    }}
                  />
                ) : null}

                {isActive && errorMessage ? <Text style={styles.audioError}>{errorMessage}</Text> : null}
                {isActive && !errorMessage && isLoading ? <Text style={styles.loadingText}>音频加载中…</Text> : null}
              </View>

              <View style={styles.bottomControls}>
                <ProgressBar
                  progress={isActive ? progress : 0}
                  markers={[]}
                  currentSentenceRange={isActive ? currentSentenceRange : null}
                  onSeek={ratio => {
                    if (!isActive) return;
                    void seekToRatio(ratio);
                  }}
                />
                <PlayerControls
                  isPlaying={isActive && isPlaying}
                  isLoading={isActive && isLoading}
                  positionMillis={isActive ? positionMillis : 0}
                  durationMillis={isActive ? durationMillis : 0}
                  playbackRate={currentPlaybackRate}
                  dominantHand={dominantHand}
                  showZh={showZh}
                  masked={masked}
                  onTogglePlay={() => void togglePlay(index)}
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
                  onToggleZh={() => setShowZh(prev => !prev)}
                  onToggleMask={() => setMasked(prev => !prev)}
                  onOpenMenu={onOpenMenu}
                />
              </View>
            </View>
          );
        }}
      />

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
              clipKey: popup.clipKey,
              clipTitle: popup.clipTitle,
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
          <View style={styles.transcriptHeader}>
            <View style={styles.transcriptHeaderText}>
              <Text style={styles.transcriptTitle}>{transcriptClip?.title}</Text>
              <Text style={styles.transcriptMeta}>
                {transcriptClip ? getSourceLabel(transcriptClip.source) : ''}
              </Text>
            </View>
            <Pressable onPress={() => {
              triggerUiFeedback('menu');
              setTranscriptIndex(null);
            }} style={styles.smallChip}>
              <Text style={styles.smallChipText}>关闭</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.transcriptBody}>
            {(transcriptClip?.lines || []).map((entry, idx) => (
              <View key={`${idx}-${entry.start}`} style={styles.transcriptLine}>
                <Text style={styles.transcriptEn}>{entry.en}</Text>
                <Text style={styles.transcriptZh}>{entry.zh}</Text>
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#09090B',
  },
  card: {
    paddingHorizontal: 22,
    paddingTop: 8,
    paddingBottom: 36,
    justifyContent: 'space-between',
  },
  topArea: {
    gap: 18,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  topHint: {
    flex: 1,
    color: 'rgba(255,255,255,0.52)',
    fontSize: 12,
  },
  topHintLoading: {
    color: 'rgba(255,255,255,0.30)',
  },
  topHintRerank: {
    color: 'rgba(255,255,255,0.40)',
  },
  topHintFallback: {
    color: 'rgba(255,255,255,0.15)',
  },
  smallChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  smallChipText: {
    color: 'rgba(255,255,255,0.84)',
    fontSize: 12,
    fontWeight: '600',
  },
  topInfo: {
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 25,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 34,
  },
  source: {
    color: 'rgba(255,255,255,0.46)',
    fontSize: 13,
    textAlign: 'center',
  },
  subtitleWrap: {
    flex: 1,
    minHeight: 220,
    justifyContent: 'center',
    position: 'relative',
    paddingTop: 16,
    paddingBottom: 20,
  },
  sideRail: {
    position: 'absolute',
    top: 0,
    zIndex: 10,
    gap: 10,
  },
  sideRailLeft: {
    left: 0,
  },
  sideRailRight: {
    right: 0,
  },
  sideRailButton: {
    minWidth: 52,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  sideRailButtonActive: {
    backgroundColor: 'rgba(255,82,118,0.16)',
    borderColor: 'rgba(255,82,118,0.22)',
  },
  sideRailButtonIcon: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 14,
    fontWeight: '700',
  },
  sideRailButtonIconActive: {
    color: '#FF5A76',
  },
  sideRailButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  audioError: {
    marginTop: 16,
    color: '#FCA5A5',
    fontSize: 13,
    textAlign: 'center',
  },
  loadingText: {
    marginTop: 16,
    color: 'rgba(255,255,255,0.34)',
    fontSize: 13,
    textAlign: 'center',
  },
  bottomControls: {
    gap: 10,
    marginTop: 8,
  },
  feedCardPage: {
    paddingHorizontal: 22,
    justifyContent: 'center',
    paddingBottom: 36,
  },
  transcriptSafeArea: {
    flex: 1,
    backgroundColor: '#09090B',
  },
  transcriptHeader: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  transcriptHeaderText: {
    flex: 1,
    gap: 4,
  },
  transcriptTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
  },
  transcriptMeta: {
    color: 'rgba(255,255,255,0.48)',
    fontSize: 13,
  },
  transcriptBody: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    gap: 16,
  },
  transcriptLine: {
    gap: 6,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  transcriptEn: {
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 24,
  },
  transcriptZh: {
    color: 'rgba(255,255,255,0.52)',
    fontSize: 14,
    lineHeight: 22,
  },
});
