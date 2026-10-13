/**
 * FullPlayer — 全屏播放器（_layout 全局挂载；store.playerOpen 控制显隐）
 *
 * 电视端（横排：封面左 + 大字歌词右 + 底部控制带）：
 *   接收遥控器焦点：控制带按钮左右切换；[⏪10s]/[10s⏩] 专用 seek 按钮（不与焦点冲突）
 *   返回键 = 收起（音乐继续）
 * 手机端（竖排：封面/歌词可切换 + 进度可点 + 控制行；下滑收起由返回/按钮处理）
 *
 * 队列：内嵌抽屉（列表高亮当前曲，点选跳转）
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  FlatList,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Rewind,
  FastForward,
  Shuffle,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react-native";

import { ThemedText } from "@/components/ThemedText";
import { StyledButton } from "@/components/StyledButton";
import LyricsView from "@/components/music/LyricsView";
import VinylCover from "@/components/music/VinylCover";
import EqualizerBars from "@/components/music/EqualizerBars";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { useMusicStore, MusicPlayMode } from "@/stores/musicStore";
import { sourceLabel, otherSource } from "@/utils/musicSource";

function fmt(ms: number): string {
  if (!ms || ms < 0) return "00:00";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

const MODE_ICON: Record<MusicPlayMode, any> = {
  loop: Repeat,
  single: Repeat1,
  random: Shuffle,
};
const MODE_NEXT: Record<MusicPlayMode, MusicPlayMode> = {
  loop: "single",
  single: "random",
  random: "loop",
};
const MODE_LABEL: Record<MusicPlayMode, string> = {
  loop: "列表循环",
  single: "单曲循环",
  random: "随机播放",
};

/* 进度条（独立订阅，随位置更新） */
function SeekBar({ onPressRatio, height = 6 }: { onPressRatio?: (r: number) => void; height?: number }) {
  const position = useMusicStore((s) => s.position);
  const duration = useMusicStore((s) => s.duration);
  const ratio = duration > 0 ? Math.min(1, position / duration) : 0;
  const areaRef = useRef<View>(null);

  return (
    <View
      ref={areaRef}
      style={[styles.seekTrack, { height: Math.max(height, 6) }]}
      onLayout={() => undefined}
    >
      <View style={[styles.seekFill, { width: `${ratio * 100}%`, height }]} />
      <View style={[styles.seekDot, { left: `${ratio * 100}%` }]} />
      {onPressRatio ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          focusable
          onPress={(e) => {
            const x = e.nativeEvent.locationX;
            // @ts-ignore measure 宽度
            areaRef.current?.measure?.((_x: number, _y: number, w: number) => {
              if (w > 0) onPressRatio(Math.max(0, Math.min(1, x / w)));
            });
          }}
        />
      ) : null}
    </View>
  );
}

/* 时间行 */
function TimeRow({ fontSize = 13 }: { fontSize?: number }) {
  const position = useMusicStore((s) => s.position);
  const duration = useMusicStore((s) => s.duration);
  return (
    <View style={styles.timeRow}>
      <ThemedText style={[styles.time, { fontSize }]}>{fmt(position)}</ThemedText>
      <ThemedText style={[styles.time, { fontSize }]}>{fmt(duration)}</ThemedText>
    </View>
  );
}

