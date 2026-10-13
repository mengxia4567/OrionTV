import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  PanResponder,
  LayoutChangeEvent,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeft,
  Play,
  Pause,
  SkipForward,
  List,
  Gauge,
  Layers,
  Maximize,
  Minimize,
  Proportions,
  Rewind,
  FastForward,
} from "lucide-react-native";
import usePlayerStore from "@/stores/playerStore";
import useDetailStore from "@/stores/detailStore";
import { useAspectStore } from "@/stores/aspectStore";
import { ASPECT_LABEL } from "@/utils/aspectMode";
import { isDoubleTap } from "@/utils/liveGesture";
import { clampSeek, isHorizontalDrag, LONG_PRESS_MS, LONG_PRESS_RATE, seekDeltaMs, tapZone } from "@/utils/vodGesture";

interface Props {
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onBack: () => void;
}

const AUTO_HIDE_MS = 3500;

const formatTime = (ms: number) => {
  if (!ms || ms < 0 || isNaN(ms)) return "00:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${String(h).padStart(2, "0")}:${mm}:${ss}` : `${mm}:${ss}`;
};

/**
 * 手机 / 平板点播控制层（替代 expo-av 原生控件）。
 * 原生控件只有一个「原生全屏」按钮：它不锁方向，所以全屏仍是竖屏；
 * 这里用自己的控制条 + 应用内沉浸式全屏（见 hooks/useImmersiveFullscreen）。
 *   单击画面 = 呼出/隐藏控制条｜双击左/右侧 = 快退/快进 10s，双击中间 = 播放/暂停
 *   水平拖动 = 跟手 seek（松手生效）｜长按 = 临时 2 倍速（松手恢复）
 *   中间 快退10s / 播放暂停 / 快进10s｜底部 进度条（可拖）
 *   底部按钮：选集 / 倍速 / 换源 / 下一集 / 比例（全屏时）/ 全屏
 *   缓冲时显示转圈；所有播放源都失败时显示「重试 / 换源」
 */
