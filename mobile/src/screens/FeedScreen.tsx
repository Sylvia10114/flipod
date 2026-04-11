import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  buildClipKey,
  getSentenceInfo,
  getSentenceMarkers,
  getSentenceRange,
  getSourceLabel,
} from '../clip-utils';
import { ProgressCard, RecoCard, ReviewCard } from '../components/FeedCards';
import { PlayerControls } from '../components/PlayerControls';
import { ProgressBar } from '../components/ProgressBar';
import { WordLine } from '../components/WordLine';
import { WordPopup } from '../components/WordPopup';
import { useFeedPlayer } from '../hooks/useFeedPlayer';
import type { Clip, ClipLine, ClipLineWord, DominantHand, Profile, VocabEntry } from '../types';

const SCREEN_HEIGHT = Dimensions.get('window').height;

type Props = {
  clips: Clip[];
  profile: Profile;
  dominantHand: DominantHand;
  playbackRate: number;
  feedState: 'loading' | 'normal' | 'rerank' | 'fallback';
  bookmarkedKeys: string[];
  likedKeys: string[];
  recoTag: string | null;
  vocabWords: string[];
  knownWords: string[];
  clipsPlayed: number;
  onToggleLike: (clip: Clip, index: number) => void;
  onToggleBookmark: (clip: Clip, index: number) => void;
  onSaveVocab: (entry: VocabEntry) => void;
  onMarkKnown: (word: string) => void;
  onOpenMenu: () => void;
  onResetProfile: () => void;
  onPromoteInterest: (tag: string) => void;
  onPlaybackRateChange: (rate: number) => void;
  onClipPlayed: (clipKey: string) => void;
};

function buildReason(clip: Clip, profile: Profile, index: number) {
  if (clip._aiReason) return clip._aiReason;
  if (index === 0) return '我先用一条更容易进入状态的内容，帮你尽快听起来。';
  if (profile.interests.some(tag => tag.toLowerCase() === (clip.tag || '').toLowerCase())) {
    return `你在 onboarding 里选过 ${clip.tag || '这个主题'}，我先延续这个方向。`;
  }
  return `这条会更贴近你当前 ${profile.level || 'B1'} 的听感区间，同时保持一点新鲜感。`;
}

type PopupState = {
  word: ClipLineWord;
  contextEn: string;
  contextZh: string;
  clipKey: string;
  clipTitle: string;
} | null;

