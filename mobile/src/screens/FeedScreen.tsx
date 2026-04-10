import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Dimensions, FlatList, Pressable, StyleSheet, Text, View, type ListRenderItemInfo, type ViewToken } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { buildClipKey, getSourceLabel } from '../clip-utils';
import { ProgressCard, RecoCard, ReviewCard } from '../components/FeedCards';
import { PlayerControls } from '../components/PlayerControls';
import { ProgressBar } from '../components/ProgressBar';
import { WordLine } from '../components/WordLine';
import { WordPopup } from '../components/WordPopup';
import { useFeedPlayer } from '../hooks/useFeedPlayer';
import type { Clip, ClipLine, ClipLineWord, Profile, VocabEntry } from '../types';

const SCREEN_HEIGHT = Dimensions.get('window').height;

type Props = {
  clips: Clip[];
  profile: Profile;
  bookmarkedKeys: string[];
  vocabWords: string[];
  knownWords: string[];
  clipsPlayed: number;
  onToggleBookmark: (clip: Clip, index: number) => void;
  onSaveVocab: (entry: VocabEntry) => void;
  onMarkKnown: (word: string) => void;
  onResetProfile: () => void;
  onAdjustInterests: (interests: string[]) => void;
};

function buildReason(clip: Clip, profile: Profile, index: number) {
  if (clip._aiReason) return clip._aiReason;
  if (index === 0) return '先从一条更容易进入状态的内容开始。';
  if (profile.interests.some(tag => tag.toLowerCase() === (clip.tag || '').toLowerCase())) {
    return `延续你选择的 ${clip.tag || '兴趣'} 方向。`;
  }
  return `保持新鲜感，同时贴近 ${profile.level || '当前'} 听感区间。`;
}

type PopupState = {
  word: ClipLineWord;
  contextEn: string;
  contextZh: string;
} | null;