/* 队列面板 */
function QueuePanel({ onClose }: { onClose: () => void }) {
  const queue = useMusicStore((s) => s.queue);
  const index = useMusicStore((s) => s.index);
  const playAt = useMusicStore((s) => s.playAt);
  const moveQueueItem = useMusicStore((s) => s.moveQueueItem);
  const removeFromQueue = useMusicStore((s) => s.removeFromQueue);
  return (
    <View style={styles.queueWrap}>
      <View style={styles.queueHead}>
        <ThemedText style={styles.queueTitle}>播放队列（{queue.length}）</ThemedText>
        <StyledButton onPress={onClose} style={styles.queueClose}>
          <ChevronDown size={20} color="#fff" />
        </StyledButton>
      </View>
      <FlatList
        data={queue}
        keyExtractor={(item, i) => `${item.songId}-${i}`}
        renderItem={({ item, index: i }) => (
          <Pressable
            style={[styles.queueRow, i === index && styles.queueRowActive]}
            onPress={() => void playAt(i)}
            focusable
          >
            <ThemedText style={styles.queueRowIndex}>{i + 1}</ThemedText>
            <View style={{ flex: 1 }}>
              <ThemedText numberOfLines={1} style={i === index ? styles.queueNameActive : styles.queueName}>
                {item.name}
              </ThemedText>
              <ThemedText numberOfLines={1} style={styles.queueArtist}>
                {item.artist}
              </ThemedText>
            </View>
            <View style={styles.queueOps}>
              <Pressable
                onPress={() => moveQueueItem(i, i - 1)}
                disabled={i === 0}
                hitSlop={6}
                style={styles.queueOpBtn}
                accessibilityLabel="上移"
              >
                <ArrowUp size={16} color={i === 0 ? "#3A3C42" : "#9AA0A6"} />
              </Pressable>
              <Pressable
                onPress={() => moveQueueItem(i, i + 1)}
                disabled={i === queue.length - 1}
                hitSlop={6}
                style={styles.queueOpBtn}
                accessibilityLabel="下移"
              >
                <ArrowDown size={16} color={i === queue.length - 1 ? "#3A3C42" : "#9AA0A6"} />
              </Pressable>
              <Pressable
                onPress={() => void removeFromQueue(i)}
                hitSlop={6}
                style={styles.queueOpBtn}
                accessibilityLabel="从队列移除"
              >
                <X size={16} color="#9AA0A6" />
              </Pressable>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

export default function FullPlayer() {
  const { deviceType } = useResponsiveLayout();
  const { width } = useWindowDimensions();
  const playerOpen = useMusicStore((s) => s.playerOpen);
  const setPlayerOpen = useMusicStore((s) => s.setPlayerOpen);
  const current = useMusicStore((s) => s.current);
  const isPlaying = useMusicStore((s) => s.isPlaying);
  const isLoading = useMusicStore((s) => s.isLoading);
  const mode = useMusicStore((s) => s.mode);
  const setMode = useMusicStore((s) => s.setMode);
  const toggle = useMusicStore((s) => s.toggle);
  const next = useMusicStore((s) => s.next);
  const prev = useMusicStore((s) => s.prev);
  const seekBy = useMusicStore((s) => s.seekBy);
  const seek = useMusicStore((s) => s.seek);
  const duration = useMusicStore((s) => s.duration);
  const quality = useMusicStore((s) => s.quality);
  const setQuality = useMusicStore((s) => s.setQuality);
  const switchSource = useMusicStore((s) => s.switchSource);
  const requestSearch = useMusicStore((s) => s.requestSearch);

  /** 点歌名/歌手 → 跳音乐搜索（收起播放器） */
  const jumpSearch = (q: string) => {
    const term = (q || "").trim();
    if (!term) return;
    requestSearch(term);
    setPlayerOpen(false);
  };

  const [queueOpen, setQueueOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<"cover" | "lyric">("cover");

  const isMobile = deviceType === "mobile";
  const isTV = deviceType === "tv";

  const coverSize = useMemo(() => {
    // size = 唱片机组合（封面+滑出的唱片）的占宽；封面边长约为其 0.74
    if (isMobile) return Math.min(width * 0.9, 400);
    return Math.min(width * 0.32, 520);
  }, [isMobile, width]);

  /* ---- 返回键（Android / TV 遥控）：播放器打开时优先「收起」，而不是退出页面 ---- */
  useEffect(() => {
    if (!playerOpen) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (queueOpen) {
        setQueueOpen(false);
        return true;
      }
      setPlayerOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [playerOpen, queueOpen, setPlayerOpen]);

  /* ---- 手机手势：顶部拖拽把手收起 / 封面区左右滑切歌 ---- */
  const dragY = useRef(new Animated.Value(0)).current;
  const panDrag = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 10 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) dragY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 130) {
          dragY.setValue(0);
          setPlayerOpen(false);
        } else {
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start();
      },
    })
  ).current;
  const panSwipe = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 28 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderRelease: (_, g) => {
        if (g.dx < -64) void next();
        else if (g.dx > 64) void prev();
      },
    })
  ).current;

  if (!playerOpen || !current) return null;

  const ModeIcon = MODE_ICON[mode];

  const qualityBtn = (
    <StyledButton
      variant={isMobile ? "ghost" : "default"}
      onPress={() => void setQuality(quality === "320k" ? "128k" : "320k")}
      style={isMobile ? styles.ctrlM : styles.ctrlT}
    >
      <ThemedText style={[styles.qualityText, isMobile ? { fontSize: 11 } : null]}>
        {quality === "320k" ? "320K" : "128K"}
      </ThemedText>
    </StyledButton>
  );

  // 手机：两行（主行 上一首·播放·下一首，副行 模式·快退·快进·队列·音质），8 个控件一行放不下
  const controls = isMobile ? (
    <View style={styles.controlsMobileWrap}>
      <View style={[styles.controlsRow, { gap: 28 }]}>
        <StyledButton variant="ghost" onPress={() => void prev()} style={styles.ctrlBigM}>
          <SkipBack size={28} color="#fff" />
        </StyledButton>
        <StyledButton onPress={() => void toggle()} variant="primary" style={[styles.ctrlMainM, styles.ctrlMainFill]}>
          {isPlaying ? <Pause size={28} color="#fff" /> : <Play size={28} color="#fff" />}
        </StyledButton>
        <StyledButton variant="ghost" onPress={() => void next()} style={styles.ctrlBigM}>
          <SkipForward size={28} color="#fff" />
        </StyledButton>
      </View>
      <View style={[styles.controlsRow, { justifyContent: "space-around", alignSelf: "stretch" }]}>
        <StyledButton variant="ghost" onPress={() => setMode(MODE_NEXT[mode])} style={styles.ctrlM}>
          <ModeIcon size={20} color="#D7D9DE" />
        </StyledButton>
        <StyledButton variant="ghost" onPress={() => void seekBy(-10000)} style={styles.ctrlM}>
          <Rewind size={20} color="#D7D9DE" />
        </StyledButton>
        <StyledButton variant="ghost" onPress={() => void seekBy(10000)} style={styles.ctrlM}>
          <FastForward size={20} color="#D7D9DE" />
        </StyledButton>
        <StyledButton variant="ghost" onPress={() => setQueueOpen(true)} style={styles.ctrlM}>
          <ListMusic size={20} color="#D7D9DE" />
        </StyledButton>
        {qualityBtn}
      </View>
    </View>
  ) : (
    <View style={[styles.controlsRow, styles.controlsTv]}>
      <StyledButton
        onPress={() => setMode(MODE_NEXT[mode])}
        style={styles.ctrlT}
      >
        <ModeIcon size={isMobile ? 18 : 22} color="#D7D9DE" />
      </StyledButton>
      <StyledButton onPress={() => void seekBy(-10000)} style={styles.ctrlT}>
        <Rewind size={26} color="#fff" />
      </StyledButton>
      <StyledButton onPress={() => void prev()} style={styles.ctrlT}>
        <SkipBack size={30} color="#fff" />
      </StyledButton>
      <StyledButton onPress={() => void toggle()} variant="primary" style={styles.ctrlMainT}>
        {isPlaying ? <Pause size={32} color="#fff" /> : <Play size={32} color="#fff" />}
      </StyledButton>
      <StyledButton onPress={() => void next()} style={styles.ctrlT}>
        <SkipForward size={30} color="#fff" />
      </StyledButton>
      <StyledButton onPress={() => void seekBy(10000)} style={styles.ctrlT}>
        <FastForward size={26} color="#fff" />
      </StyledButton>
      <StyledButton onPress={() => setQueueOpen(true)} style={styles.ctrlT}>
        <ListMusic size={22} color="#D7D9DE" />
      </StyledButton>
      {qualityBtn}
    </View>
  );

  const cover = (
    <View style={styles.coverBlock}>
      <VinylCover size={coverSize} uri={current.cover} playing={isPlaying} />
      <EqualizerBars playing={isPlaying} width={Math.round(coverSize * 0.5)} height={isMobile ? 30 : 40} count={11} />
    </View>
  );

  /* ---------------- 手机形态 ---------------- */
  if (isMobile) {
    return (
      <Animated.View style={[styles.root, { transform: [{ translateY: dragY }] }]}>
        <View style={styles.topBar}>
          <StyledButton onPress={() => setPlayerOpen(false)} style={styles.topBtn}>
            <ChevronDown size={26} color="#fff" />
          </StyledButton>
          <ThemedText style={styles.topTitle} numberOfLines={1}>
            {current.name} — {current.artist}
          </ThemedText>
          <View style={styles.topBtn} />
        </View>

        {/* 拖拽把手：按住下滑可收起播放器 */}
        <View {...panDrag.panHandlers} style={styles.dragHandle}>
          <View style={styles.dragPill} />
        </View>

        <View style={styles.mobileStage} {...panSwipe.panHandlers}>
          <Pressable
            style={styles.mobileStageInner}
            onPress={() => setMobilePane((p) => (p === "cover" ? "lyric" : "cover"))}
          >
          {mobilePane === "cover" ? (
            <View style={styles.mobileCoverArea}>
              {cover}
              <Pressable onPress={() => jumpSearch(current.name)}>
                <ThemedText style={styles.mobileName} numberOfLines={1}>
                  {current.name}
                </ThemedText>
              </Pressable>
              <Pressable onPress={() => jumpSearch(current.artist)}>
                <ThemedText style={styles.mobileArtist} numberOfLines={1}>
                  {current.artist}
                  {isLoading ? " · 加载中…" : ""}
                </ThemedText>
              </Pressable>
              <Pressable onPress={() => void switchSource()} style={styles.srcChip} accessibilityLabel="切换音源">
                <ThemedText style={styles.srcChipText}>
                  音源：{sourceLabel(current.source)} ⇄ {sourceLabel(otherSource(current.source))}
                </ThemedText>
              </Pressable>
              <ThemedText style={styles.mobileHint}>轻触封面切换歌词 · 点歌名搜同款</ThemedText>
            </View>
          ) : (
            <LyricsView
              fontSize={20}
              topPad={90}
              onSeek={(ms) => void seek(ms)}
            />
          )}
          </Pressable>
        </View>

        <View style={styles.bottom}>
          <SeekBar height={5} onPressRatio={(r) => void seek(r * (duration || 0))} />
          <TimeRow fontSize={12} />
          {controls}
        </View>

        {queueOpen ? <QueuePanel onClose={() => setQueueOpen(false)} /> : null}
      </Animated.View>
    );
  }

  /* ---------------- 电视/平板形态 ---------------- */
  return (
    <View style={styles.root}>
      <View style={styles.tvBody}>
        <View style={[styles.tvLeft, isTV ? styles.tvLeftTv : null]}>
          {cover}
          <Pressable onPress={() => jumpSearch(current.name)} focusable>
            <ThemedText style={styles.tvName} numberOfLines={1}>
              {current.name}
            </ThemedText>
          </Pressable>
          <Pressable onPress={() => jumpSearch(current.artist)} focusable>
            <ThemedText style={styles.tvArtist} numberOfLines={1}>
              {current.artist}
              {current.album ? ` · ${current.album}` : ""}
            </ThemedText>
          </Pressable>
          <Pressable onPress={() => void switchSource()} focusable style={styles.srcChip} accessibilityLabel="切换音源">
            <ThemedText style={styles.srcChipText}>
              音源：{sourceLabel(current.source)} ⇄ {sourceLabel(otherSource(current.source))}
            </ThemedText>
          </Pressable>
          <ThemedText style={styles.tvModeLabel}>{MODE_LABEL[mode]} · {quality}</ThemedText>
        </View>
        <View style={styles.tvRight}>
          <LyricsView
            fontSize={isTV ? 40 : 28}
            topPad={isTV ? 220 : 140}
            onSeek={(ms) => void seek(ms)}
          />
        </View>
      </View>

      <View style={styles.tvBottom}>
        <SeekBar height={6} />
        <TimeRow fontSize={14} />
        {controls}
      </View>

      {queueOpen ? <QueuePanel onClose={() => setQueueOpen(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0E0F12",
    zIndex: 1500,
    elevation: 1500,
  },
  /* 手机 */
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingTop: 10,
  },
  topBtn: {
    minWidth: 44,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  topTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 14,
    opacity: 0.85,
  },
  mobileStage: {
    flex: 1,
  },
  mobileStageInner: {
    flex: 1,
  },
  dragHandle: {
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  dragPill: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#3A3C42",
  },
  mobileCoverArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  mobileName: {
    fontSize: 20,
    fontWeight: "700",
    marginTop: 8,
    paddingHorizontal: 32,
  },
  mobileArtist: {
    fontSize: 14,
    opacity: 0.6,
    paddingHorizontal: 32,
  },
  mobileHint: {
    fontSize: 11,
    opacity: 0.3,
    marginTop: 6,
  },
  bottom: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    gap: 6,
  },
  /* TV */
  tvBody: {
    flex: 1,
    flexDirection: "row",
    paddingHorizontal: 64,
    paddingTop: 40,
  },
  tvLeft: {
    width: "38%",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  tvLeftTv: {},
  tvRight: {
    flex: 1,
  },
  tvName: {
    fontSize: 26,
    fontWeight: "700",
    marginTop: 10,
  },
  tvArtist: {
    fontSize: 17,
    opacity: 0.6,
  },
  tvModeLabel: {
    fontSize: 13,
    opacity: 0.38,
    marginTop: 2,
  },
  tvBottom: {
    paddingHorizontal: 64,
    paddingBottom: 34,
    paddingTop: 6,
    gap: 8,
  },
  /* 封面 */
  coverBlock: {
    alignItems: "center",
    gap: 12,
  },
  /* 进度条 */
  seekTrack: {
    width: "100%",
    backgroundColor: "#2A2C31",
    borderRadius: 3,
    justifyContent: "center",
  },
  seekFill: {
    backgroundColor: "#1DB954",
    borderRadius: 3,
    position: "absolute",
    left: 0,
    top: 0,
  },
  seekDot: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#fff",
    marginLeft: -7,
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  time: {
    opacity: 0.5,
    fontVariant: ["tabular-nums"],
  },
  /* 控制 */
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  controlsMobile: {
    paddingTop: 4,
  },
  controlsMobileWrap: {
    gap: 6,
    paddingTop: 2,
  },
  ctrlBigM: {
    minWidth: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  controlsTv: {
    paddingTop: 6,
  },
  ctrlM: {
    minWidth: 44,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  ctrlT: {
    minWidth: 64,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  ctrlMainFill: {
    backgroundColor: "#1DB954",
  },
  ctrlMainM: {
    minWidth: 72,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 28,
  },
  ctrlMainT: {
    minWidth: 84,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 32,
  },
  /* 队列 */
  queueWrap: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10,11,13,0.97)",
    zIndex: 1600,
  },
  queueHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  queueTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  queueClose: {
    minWidth: 44,
    alignItems: "center",
  },
  queueRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 12,
  },
  queueRowActive: {
    backgroundColor: "rgba(29,185,84,0.12)",
  },
  queueRowIndex: {
    width: 28,
    textAlign: "center",
    opacity: 0.5,
    fontSize: 13,
  },
  queueName: {
    fontSize: 15,
  },
  queueNameActive: {
    fontSize: 15,
    color: "#1DB954",
    fontWeight: "600",
  },
  queueArtist: {
    fontSize: 12,
    opacity: 0.55,
    marginTop: 1,
  },
  queueOps: {
    flexDirection: "row",
    gap: 4,
  },
  queueOpBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#26272B",
  },
  srcChip: {
    alignSelf: "center",
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  srcChipText: {
    fontSize: 12,
    color: "#D7D9DE",
  },
  qualityText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#D7D9DE",
  },
});