export function FeedScreen({
  clips,
  profile,
  dominantHand,
  playbackRate,
  feedState,
  bookmarkedKeys,
  likedKeys,
  recoTag,
  vocabWords,
  knownWords,
  clipsPlayed,
  onToggleLike,
  onToggleBookmark,
  onSaveVocab,
  onMarkKnown,
  onOpenMenu,
  onResetProfile,
  onPromoteInterest,
  onPlaybackRateChange,
  onClipPlayed,
}: Props) {
  const data = useMemo(() => clips.slice(0, 20), [clips]);
  const [showZh, setShowZh] = useState(false);
  const [masked, setMasked] = useState(false);
  const [popup, setPopup] = useState<PopupState>(null);
  const [dismissedCards, setDismissedCards] = useState<Set<string>>(new Set());
  const [reasonIndex, setReasonIndex] = useState<number | null>(null);
  const [transcriptIndex, setTranscriptIndex] = useState<number | null>(null);
  const playedRef = useRef<Set<string>>(new Set());

  const {
    activeIndex,
    activeLineIndex,
    durationMillis,
    errorMessage,
    isLoading,
    isPlaying,
    playbackRate: currentPlaybackRate,
    positionMillis,
    playIndex,
    seekNextSentence,
    seekPrevSentence,
    seekToRatio,
    setRate,
    togglePlay,
  } = useFeedPlayer(data, playbackRate);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const firstVisible = viewableItems.find(item => item.isViewable && typeof item.index === 'number');
    if (!firstVisible || typeof firstVisible.index !== 'number') return;
    void playIndex(firstVisible.index);
  });

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 75 });

  const handleWordTap = useCallback((word: ClipLineWord, line: ClipLine, clipKey: string, clipTitle: string) => {
    setPopup({ word, contextEn: line.en, contextZh: line.zh || '', clipKey, clipTitle });
  }, []);

  const dismissCard = useCallback((key: string) => {
    setDismissedCards(prev => new Set(prev).add(key));
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    const clip = data[activeIndex];
    if (!clip) return;
    const key = buildClipKey(clip, activeIndex);
    if (playedRef.current.has(key)) return;
    playedRef.current.add(key);
    onClipPlayed(key);
  }, [activeIndex, data, isPlaying, onClipPlayed]);

  useEffect(() => {
    if (reasonIndex !== null && reasonIndex !== activeIndex) {
      setReasonIndex(null);
    }
  }, [activeIndex, reasonIndex]);

  const currentClip = data[activeIndex];
  const currentTime = positionMillis / 1000;
  const progress = durationMillis > 0 ? positionMillis / durationMillis : 0;
  const sentenceInfo = currentClip ? getSentenceInfo(currentClip, currentTime) : { current: 1, total: 0 };
  const markers = currentClip ? getSentenceMarkers(currentClip) : [];
  const currentSentenceRange = currentClip ? getSentenceRange(currentClip, activeLineIndex) : null;

  const shouldShowReview = clipsPlayed >= 3 && vocabWords.length >= 2 && !dismissedCards.has('review');
  const shouldShowProgress = clipsPlayed >= 5 && !dismissedCards.has('progress');
  const shouldShowReco = clipsPlayed >= 8 && Boolean(recoTag) && !dismissedCards.has('reco');
  const transcriptClip = typeof transcriptIndex === 'number' ? data[transcriptIndex] : null;
  const hintText = {
    loading: 'AI 正在为你排列内容...',
    normal: '已根据你的偏好排列',
    rerank: '刚刚根据你的表现重新调整了顺序',
    fallback: '这几条已经替你排好了',
  }[feedState];

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlatList
        data={data}
        keyExtractor={(item, index) => buildClipKey(item, index)}
        pagingEnabled
        snapToInterval={SCREEN_HEIGHT}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged.current}
        viewabilityConfig={viewabilityConfig.current}
        renderItem={({ item, index }: ListRenderItemInfo<Clip>) => {
          const isActive = index === activeIndex;
          const line = isActive ? item.lines?.[activeLineIndex] : item.lines?.[0];
          const clipKey = buildClipKey(item, index);
          const sentenceLabel = isActive
            ? `第 ${sentenceInfo.current} / ${sentenceInfo.total} 句`
            : `第 1 / ${item.lines?.length || 0} 句`;
          const clipIndicator = `${index + 1} / ${data.length}`;
          const reasonVisible = reasonIndex === index;
          const bookmarkLabel = bookmarkedKeys.includes(clipKey) ? '已收' : '收藏';
          const liked = likedKeys.includes(clipKey);

          return (
            <View style={[styles.card, { minHeight: SCREEN_HEIGHT }]}>
              <View>
                <View style={[styles.topChrome, dominantHand === 'left' && styles.topChromeLeft]}>
                  <Pressable onPress={onOpenMenu} style={styles.iconButton}>
                    <View style={styles.menuGlyph}>
                      <View style={styles.menuLineWide} />
                      <View style={styles.menuLineShort} />
                    </View>
                  </Pressable>

                  <View style={styles.topChromeRight}>
                    <Pressable onPress={() => setTranscriptIndex(index)} style={styles.smallChip}>
                      <Text style={styles.smallChipText}>Transcript</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setReasonIndex(prev => (prev === index ? null : index))}
                      style={styles.iconButton}
                    >
                      <Text style={styles.helpText}>?</Text>
                    </Pressable>
                  </View>
                </View>

                {reasonVisible ? (
                  <View style={styles.reasonBubble}>
                    <Text style={styles.reasonBubbleTitle}>WHY THIS NOW</Text>
                    <Text style={styles.reasonBubbleText}>{buildReason(item, profile, index)}</Text>
                  </View>
                ) : null}

                <View style={styles.topInfo}>
                  <Text style={[styles.hint, feedState === 'rerank' && styles.hintRerank]}>
                    {hintText}
                  </Text>
                  <Text style={styles.title}>{item.title}</Text>
                  <Text style={styles.source}>
                    {getSourceLabel(item.source)}
                    {item.tag ? ` · ${item.tag}` : ''}
                  </Text>
                </View>
              </View>

              <View style={styles.subtitleWrap}>
                <View style={[styles.sideRail, dominantHand === 'left' ? styles.sideRailLeft : styles.sideRailRight]}>
                  <Pressable onPress={() => onToggleLike(item, index)} style={[styles.sideRailButton, liked && styles.sideRailButtonActive]}>
                    <Text style={[styles.sideRailButtonIcon, liked && styles.sideRailButtonIconActive]}>♥</Text>
                  </Pressable>
                  <Pressable onPress={() => onToggleBookmark(item, index)} style={styles.sideRailButton}>
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
                    onWordTap={(word, lineData) => handleWordTap(word, lineData, clipKey, item.title)}
                  />
                ) : null}

                {isActive && errorMessage ? <Text style={styles.audioError}>{errorMessage}</Text> : null}
                {isActive && !errorMessage && isLoading ? <Text style={styles.loadingText}>音频加载中…</Text> : null}
              </View>

              <View style={styles.bottomControls}>
                <ProgressBar
                  progress={isActive ? progress : 0}
                  markers={isActive ? markers : []}
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
                  sentenceIndicator={sentenceLabel}
                  clipIndicator={clipIndicator}
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
                />
              </View>
            </View>
          );
        }}
        ListFooterComponent={
          <View style={styles.feedCardsWrap}>
            {shouldShowReview ? (
              <ReviewCard
                reviewWords={vocabWords.slice(0, 5).map(word => ({ word }))}
                onDismiss={() => dismissCard('review')}
              />
            ) : null}
            {shouldShowProgress ? (
              <ProgressCard
                clipsPlayed={clipsPlayed}
                wordsLearned={vocabWords.length}
                minutesListened={Math.round(clipsPlayed * 1.2)}
                onContinue={() => dismissCard('progress')}
              />
            ) : null}
            {shouldShowReco ? (
              <RecoCard
                interests={profile.interests}
                recoTag={recoTag}
                onAccept={tag => {
                  void onPromoteInterest(tag);
                  dismissCard('reco');
                }}
                onDismiss={() => dismissCard('reco')}
              />
            ) : null}
            <Pressable onPress={onResetProfile} style={styles.resetButton}>
              <Text style={styles.resetButtonText}>重新选择等级与兴趣</Text>
            </Pressable>
          </View>
        }
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
            <Pressable onPress={() => setTranscriptIndex(null)} style={styles.smallChip}>
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
  topChrome: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topChromeLeft: {
    flexDirection: 'row-reverse',
  },
  topChromeRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuGlyph: {
    width: 18,
    gap: 4,
  },
  menuLineWide: {
    height: 1.5,
    width: 18,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.82)',
  },
  menuLineShort: {
    height: 1.5,
    width: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.82)',
  },
  helpText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
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
  reasonBubble: {
    marginTop: 14,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(23,23,31,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    gap: 6,
  },
  reasonBubbleTitle: {
    color: 'rgba(255,255,255,0.32)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  reasonBubbleText: {
    color: 'rgba(255,255,255,0.74)',
    fontSize: 13,
    lineHeight: 20,
  },
  topInfo: {
    marginTop: 24,
    alignItems: 'center',
    gap: 8,
  },
  hint: {
    color: 'rgba(255,255,255,0.22)',
    fontSize: 11,
    fontWeight: '600',
  },
  hintRerank: {
    color: 'rgba(255,255,255,0.46)',
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
    minHeight: 250,
    justifyContent: 'center',
    position: 'relative',
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
  },
  feedCardsWrap: {
    gap: 20,
    paddingBottom: 40,
  },
  resetButton: {
    marginHorizontal: 20,
    borderRadius: 18,
    paddingVertical: 15,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  resetButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
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