export function FeedScreen({
  clips,
  profile,
  bookmarkedKeys,
  vocabWords,
  knownWords,
  clipsPlayed,
  onToggleBookmark,
  onSaveVocab,
  onMarkKnown,
  onResetProfile,
  onAdjustInterests,
}: Props) {
  const data = useMemo(() => clips.slice(0, 20), [clips]);
  const [showZh, setShowZh] = useState(true);
  const [popup, setPopup] = useState<PopupState>(null);
  const [dismissedCards, setDismissedCards] = useState<Set<string>>(new Set());

  const {
    activeIndex,
    activeLineIndex,
    durationMillis,
    isLoading,
    isPlaying,
    playbackRate,
    positionMillis,
    playIndex,
    seekBy,
    seekToRatio,
    setRate,
    togglePlay,
  } = useFeedPlayer(data);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const firstVisible = viewableItems.find(item => item.isViewable && typeof item.index === 'number');
    if (!firstVisible || typeof firstVisible.index !== 'number') return;
    void playIndex(firstVisible.index);
  });

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 75 });

  const handleWordTap = useCallback((word: ClipLineWord, line: ClipLine) => {
    setPopup({ word, contextEn: line.en, contextZh: line.zh || '' });
  }, []);

  const dismissCard = useCallback((key: string) => {
    setDismissedCards(prev => new Set(prev).add(key));
  }, []);

  const currentTime = positionMillis / 1000;
  const progress = durationMillis > 0 ? positionMillis / durationMillis : 0;

  const shouldShowReview = clipsPlayed >= 3 && vocabWords.length >= 2 && !dismissedCards.has('review');
  const shouldShowProgress = clipsPlayed >= 5 && !dismissedCards.has('progress');
  const shouldShowReco = clipsPlayed >= 8 && !dismissedCards.has('reco');

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>FLIPOD</Text>
          <Text style={styles.meta}>{profile.level || 'B1'} · {profile.interests.join(', ')}</Text>
        </View>
        <Pressable onPress={onResetProfile} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>重设</Text>
        </Pressable>
      </View>

      <FlatList
        data={data}
        keyExtractor={(_item: Clip, index: number) => String(index)}
        pagingEnabled
        snapToInterval={SCREEN_HEIGHT - 120}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged.current}
        viewabilityConfig={viewabilityConfig.current}
        renderItem={({ item, index }: ListRenderItemInfo<Clip>) => {
          const isActive = index === activeIndex;
          const line = isActive ? item.lines?.[activeLineIndex] : item.lines?.[0];

          return (
            <View style={[styles.card, { minHeight: SCREEN_HEIGHT - 120 }]}>
              <View style={styles.cardTopRow}>
                <Text style={styles.hint}>已根据你的偏好排列</Text>
                <Pressable onPress={() => onToggleBookmark(item, index)} style={styles.bookmarkButton}>
                  <Text style={styles.bookmarkButtonText}>
                    {bookmarkedKeys.includes(buildClipKey(item, index)) ? '已收藏' : '收藏'}
                  </Text>
                </Pressable>
              </View>

              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.source}>{getSourceLabel(item.source)} · {item.tag || 'featured'}</Text>

              <View style={styles.reasonWrap}>
                <Text style={styles.reasonKicker}>WHY THIS NOW</Text>
                <Text style={styles.reasonText}>{buildReason(item, profile, index)}</Text>
              </View>

              <View style={styles.subtitleWrap}>
                {line ? (
                  <WordLine
                    line={line}
                    currentTime={isActive ? currentTime : 0}
                    isActive={isActive}
                    showZh={showZh}
                    onWordTap={handleWordTap}
                  />
                ) : (
                  <Text style={styles.placeholderText}>字幕加载中…</Text>
                )}
              </View>

              <View style={styles.playerWrap}>
                <ProgressBar progress={isActive ? progress : 0} onSeek={seekToRatio} />
                <PlayerControls
                  isPlaying={isActive && isPlaying}
                  isLoading={isActive && isLoading}
                  positionMillis={isActive ? positionMillis : 0}
                  durationMillis={isActive ? durationMillis : 0}
                  playbackRate={playbackRate}
                  showZh={showZh}
                  onTogglePlay={() => togglePlay(index)}
                  onSeekBy={seekBy}
                  onSetRate={setRate}
                  onToggleZh={() => setShowZh(prev => !prev)}
                />
              </View>
            </View>
          );
        }}
        ListFooterComponent={
          <View style={styles.feedCardsWrap}>
            {shouldShowReview && (
              <ReviewCard
                reviewWords={vocabWords.slice(0, 5).map(w => ({ word: w }))}
                onDismiss={() => dismissCard('review')}
              />
            )}
            {shouldShowProgress && (
              <ProgressCard
                clipsPlayed={clipsPlayed}
                wordsLearned={vocabWords.length}
                minutesListened={Math.round(clipsPlayed * 1.2)}
                onContinue={() => dismissCard('progress')}
              />
            )}
            {shouldShowReco && (
              <RecoCard
                interests={profile.interests}
                onAdjust={onAdjustInterests}
                onDismiss={() => dismissCard('reco')}
              />
            )}
          </View>
        }
      />

      {popup && (
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
            });
          }}
          onMarkKnown={() => onMarkKnown(popup.word.word.toLowerCase())}
          onDismiss={() => setPopup(null)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#09090B' },
  header: {
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  brand: { color: '#FFFFFF', fontSize: 14, fontWeight: '700', letterSpacing: 1.1 },
  meta: { color: 'rgba(255,255,255,0.5)', marginTop: 4, fontSize: 12 },
  secondaryButton: {
    borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.04)',
  },
  secondaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  card: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 32, justifyContent: 'space-between' },
  hint: { color: 'rgba(255,255,255,0.32)', fontSize: 11, textAlign: 'left' },
  bookmarkButton: {
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  bookmarkButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  title: { color: '#FFFFFF', fontSize: 26, fontWeight: '700', textAlign: 'center', marginTop: 12 },
  source: { color: 'rgba(255,255,255,0.58)', fontSize: 13, textAlign: 'center', marginTop: 8 },
  reasonWrap: { marginTop: 14, alignItems: 'center' },
  reasonKicker: { color: 'rgba(255,255,255,0.28)', fontSize: 10, letterSpacing: 1.1, fontWeight: '700' },
  reasonText: { color: 'rgba(255,255,255,0.56)', marginTop: 6, maxWidth: 280, textAlign: 'center', lineHeight: 20 },
  subtitleWrap: { marginTop: 24, minHeight: 80 },
  placeholderText: { color: 'rgba(255,255,255,0.32)', fontSize: 16, textAlign: 'center' },
  playerWrap: { marginTop: 20, gap: 4 },
  feedCardsWrap: { gap: 20, paddingVertical: 40 },
});