export default function MobileVodControls({ isFullscreen, onToggleFullscreen, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const {
    status,
    episodes,
    currentEpisodeIndex,
    playbackRate,
    togglePlayPause,
    seek,
    playEpisode,
    setShowEpisodeModal,
    setShowSourceModal,
    setShowSpeedModal,
  } = usePlayerStore();
  const detail = useDetailStore((s) => s.detail);
  const aspectMode = useAspectStore((s) => s.mode);
  const cycleAspect = useAspectStore((s) => s.cycle);
  const loadFailed = usePlayerStore((s) => s.loadFailed);
  const retry = usePlayerStore((s) => s.retry);

  const [visible, setVisible] = useState(true);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackW = useRef(1);
  const startRatio = useRef(0);
  const dragging = useRef(false);

  // 手势层状态
  const [seekPreview, setSeekPreview] = useState<{ targetMs: number; deltaMs: number } | null>(null);
  const [fastHint, setFastHint] = useState(false);
  const [tapHint, setTapHint] = useState<"left" | "right" | null>(null);
  const layoutW = useRef(1);
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const lastTapAt = useRef<number | null>(null);
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touch = useRef({ x: 0, startPos: 0, seeking: false, fast: false });

  const loaded = !!status && status.isLoaded;
  const isPlaying = loaded && (status as { isPlaying: boolean }).isPlaying;
  const duration = loaded ? (status as { durationMillis?: number }).durationMillis || 0 : 0;
  const position = loaded ? (status as { positionMillis: number }).positionMillis : 0;
  const ratio = dragRatio ?? (duration > 0 ? Math.min(1, position / duration) : 0);
  positionRef.current = position;
  durationRef.current = duration;
  const buffering = loaded && !!(status as { isBuffering?: boolean }).isBuffering && isPlaying !== false;

  const armHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!dragging.current) setVisible(false);
    }, AUTO_HIDE_MS);
  }, []);

  const show = useCallback(() => {
    setVisible(true);
    armHide();
  }, [armHide]);

  useEffect(() => {
    armHide();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [armHide]);

  // 暂停时一直显示控制条
  useEffect(() => {
    if (loaded && !isPlaying) {
      setVisible(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    } else if (loaded && isPlaying) {
      armHide();
    }
  }, [loaded, isPlaying, armHide]);

  const act = (fn: () => void) => () => {
    fn();
    show();
  };

  const setRate = (rate: number) => {
    void usePlayerStore
      .getState()
      .videoRef?.current?.setRateAsync(rate, true)
      .catch(() => {});
  };

  const flashTapHint = (side: "left" | "right") => {
    setTapHint(side);
    if (tapHintTimer.current) clearTimeout(tapHintTimer.current);
    tapHintTimer.current = setTimeout(() => setTapHint(null), 600);
  };

  const gesture = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          touch.current = { x: e.nativeEvent.locationX, startPos: positionRef.current, seeking: false, fast: false };
          if (longTimer.current) clearTimeout(longTimer.current);
          longTimer.current = setTimeout(() => {
            if (touch.current.seeking) return;
            touch.current.fast = true;
            setFastHint(true);
            setRate(LONG_PRESS_RATE);
          }, LONG_PRESS_MS);
        },
        onPanResponderMove: (_e, g) => {
          const t = touch.current;
          if (t.fast) return;
          if (!t.seeking && isHorizontalDrag(g.dx, g.dy)) {
            t.seeking = true;
            if (longTimer.current) clearTimeout(longTimer.current);
          }
          if (t.seeking) {
            const delta = seekDeltaMs(g.dx, layoutW.current, durationRef.current);
            setSeekPreview({ targetMs: clampSeek(t.startPos, delta, durationRef.current), deltaMs: delta });
          }
        },
        onPanResponderRelease: (_e, g) => {
          if (longTimer.current) clearTimeout(longTimer.current);
          const t = touch.current;
          if (t.fast) {
            setFastHint(false);
            setRate(usePlayerStore.getState().playbackRate);
            return;
          }
          if (t.seeking) {
            const delta = seekDeltaMs(g.dx, layoutW.current, durationRef.current);
            const target = clampSeek(t.startPos, delta, durationRef.current);
            setSeekPreview(null);
            void usePlayerStore
              .getState()
              .videoRef?.current?.setPositionAsync(target)
              .catch(() => {});
            return;
          }
          if (Math.abs(g.dx) > 10 || Math.abs(g.dy) > 10) return;
          const now = Date.now();
          if (isDoubleTap(lastTapAt.current, now)) {
            lastTapAt.current = null;
            if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
            const zone = tapZone(t.x, layoutW.current);
            const store = usePlayerStore.getState();
            if (zone === "left") {
              void store.seek(-10000);
              flashTapHint("left");
            } else if (zone === "right") {
              void store.seek(10000);
              flashTapHint("right");
            } else {
              void store.togglePlayPause();
            }
            return;
          }
          lastTapAt.current = now;
          if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
          singleTapTimer.current = setTimeout(() => {
            lastTapAt.current = null;
            setVisible((v) => !v);
          }, 290);
        },
        onPanResponderTerminate: () => {
          if (longTimer.current) clearTimeout(longTimer.current);
          if (touch.current.fast) {
            setFastHint(false);
            setRate(usePlayerStore.getState().playbackRate);
          }
          touch.current.seeking = false;
          setSeekPreview(null);
        },
      }),
    [],
  );

  useEffect(
    () => () => {
      if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
      if (longTimer.current) clearTimeout(longTimer.current);
      if (tapHintTimer.current) clearTimeout(tapHintTimer.current);
    },
    [],
  );

  const seekPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          dragging.current = true;
          if (hideTimer.current) clearTimeout(hideTimer.current);
          startRatio.current = Math.max(0, Math.min(1, e.nativeEvent.locationX / trackW.current));
          setDragRatio(startRatio.current);
        },
        onPanResponderMove: (_e, g) => {
          setDragRatio(Math.max(0, Math.min(1, startRatio.current + g.dx / trackW.current)));
        },
        onPanResponderRelease: (_e, g) => {
          const r = Math.max(0, Math.min(1, startRatio.current + g.dx / trackW.current));
          dragging.current = false;
          setDragRatio(null);
          const st = usePlayerStore.getState().status;
          if (st && st.isLoaded && st.durationMillis) {
            void usePlayerStore
              .getState()
              .videoRef?.current?.setPositionAsync(Math.floor(r * st.durationMillis))
              .catch(() => {});
          }
          armHide();
        },
        onPanResponderTerminate: () => {
          dragging.current = false;
          setDragRatio(null);
          armHide();
        },
      }),
    [armHide],
  );

  const hasNext = currentEpisodeIndex < (episodes.length || 0) - 1;
  const title = `${detail?.title ?? ""}${episodes[currentEpisodeIndex]?.title ? ` - ${episodes[currentEpisodeIndex].title}` : ""}`;
  const padL = Math.max(insets.left, 12);
  const padR = Math.max(insets.right, 12);

  return (
    <>
      {/* 手势层：单击呼出/隐藏｜双击快进快退/暂停｜横划 seek｜长按倍速 */}
      <View
        style={StyleSheet.absoluteFill}
        onLayout={(e: LayoutChangeEvent) => {
          layoutW.current = Math.max(1, e.nativeEvent.layout.width);
        }}
        {...gesture.panHandlers}
      />

      {buffering && !visible && !seekPreview && !loadFailed ? (
        <View style={styles.centerHint} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
        </View>
      ) : null}

      {seekPreview ? (
        <View style={styles.centerHint} pointerEvents="none">
          <Text style={styles.hintBig}>{formatTime(seekPreview.targetMs)}</Text>
          <Text style={styles.hintSmall}>
            {seekPreview.deltaMs >= 0 ? "+" : "-"}
            {Math.round(Math.abs(seekPreview.deltaMs) / 1000)} 秒 / {formatTime(duration)}
          </Text>
        </View>
      ) : null}

      {fastHint ? (
        <View style={styles.topHint} pointerEvents="none">
          <Text style={styles.hintSmall}>{LONG_PRESS_RATE}x 倍速播放中</Text>
        </View>
      ) : null}

      {tapHint ? (
        <View style={[styles.sideHint, tapHint === "left" ? { left: 48 } : { right: 48 }]} pointerEvents="none">
          <Text style={styles.hintBig}>{tapHint === "left" ? "« 10s" : "10s »"}</Text>
        </View>
      ) : null}

      {loadFailed ? (
        <View style={styles.failBox}>
          <Text style={styles.failTitle}>播放失败</Text>
          <Text style={styles.failDesc}>所有播放源都不可用，可以重试或手动换源</Text>
          <View style={styles.failRow}>
            <TouchableOpacity style={styles.failBtn} onPress={retry} accessibilityLabel="重试">
              <Text style={styles.failBtnTxt}>重试</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.failBtn} onPress={() => setShowSourceModal(true)} accessibilityLabel="换源">
              <Text style={styles.failBtnTxt}>换源</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {visible ? (
        <>
          <View style={[styles.top, { paddingTop: Math.max(insets.top, 8), paddingLeft: padL, paddingRight: padR }]}>
            <TouchableOpacity onPress={onBack} style={styles.iconBtn} accessibilityLabel="返回">
              <ArrowLeft size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          </View>

          <View style={[styles.center, seekPreview && { opacity: 0 }]} pointerEvents={seekPreview ? "none" : "box-none"}>
            <TouchableOpacity
              style={styles.centerBtn}
              onPress={act(() => void seek(-10000))}
              accessibilityLabel="快退10秒"
            >
              <Rewind size={28} color="#fff" />
              <Text style={styles.centerTxt}>10s</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.centerBtn, styles.playBtn]}
              onPress={act(() => void togglePlayPause())}
              accessibilityLabel="播放/暂停"
            >
              {isPlaying ? <Pause size={34} color="#fff" /> : <Play size={34} color="#fff" />}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.centerBtn}
              onPress={act(() => void seek(10000))}
              accessibilityLabel="快进10秒"
            >
              <FastForward size={28} color="#fff" />
              <Text style={styles.centerTxt}>10s</Text>
            </TouchableOpacity>
          </View>

          <View
            style={[
              styles.bottom,
              { paddingBottom: Math.max(insets.bottom, 10), paddingLeft: padL, paddingRight: padR },
            ]}
          >
            <View style={styles.seekRow}>
              <Text style={styles.time}>{formatTime(dragRatio != null ? dragRatio * duration : position)}</Text>
              <View
                style={styles.trackHit}
                onLayout={(e: LayoutChangeEvent) => {
                  trackW.current = Math.max(1, e.nativeEvent.layout.width);
                }}
                {...seekPan.panHandlers}
              >
                <View style={styles.track}>
                  <View style={[styles.trackFill, { width: `${ratio * 100}%` }]} />
                </View>
                <View style={[styles.thumb, { left: `${ratio * 100}%` }]} />
              </View>
              <Text style={styles.time}>{formatTime(duration)}</Text>
            </View>

            <View style={styles.btnRow}>
              <BarBtn label="选集" onPress={act(() => setShowEpisodeModal(true))}>
                <List size={22} color="#fff" />
              </BarBtn>
              <BarBtn
                label={playbackRate !== 1 ? `${playbackRate}x` : "倍速"}
                onPress={act(() => setShowSpeedModal(true))}
              >
                <Gauge size={22} color="#fff" />
              </BarBtn>
              <BarBtn label="换源" onPress={act(() => setShowSourceModal(true))}>
                <Layers size={22} color="#fff" />
              </BarBtn>
              <BarBtn
                label="下一集"
                disabled={!hasNext}
                onPress={act(() => hasNext && playEpisode(currentEpisodeIndex + 1))}
              >
                <SkipForward size={22} color={hasNext ? "#fff" : "#666"} />
              </BarBtn>
              {isFullscreen ? (
                <BarBtn label={`比例·${ASPECT_LABEL[aspectMode]}`} onPress={act(cycleAspect)}>
                  <Proportions size={22} color="#fff" />
                </BarBtn>
              ) : null}
              <BarBtn label={isFullscreen ? "退出全屏" : "全屏"} onPress={act(onToggleFullscreen)}>
                {isFullscreen ? <Minimize size={22} color="#fff" /> : <Maximize size={22} color="#fff" />}
              </BarBtn>
            </View>
          </View>
        </>
      ) : null}
    </>
  );
}

