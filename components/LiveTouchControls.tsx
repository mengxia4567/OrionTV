import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, PanResponder } from "react-native";
import { ChevronUp, ChevronDown, List, Layers, Maximize, Minimize, Proportions } from "lucide-react-native";
import { useAspectStore } from "@/stores/aspectStore";
import { ASPECT_LABEL } from "@/utils/aspectMode";
import { classifySwipe, isDoubleTap, SwipeDir } from "@/utils/liveGesture";

interface Props {
  groupName: string;
  channelName: string | null;
  /** 当前源标签：主源 / 备源 N */
  sourceLabel: string;
  canSwitchSource: boolean;
  onPrevChannel: () => void;
  onNextChannel: () => void;
  onPrevGroup: () => void;
  onNextGroup: () => void;
  onOpenList: () => void;
  onOpenSource: () => void;
  onToggleFullscreen: () => void;
  isFullscreen?: boolean;
  /** 当前频道加载失败：居中显示「重试」 */
  failed?: boolean;
  onRetry?: () => void;
}

const AUTO_HIDE_MS = 3000;
const LONG_PRESS_MS = 520;
const HINT_MS = 4500;

/**
 * 手机 / 平板直播触控层（对标主流直播 App 的惯例）：
 *   上下滑 = 切台（上滑下一台 / 下滑上一台）｜左右滑 = 切分组
 *   单击 = 呼出/隐藏控制条｜双击 = 全屏｜长按 = 频道列表
 *   底部迷你遥控条：上一台 / 下一台 / 频道列表 / 切源 / 全屏（3 秒无操作自动隐藏）
 */
