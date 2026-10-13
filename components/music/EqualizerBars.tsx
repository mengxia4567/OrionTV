import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { barTarget, barDuration, BAR_MIN } from "@/utils/equalizer";

interface Props {
  playing: boolean;
  /** 整体宽度（条会均匀分布） */
  width: number;
  /** 条数（奇数更对称） */
  count?: number;
  /** 条的最大高度 */
  height?: number;
  color?: string;
}

/**
 * 装饰性波谱条（**不是真实频谱**：expo-av 不暴露音频 FFT）。
 * 播放时各条独立起伏；暂停时平滑收到最低。用 scaleY + native driver，不占 JS 线程。
 */
export default function EqualizerBars({
  playing,
  width,
  count = 9,
  height = 22,
  color = "#1DB954",
}: Props) {
  const vals = useMemo(() => Array.from({ length: count }, () => new Animated.Value(BAR_MIN)), [count]);
  const last = useRef<number[]>(Array.from({ length: count }, () => BAR_MIN));

  useEffect(() => {
    let alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const pulse = (i: number) => {
      if (!alive) return;
      const to = barTarget({ index: i, count, prev: last.current[i] });
      last.current[i] = to;
      Animated.timing(vals[i], {
        toValue: to,
        duration: barDuration(),
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (alive && finished) pulse(i);
      });
    };

    if (playing) {
      // 错开启动，避免各条同步起跳
      vals.forEach((_, i) => {
        timers.push(setTimeout(() => pulse(i), i * 70));
      });
    } else {
      vals.forEach((v, i) => {
        last.current[i] = BAR_MIN;
        Animated.timing(v, { toValue: BAR_MIN, duration: 260, useNativeDriver: true }).start();
      });
    }

    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      vals.forEach((v) => v.stopAnimation());
    };
  }, [playing, vals, count]);

  // 细柱：宽度固定 4~5px，整体居中（之前按 width/count 算，条比高还宽，看起来像一排椭圆点）
  const barW = width / count > 14 ? 5 : 4;
  const gap = Math.max(4, Math.floor((width - barW * count) / Math.max(1, count - 1)));

  return (
    <View style={[styles.row, { width, height }]} pointerEvents="none">
      {vals.map((v, i) => (
        <Animated.View
          key={i}
          style={{
            width: barW,
            height,
            marginRight: i === count - 1 ? 0 : gap,
            borderRadius: barW / 2,
            backgroundColor: color,
            opacity: 0.85,
            // 以底边为基准缩放：scaleY 默认绕中心，用位移补偿到底部对齐
            transform: [
              { translateY: height / 2 },
              { scaleY: v },
              { translateY: -height / 2 },
            ],
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
  },
});