function BarBtn({
  label,
  onPress,
  disabled,
  children,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <TouchableOpacity
      style={styles.btn}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      accessibilityLabel={label}
    >
      {children}
      <Text style={[styles.btnTxt, disabled && { color: "#666" }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  top: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 16,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "600", marginLeft: 4 },
  center: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 36,
  },
  centerBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  playBtn: { width: 72, height: 72, borderRadius: 36 },
  centerTxt: { color: "#fff", fontSize: 10, marginTop: -2 },
  bottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 14,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  seekRow: { flexDirection: "row", alignItems: "center" },
  time: { color: "#fff", fontSize: 12, width: 52, textAlign: "center" },
  trackHit: { flex: 1, height: 36, justifyContent: "center" },
  track: { height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.3)", overflow: "hidden" },
  trackFill: { height: 4, backgroundColor: "#00bb5e" },
  thumb: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
    marginLeft: -7,
    backgroundColor: "#fff",
  },
  centerHint: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  topHint: {
    position: "absolute",
    top: 72,
    alignSelf: "center",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sideHint: {
    position: "absolute",
    top: "45%",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  hintBig: { color: "#fff", fontSize: 26, fontWeight: "700", textAlign: "center" },
  hintSmall: { color: "#fff", fontSize: 13, textAlign: "center", marginTop: 2 },
  failBox: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.72)",
    paddingHorizontal: 24,
  },
  failTitle: { color: "#fff", fontSize: 20, fontWeight: "700" },
  failDesc: { color: "#B9BBC1", fontSize: 13, marginTop: 8, textAlign: "center" },
  failRow: { flexDirection: "row", gap: 16, marginTop: 20 },
  failBtn: { minWidth: 96, paddingVertical: 10, borderRadius: 8, backgroundColor: "#00bb5e", alignItems: "center" },
  failBtnTxt: { color: "#fff", fontSize: 15, fontWeight: "600" },
  btnRow: { flexDirection: "row", justifyContent: "space-around", marginTop: 4 },
  btn: { alignItems: "center", minWidth: 56, paddingVertical: 4 },
  btnTxt: { color: "#fff", fontSize: 11, marginTop: 2 },
});