export default function LiveTouchControls(props: Props) {
  const [visible, setVisible] = useState(false);
  const [hint, setHint] = useState(true);
  const aspectMode = useAspectStore((s) => s.mode);
  const cycleAspect = useAspectStore((s) => s.cycle);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapAt = useRef<number | null>(null);
  const longFired = useRef(false);
  /** 手势回调里读最新的 props，避免 PanResponder 闭包过期 */
  const propsRef = useRef(props);
  propsRef.current = props;

  const armAutoHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), AUTO_HIDE_MS);
  }, []);

  const showBar = useCallback(() => {
    setVisible(true);
    armAutoHide();
  }, [armAutoHide]);

  useEffect(() => {
    const t = setTimeout(() => setHint(false), HINT_MS);
    return () => {
      clearTimeout(t);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (tapTimer.current) clearTimeout(tapTimer.current);
      if (longTimer.current) clearTimeout(longTimer.current);
    };
  }, []);

  const handleSwipe = useCallback((dir: SwipeDir) => {
    const p = propsRef.current;
    setHint(false);
    if (dir === "up") p.onNextChannel();
    else if (dir === "down") p.onPrevChannel();
    else if (dir === "left") p.onNextGroup();
    else p.onPrevGroup();
  }, []);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          longFired.current = false;
          if (longTimer.current) clearTimeout(longTimer.current);
          longTimer.current = setTimeout(() => {
            longFired.current = true;
            propsRef.current.onOpenList();
          }, LONG_PRESS_MS);
        },
        onPanResponderMove: (_e, g) => {
          // 一旦明显移动，取消长按
          if (Math.abs(g.dx) > 10 || Math.abs(g.dy) > 10) {
            if (longTimer.current) clearTimeout(longTimer.current);
          }
        },
        onPanResponderRelease: (_e, g) => {
          if (longTimer.current) clearTimeout(longTimer.current);
          if (longFired.current) return;
          const dir = classifySwipe(g.dx, g.dy);
          if (dir) {
            handleSwipe(dir);
            return;
          }
          // 点按：双击 = 全屏；单击 = 呼出/隐藏控制条（延迟判定以区分双击）
          const now = Date.now();
          if (isDoubleTap(lastTapAt.current, now)) {
            lastTapAt.current = null;
            if (tapTimer.current) clearTimeout(tapTimer.current);
            propsRef.current.onToggleFullscreen();
            return;
          }
          lastTapAt.current = now;
          if (tapTimer.current) clearTimeout(tapTimer.current);
          tapTimer.current = setTimeout(() => {
            lastTapAt.current = null;
            setVisible((v) => {
              if (v) {
                if (hideTimer.current) clearTimeout(hideTimer.current);
                return false;
              }
              armAutoHide();
              return true;
            });
          }, 290);
        },
        onPanResponderTerminate: () => {
          if (longTimer.current) clearTimeout(longTimer.current);
        },
      }),
    [armAutoHide, handleSwipe],
  );

  /** 点控制条上的按钮：执行动作并重置自动隐藏计时 */
  const act = (fn: () => void) => () => {
    fn();
    showBar();
  };

  return (
    <>
      {/* 手势层：覆盖画面，位于控制条之下 */}
      <View style={StyleSheet.absoluteFill} {...pan.panHandlers} />

      {props.failed ? (
        <View style={styles.retryWrap} pointerEvents="box-none">
          <TouchableOpacity style={styles.retryBtn} onPress={props.onRetry} accessibilityLabel="重试">
            <Text style={styles.retryText}>重试</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {hint ? (
        <View style={styles.hint} pointerEvents="none">
          <Text style={styles.hintText}>上下滑切台 · 左右滑切分组 · 长按选频道 · 双击全屏</Text>
        </View>
      ) : null}

      {visible ? (
        <View style={styles.bar}>
          <Text style={styles.barTitle} numberOfLines={1}>
            {props.groupName ? `${props.groupName} · ` : ""}
            {props.channelName ?? ""}
          </Text>
          <View style={styles.row}>
            <BarBtn onPress={act(props.onPrevChannel)} label="上一台">
              <ChevronDown size={22} color="#fff" />
            </BarBtn>
            <BarBtn onPress={act(props.onNextChannel)} label="下一台">
              <ChevronUp size={22} color="#fff" />
            </BarBtn>
            <BarBtn onPress={act(props.onOpenList)} label="频道">
              <List size={22} color="#fff" />
            </BarBtn>
            {props.canSwitchSource ? (
              <BarBtn onPress={act(props.onOpenSource)} label={props.sourceLabel}>
                <Layers size={22} color="#fff" />
              </BarBtn>
            ) : null}
            {props.isFullscreen ? (
              <BarBtn onPress={act(cycleAspect)} label={`比例·${ASPECT_LABEL[aspectMode]}`}>
                <Proportions size={22} color="#fff" />
              </BarBtn>
            ) : null}
            <BarBtn onPress={act(props.onToggleFullscreen)} label={props.isFullscreen ? "退出全屏" : "全屏"}>
              {props.isFullscreen ? <Minimize size={22} color="#fff" /> : <Maximize size={22} color="#fff" />}
            </BarBtn>
          </View>
        </View>
      ) : null}
    </>
  );
}

function BarBtn({ onPress, label, children }: { onPress: () => void; label: string; children: React.ReactNode }) {
  return (
    <TouchableOpacity style={styles.btn} onPress={onPress} activeOpacity={0.7} accessibilityLabel={label}>
      {children}
      <Text style={styles.btnText} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: "rgba(0,0,0,0.62)",
  },
  barTitle: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 6,
    opacity: 0.9,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },
  btn: {
    minWidth: 56,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  btnText: {
    color: "#fff",
    fontSize: 11,
    marginTop: 2,
  },
  retryWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 96,
  },
  retryBtn: { minWidth: 120, paddingVertical: 10, borderRadius: 8, backgroundColor: "#00bb5e", alignItems: "center" },
  retryText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  hint: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 20,
    alignItems: "center",
  },
  hintText: {
    color: "#fff",
    fontSize: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.55)",
    overflow: "hidden",
  },
});
