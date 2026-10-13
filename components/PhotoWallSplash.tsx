/**
 * PhotoWallSplash — 开机动画「照片墙」v3.1（登录态决策 + 竖屏适配）
 *
 * 启动决策：
 *   设置里已配置服务器地址 + 已登录（有登录令牌）
 *     → 拉取服务器照片集（带令牌，超时 7s，增量下载）→ 播放照片墙（四模式随机）
 *   否则（未配置 / 未登录 / 拉不到且无缓存）→ 回退熊猫动画（PandaSplash）
 *
 * 防白屏：
 *   - native splash 保持到本组件首帧渲染后（_layout 不再提前 hide，见部署脚本）
 *   - 本组件所有阶段（BootFrame / WallScene / PandaSplash）均为全屏黑底
 *
 * 四个模式，启动时随机抽一个：
 *   A 汇聚星河 / B 拼字熊猫 / C 派对墙 / D 全餐
 *
 * v3.1（2026-10-11）竖屏适配：
 *   - 网格方向自适应：横屏 16×9，竖屏 9×16（格子保持近似方形，杜绝细长条变形）
 *   - 熊猫遮罩按实际网格动态计算（PandaMask 增加宽度约束）
 *   - 跳过提示按平台显示（TV「按确认键跳过」/ 触屏「轻触跳过」）；词标字号竖屏重算
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  ImageSourcePropType,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import * as SplashScreen from "expo-splash-screen";
import { resolveWall } from "@/services/wallPhotos";
import PandaSplash from "@/components/PandaSplash";
import { computePandaMask } from "./PandaMask";
import { computeZoomRect, gridForDevice, pickZoomTargets } from "./PhotoWallGrid";

/* ================= 常量 ================= */
/** 网格总格数固定 144（16×9 或 9×16）；方向按屏幕纵横比自适应 */
const PAD = 6;
const GAP = 4;
const BG = "#0B0B0C";
const CREAM = "#F4EFE6";
const CORAL = "#FF6B4A";

const EASE_OUT = Easing.bezier(0.19, 1.03, 0.3, 1);
const EASE_POP = Easing.bezier(0.22, 1.35, 0.36, 1);
const EASE_MORPH = Easing.bezier(0.35, 0.9, 0.3, 1);

export type SplashMode = "A" | "B" | "C" | "D";
export const SPLASH_MODES: SplashMode[] = ["A", "B", "C", "D"];

/** 跳过提示：TV 遥控器 vs 触屏（手机/平板） */
const SKIP_HINT = Platform.isTV ? "按确认键跳过" : "轻触跳过";

/** 熊猫回退原因（小字提示，便于电视端定位问题） */
const REASON_TEXT: Record<string, string> = {
  "not-configured": "照片墙未启用：未配置服务器地址",
  "not-logged-in": "照片墙未启用：未登录",
  "auth-401": "照片墙未启用：登录已过期（认证失败）",
  timeout: "照片墙未启用：获取超时 / 网络异常",
  empty: "照片墙未启用：服务器暂无照片",
  "fetch-failed": "照片墙未启用：获取照片失败",
};

/* 熊猫遮罩见 ./PandaMask（独立纯函数模块，便于组件与单测共用） */

/* ================= 场景构建 ================= */
/** Reanimated 的 Easing.bezier 返回的是「缓动工厂」，withTiming 直接接受 */
type EaseFactory = ReturnType<typeof Easing.bezier>;

interface TileConfig {
  x: number;
  y: number;
  w: number;
  h: number;
  source: ImageSourcePropType;
  durIn: number;
  easeIn: EaseFactory;
  delayIn: number;
  fx: number;
  fy: number;
  fRot: number;
  fScale: number;
  /** -1 = 无拼图阶段; 0 = 暗格; 1 = 亮格; 2 = 暗洞 */
  morph: number;
  morphDelay: number;
  /** <0 = 无 */
  waveDelay: number;
  spinDelay: number;
  popAt: number;
  /** 1 = 右眼斑（眨眼响应） */
  wink: 0 | 1;
}

interface Scene {
  tiles: TileConfig[];
  over: number;
  wm: { size: number; baseY: number };
  drift: { tx: number; rot: number; sc: number };
}

function shuffleIdx(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 循环填充照片到目标格数：每轮重洗，跨轮避免相邻重复 */
function assignPhotos(photos: ImageSourcePropType[], n: number): ImageSourcePropType[] {
  const out: ImageSourcePropType[] = [];
  if (!photos || photos.length === 0) return out;
  let pool: ImageSourcePropType[] = [];
  while (out.length < n) {
    if (pool.length === 0) pool = shuffleIdx(photos.length).map((i) => photos[i]);
    const last = out[out.length - 1];
    if (out.length > 0 && pool[0] === last && pool.length > 1) {
      [pool[0], pool[1]] = [pool[1], pool[0]];
    }
    out.push(pool.shift() as ImageSourcePropType);
  }
  return out;
}

/** 与 assignPhotos 同口径，但只返回「照片序号」（放大需要知道每格对应哪张照片） */
function assignPhotoIdx(photoCount: number, n: number): number[] {
  const out: number[] = [];
  if (photoCount <= 0) return out;
  let pool: number[] = [];
  while (out.length < n) {
    if (pool.length === 0) pool = shuffleIdx(photoCount);
    if (out.length > 0 && pool[0] === out[out.length - 1] && pool.length > 1) {
      [pool[0], pool[1]] = [pool[1], pool[0]];
    }
    out.push(pool.shift() as number);
  }
  return out;
}

function buildScene(
  mode: SplashMode,
  width: number,
  height: number,
  photos: ImageSourcePropType[],
  deviceType: 'tv' | 'tablet' | 'mobile' = 'tv'
): Scene {
  // 密度按「设备 + 朝向」分档：手机/平板降格数，避免小屏上格子过密
  const portrait = height > width;
  const grid = gridForDevice(deviceType, portrait);
  const cols = grid.cols;
  const rows = grid.rows;
  const n = cols * rows;
  const tileW = (width - PAD * 2 - GAP * (cols - 1)) / cols;
  const tileH = (height - PAD * 2 - GAP * (rows - 1)) / rows;
  const k = width / 960; // 距离随屏宽缩放
  const sources = assignPhotos(photos, n);
  const mask = mode === "B" || mode === "D" ? computePandaMask(cols, rows) : null;
  const rand = (a: number, b: number) => a + Math.random() * (b - a);

  const spinPicks = new Set<number>();
  if (mode === "C") {
    shuffleIdx(n).slice(0, 16).forEach((i) => spinPicks.add(i));
  }
  const popPicks = new Set<number>();
  if (mode === "A") {
    shuffleIdx(n).slice(0, 8).forEach((i) => popPicks.add(i));
  }

  const ccx = (cols - 1) / 2; // 网格中心（列方向）
  const ccy = (rows - 1) / 2; // 网格中心（行方向）
  const tiles: TileConfig[] = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = (i / cols) | 0;
    const cfg: TileConfig = {
      x: PAD + c * (tileW + GAP),
      y: PAD + r * (tileH + GAP),
      w: tileW,
      h: tileH,
      source: sources[i],
      durIn: 560,
      easeIn: EASE_OUT,
      delayIn: 0,
      fx: 0,
      fy: 0,
      fRot: 0,
      fScale: 1,
      morph: -1,
      morphDelay: 0,
      waveDelay: -1,
      spinDelay: -1,
      popAt: -1,
      wink: 0,
    };

    if (mode === "A" || mode === "D") {
      const ang = Math.atan2(r - ccy, c - ccx) + rand(-0.3, 0.3);
      const dist = (760 + Math.random() * 520) * k;
      cfg.fx = Math.cos(ang) * dist;
      cfg.fy = Math.sin(ang) * dist * 0.72;
      cfg.fRot = rand(-22, 22);
      cfg.fScale = rand(1.25, 1.75);
      cfg.durIn = mode === "A" ? 560 : 520;
      cfg.delayIn =
        30 + Math.hypot(c - ccx, r - ccy) * 44 + Math.random() * (mode === "A" ? 180 : 150);
    } else if (mode === "B") {
      cfg.fScale = rand(0.5, 0.62);
      cfg.fRot = rand(-15, 15);
      cfg.durIn = 460;
      cfg.delayIn = Math.random() * 560;
      cfg.easeIn = Easing.bezier(0.2, 1.06, 0.35, 1);
    } else {
      cfg.fScale = 0.15;
      cfg.fRot = rand(-28, 28);
      cfg.durIn = 420;
      cfg.delayIn = Math.random() * 820;
      cfg.easeIn = EASE_POP;
    }

    if (mask) {
      const v = mask[r][c];
      cfg.morph = v;
      cfg.wink = v === 2 && c >= cols * 0.56 ? 1 : 0;
    }
    if (mode === "C") {
      cfg.waveDelay = 1150 + c * 24 + r * 36;
      if (spinPicks.has(i)) cfg.spinDelay = 1700 + Math.random() * 700;
    }
    tiles.push(cfg);
  }

  const lastIn = Math.max(...tiles.map((t) => t.delayIn));
  const over =
    lastIn +
    (mode === "A" ? 560 : mode === "D" ? 520 : mode === "B" ? 460 : 420);

  // 拼图（morph）起点：B 固定 1000ms；D 在飞入结束后 260ms（绝对时间）
  if (mask) {
    const morphBase = mode === "B" ? 1000 : over + 260;
    for (let i = 0; i < n; i++) {
      const c = i % cols;
      const r = (i / cols) | 0;
      tiles[i].morphDelay = morphBase + (c + r) * 7;
    }
  }
  if (mode === "A") {
    let popSeq = 0;
    popPicks.forEach((i) => {
      tiles[i].popAt = over + 220 + popSeq * 190 + Math.random() * 80;
      popSeq += 1;
    });
  }

  // 词标字号：竖屏按屏宽重算（避免过小），横屏沿用旧系数
  const wmSize = portrait
    ? Math.max(24, width * 0.072)
    : width * (mode === "B" || mode === "D" ? 0.04 : 0.048);
  const wmCenterY = mode === "B" || mode === "D" ? height * 0.9 : height * 0.5;
  const wmBaseY = wmCenterY - height * 0.5 - wmSize * 0.65;
  const drift =
    mode === "A"
      ? { tx: -10 * k, rot: 0.7, sc: 0.035 }
      : mode === "C"
        ? { tx: 0, rot: 0, sc: 0.04 }
        : { tx: 0, rot: 0, sc: 0 };
  return { tiles, over, wm: { size: wmSize, baseY: wmBaseY }, drift };
}

/* ================= 单格 ================= */
interface TileProps {
  cfg: TileConfig;
  winkVal: SharedValue<number>;
}

const Tile = React.memo(function Tile({ cfg, winkVal }: TileProps) {
  const t = useSharedValue(0);
  const m = useSharedValue(0);
  const wv = useSharedValue(0);
  const sp = useSharedValue(0);
  const pv = useSharedValue(0);

  useEffect(() => {
    t.value = withDelay(
      cfg.delayIn,
      withTiming(1, { duration: cfg.durIn, easing: cfg.easeIn })
    );
    if (cfg.morph >= 0) {
      m.value = withDelay(
        cfg.morphDelay,
        withTiming(1, { duration: 520, easing: EASE_MORPH })
      );
    }
    if (cfg.waveDelay >= 0) {
      wv.value = withDelay(
        cfg.waveDelay,
        withSequence(
          withTiming(1, { duration: 170, easing: Easing.out(Easing.quad) }),
          withDelay(190, withTiming(0, { duration: 220, easing: Easing.inOut(Easing.quad) }))
        )
      );
    }
    if (cfg.spinDelay >= 0) {
      sp.value = withDelay(
        cfg.spinDelay,
        withTiming(360, { duration: 620, easing: Easing.inOut(Easing.quad) })
      );
    }
    if (cfg.popAt >= 0) {
      pv.value = withDelay(
        cfg.popAt,
        withSequence(
          withTiming(1, { duration: 150, easing: Easing.out(Easing.quad) }),
          withDelay(90, withTiming(0, { duration: 240 }))
        )
      );
    }
    // 只在挂载时启动动画（cfg 为一次性场景配置，父级以 key=mode 强制重建）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bodyStyle = useAnimatedStyle(() => {
    const p = t.value;
    const mm = m.value;
    const translateX = interpolate(p, [0, 1], [cfg.fx, 0]);
    const translateY = interpolate(p, [0, 1], [cfg.fy, 0]);
    const rotate = interpolate(p, [0, 1], [cfg.fRot, 0]) + wv.value * 6;
    let scale = interpolate(p, [0, 1], [cfg.fScale, 1]);
    let opacity = p;
    if (cfg.morph === 0) {
      scale *= interpolate(mm, [0, 1], [1, 0.94]);
      opacity *= interpolate(mm, [0, 1], [1, 0.08]);
    } else if (cfg.morph === 1) {
      scale *= interpolate(mm, [0, 1], [1, 1.045]);
    } else if (cfg.morph === 2) {
      scale *= interpolate(mm, [0, 1], [1, 0.9]);
      opacity *= interpolate(mm, [0, 1], [1, 0.92]);
    }
    scale *= 1 + wv.value * 0.06;
    scale *= interpolate(sp.value, [0, 180, 360], [1, 0.92, 1]);
    scale *= 1 + pv.value * 0.13;
    if (cfg.wink === 1) scale *= 1 + winkVal.value * 0.1;
    return {
      opacity,
      transform: [
        { perspective: 900 },
        { translateX },
        { translateY },
        { rotate: `${rotate}deg` },
        { rotateY: `${sp.value}deg` },
        { scale },
      ],
    };
  });

  const brightStyle = useAnimatedStyle(() => ({
    opacity: cfg.morph === 1 ? m.value * 0.07 : 0,
  }));

  const darkStyle = useAnimatedStyle(() => {
    if (cfg.morph !== 2) return { opacity: 0 };
    const w = cfg.wink === 1 ? winkVal.value : 0;
    return { opacity: m.value * 0.85 * (1 - w * 0.92) };
  });

  return (
    <Animated.View
      style={[
        styles.tile,
        {
          left: cfg.x,
          top: cfg.y,
          width: cfg.w,
          height: cfg.h,
          borderRadius: Math.max(6, cfg.w * 0.07),
        },
        cfg.morph === 1 ? styles.litRing : null,
        bodyStyle,
      ]}
    >
      <Image source={cfg.source} style={styles.fill} resizeMode="cover" fadeDuration={0} />
      {cfg.morph === 1 ? (
        <Animated.View pointerEvents="none" style={[styles.fill, styles.bright, brightStyle]} />
      ) : null}
      {cfg.morph === 2 ? (
        <Animated.View pointerEvents="none" style={[styles.fill, styles.dark, darkStyle]} />
      ) : null}
    </Animated.View>
  );
});

/* ================= 照片墙场景（四模式） ================= */
interface WallSceneProps {
  mode: SplashMode;
  sources: ImageSourcePropType[];
  onDone: () => void;
  /** 设备档位（决定网格密度；手机/平板降格数，避免小框框过密） */
  deviceType: 'tv' | 'tablet' | 'mobile';
}

function WallScene({ mode, sources, onDone, deviceType }: WallSceneProps) {
  const { width, height } = useWindowDimensions();
  const scene = useMemo(
    () => buildScene(mode, width, height, sources, deviceType),
    [mode, width, height, sources, deviceType]
  );
  const winkVal = useSharedValue(0);
  const fade = useSharedValue(0);
  const wp = useSharedValue(0);
  const drift = useSharedValue(0);
  const doneRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  }, [onDone]);

  useEffect(() => {
    const s = scene;
    if (mode === "A") {
      drift.value = withDelay(
        s.over + 120,
        withTiming(1, { duration: 1900, easing: Easing.inOut(Easing.quad) })
      );
      wp.value = withDelay(s.over + 3000, withTiming(1, { duration: 560, easing: EASE_OUT }));
      fade.value = withDelay(
        s.over + 4500,
        withTiming(1, { duration: 420, easing: Easing.in(Easing.quad) }, (f) => {
          if (f) {
            runOnJS(finish)();
          }
        })
      );
    } else if (mode === "B") {
      winkVal.value = withDelay(
        2850,
        withSequence(
          withTiming(1, { duration: 140, easing: Easing.out(Easing.quad) }),
          withDelay(180, withTiming(0, { duration: 260 }))
        )
      );
      wp.value = withDelay(3300, withTiming(1, { duration: 560, easing: EASE_OUT }));
      fade.value = withDelay(
        5150,
        withTiming(1, { duration: 420, easing: Easing.in(Easing.quad) }, (f) => {
          if (f) {
            runOnJS(finish)();
          }
        })
      );
    } else if (mode === "C") {
      drift.value = withDelay(
        2500,
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) })
      );
      wp.value = withDelay(3650, withTiming(1, { duration: 560, easing: EASE_OUT }));
      fade.value = withDelay(
        5450,
        withTiming(1, { duration: 420, easing: Easing.in(Easing.quad) }, (f) => {
          if (f) {
            runOnJS(finish)();
          }
        })
      );
    } else {
      winkVal.value = withDelay(
        s.over + 2150,
        withSequence(
          withTiming(1, { duration: 140, easing: Easing.out(Easing.quad) }),
          withDelay(180, withTiming(0, { duration: 260 }))
        )
      );
      wp.value = withDelay(s.over + 3000, withTiming(1, { duration: 560, easing: EASE_OUT }));
      fade.value = withDelay(
        s.over + 4500,
        withTiming(1, { duration: 420, easing: Easing.in(Easing.quad) }, (f) => {
          if (f) {
            runOnJS(finish)();
          }
        })
      );
    }
    // 兜底：异常情况下 9 秒强制结束，绝不卡死入口
    const guard = setTimeout(finish, 15000);
    return () => clearTimeout(guard);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const skip = useCallback(() => {
    if (doneRef.current) return;
    wp.value = withTiming(1, { duration: 140 });
    fade.value = withTiming(1, { duration: 220, easing: Easing.in(Easing.quad) }, (f) => {
      if (f) {
        runOnJS(finish)();
      }
    });
  }, [fade, finish, wp]);

  const wallStyle = useAnimatedStyle(() => ({
    opacity: interpolate(fade.value, [0, 1], [1, 0]),
    transform: [
      { translateX: drift.value * scene.drift.tx },
      { rotate: `${drift.value * scene.drift.rot}deg` },
      { scale: 1 + drift.value * scene.drift.sc + fade.value * 0.02 },
    ],
  }));

  const wmStyle = useAnimatedStyle(() => ({
    opacity: wp.value,
    transform: [
      { translateY: scene.wm.baseY + interpolate(wp.value, [0, 1], [16, 0]) },
      { scale: interpolate(wp.value, [0, 1], [0.94, 1]) },
    ],
  }));

  const hintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(fade.value, [0, 0.6, 1], [0.35, 0.35, 0]),
  }));

  if (scene.tiles.length === 0) {
    return null;
  }

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root]}>
      <Animated.View style={[StyleSheet.absoluteFill, wallStyle]} pointerEvents="none">
        {scene.tiles.map((cfg, i) => (
          <Tile key={i} cfg={cfg} winkVal={winkVal} />
        ))}
      </Animated.View>
      <Animated.Text
        style={[
          styles.wordmark,
          { fontSize: scene.wm.size, letterSpacing: scene.wm.size * 0.14 },
          wmStyle,
        ]}
      >
        福宝观影
        <Text style={styles.dot}> ·</Text>
      </Animated.Text>
      <Animated.Text style={[styles.hint, hintStyle]}>{SKIP_HINT}</Animated.Text>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={skip}
        focusable
        {...(Platform.isTV ? { hasTVPreferredFocus: true } : {})}
      />
    </Animated.View>
  );
}

/* ================= 手机/平板：网格 + 定时放大某张（B1） ================= */
/** 一次放大的节奏（毫秒）：飞入 → 停留 → 收回 */
const ZOOM_IN_MS = 480;
const ZOOM_HOLD_MS = 1250;
const ZOOM_OUT_MS = 380;
const ZOOM_TOTAL_MS = ZOOM_IN_MS + ZOOM_HOLD_MS + ZOOM_OUT_MS;
const ZOOM_COUNT = 2;
/** 网格铺满后第一张放大的起点 / 两张之间的间隔 */
const ZOOM_START_MS = 1500;
const ZOOM_GAP_MS = 350;

type Rect = { x: number; y: number; w: number; h: number };

interface ZoomPlan {
  /** 被放大的格子下标 */
  tile: number;
  /** 本次放大开始时间（相对场景起点） */
  at: number;
  large: ImageSourcePropType;
}

/** 单个小格：按网格波浪淡入 */
const GridTile = React.memo(function GridTile({
  rect,
  source,
  delay,
  hidden,
}: {
  rect: Rect;
  source: ImageSourcePropType;
  delay: number;
  /** 正在被放大的那一格：原位隐藏，避免和飞出的大图重影 */
  hidden: boolean;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withTiming(1, { duration: 520, easing: EASE_OUT }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: hidden ? 0 : t.value,
    transform: [{ scale: interpolate(t.value, [0, 1], [0.86, 1]) }],
  }));
  return (
    <Animated.View
      style={[
        styles.tile,
        {
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
          borderRadius: Math.max(8, rect.w * 0.08),
        },
        style,
      ]}
    >
      <Image source={source} style={styles.fill} resizeMode="cover" fadeDuration={0} />
    </Animated.View>
  );
});

/** 放大层：从被选格子的位置/尺寸飞到屏幕中央按原比例的大图，停留后收回 */
const ZoomLayer = React.memo(function ZoomLayer({
  from,
  to,
  source,
  onEnd,
}: {
  from: Rect;
  to: Rect;
  source: ImageSourcePropType;
  onEnd: () => void;
}) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withSequence(
      withTiming(1, { duration: ZOOM_IN_MS, easing: EASE_OUT }),
      withDelay(
        ZOOM_HOLD_MS,
        withTiming(0, { duration: ZOOM_OUT_MS, easing: Easing.inOut(Easing.quad) }, (f) => {
          if (f) runOnJS(onEnd)();
        })
      )
    );
    // 单次挂载播放一轮
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => {
    const v = p.value;
    return {
      left: interpolate(v, [0, 1], [from.x, to.x]),
      top: interpolate(v, [0, 1], [from.y, to.y]),
      width: interpolate(v, [0, 1], [from.w, to.w]),
      height: interpolate(v, [0, 1], [from.h, to.h]),
      opacity: interpolate(v, [0, 0.08, 1], [0, 1, 1]),
      borderRadius: interpolate(v, [0, 1], [Math.max(8, from.w * 0.08), 18]),
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.zoom, style]}>
      <Image source={source} style={styles.fill} resizeMode="cover" fadeDuration={0} />
    </Animated.View>
  );
});

function GridZoomScene({
  sources,
  larges,
  onDone,
  deviceType,
}: {
  sources: ImageSourcePropType[];
  larges: (ImageSourcePropType | null)[];
  onDone: () => void;
  deviceType: "tablet" | "mobile";
}) {
  const { width, height } = useWindowDimensions();
  const portrait = height > width;
  const { cols, rows } = gridForDevice(deviceType, portrait);
  const n = cols * rows;
  const doneRef = useRef(false);
  const fade = useSharedValue(0);
  const wp = useSharedValue(0);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  }, [onDone]);

  const layout = useMemo(() => {
    const tileW = (width - PAD * 2 - GAP * (cols - 1)) / cols;
    const tileH = (height - PAD * 2 - GAP * (rows - 1)) / rows;
    const photoOf = assignPhotoIdx(sources.length, n);
    const tiles = Array.from({ length: n }, (_, i) => {
      const c = i % cols;
      const r = (i / cols) | 0;
      return {
        rect: {
          x: PAD + c * (tileW + GAP),
          y: PAD + r * (tileH + GAP),
          w: tileW,
          h: tileH,
        },
        photo: photoOf[i],
        delay: 40 + (c + r) * 70 + Math.random() * 90,
      };
    });
    // 只从有大图的格子里选（没有大图就不放大，避免放大缩略图发糊）
    const picks = pickZoomTargets(
      photoOf,
      photoOf.map((pi) => larges[pi] != null),
      ZOOM_COUNT
    );
    const plans: ZoomPlan[] = picks.map((tile, k) => ({
      tile,
      at: ZOOM_START_MS + k * (ZOOM_TOTAL_MS + ZOOM_GAP_MS),
      large: larges[tiles[tile].photo] as ImageSourcePropType,
    }));
    return { tiles, plans };
  }, [width, height, cols, rows, n, sources, larges]);

  // 取大图真实宽高 → 按原比例放大（取到之前用方形兜底）
  const [sizes, setSizes] = useState<Record<number, { w: number; h: number }>>({});
  useEffect(() => {
    let alive = true;
    layout.plans.forEach((pl) => {
      const uri = (pl.large as { uri?: string }).uri;
      if (!uri) return;
      Image.getSize(
        uri,
        (iw, ih) => {
          if (alive) setSizes((m) => ({ ...m, [pl.tile]: { w: iw, h: ih } }));
        },
        () => undefined
      );
    });
    return () => {
      alive = false;
    };
  }, [layout]);

  // 时间线：依次放大 → 词标 → 淡出结束。current：-1 未开始 / k 第 k 次放大中 / -2 放大间隙
  const [current, setCurrent] = useState(-1);
  useEffect(() => {
    const plans = layout.plans;
    const timers: ReturnType<typeof setTimeout>[] = [];
    plans.forEach((pl, k) => timers.push(setTimeout(() => setCurrent(k), pl.at)));
    const lastEnd = plans.length > 0 ? plans[plans.length - 1].at + ZOOM_TOTAL_MS : ZOOM_START_MS;
    const wmAt = lastEnd + 120;
    timers.push(
      setTimeout(() => {
        wp.value = withTiming(1, { duration: 520, easing: EASE_OUT });
      }, wmAt)
    );
    timers.push(
      setTimeout(() => {
        fade.value = withTiming(1, { duration: 420, easing: Easing.in(Easing.quad) }, (f) => {
          if (f) runOnJS(finish)();
        });
      }, wmAt + 1500)
    );
    timers.push(setTimeout(finish, 15000)); // 兜底：绝不卡死入口
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const skip = useCallback(() => {
    if (doneRef.current) return;
    wp.value = withTiming(1, { duration: 140 });
    fade.value = withTiming(1, { duration: 220, easing: Easing.in(Easing.quad) }, (f) => {
      if (f) runOnJS(finish)();
    });
  }, [fade, finish, wp]);

  const wallStyle = useAnimatedStyle(() => ({ opacity: interpolate(fade.value, [0, 1], [1, 0]) }));
  const wmSize = Math.max(26, width * (portrait ? 0.08 : 0.05));
  const wmStyle = useAnimatedStyle(() => ({
    opacity: wp.value,
    transform: [{ translateY: interpolate(wp.value, [0, 1], [14, 0]) }],
  }));
  const hintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(fade.value, [0, 0.6, 1], [0.35, 0.35, 0]),
  }));

  const activePlan = current >= 0 && current < layout.plans.length ? layout.plans[current] : null;
  const activeFrom = activePlan ? layout.tiles[activePlan.tile].rect : null;
  const activeTo = activePlan
    ? computeZoomRect(
        width,
        height,
        sizes[activePlan.tile]?.w ?? 1,
        sizes[activePlan.tile]?.h ?? 1
      )
    : null;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root]}>
      <Animated.View style={[StyleSheet.absoluteFill, wallStyle]} pointerEvents="none">
        {layout.tiles.map((t, i) => (
          <GridTile
            key={i}
            rect={t.rect}
            source={sources[t.photo]}
            delay={t.delay}
            hidden={activePlan?.tile === i}
          />
        ))}
        {activePlan && activeFrom && activeTo ? (
          <ZoomLayer
            key={current}
            from={activeFrom}
            to={activeTo}
            source={activePlan.large}
            onEnd={() => setCurrent(-2)}
          />
        ) : null}
      </Animated.View>
      <Animated.Text
        style={[styles.gridWordmark, { fontSize: wmSize, letterSpacing: wmSize * 0.14 }, wmStyle]}
      >
        福宝观影
        <Text style={styles.dot}> ·</Text>
      </Animated.Text>
      <Animated.Text style={[styles.hint, hintStyle]}>{SKIP_HINT}</Animated.Text>
      <Pressable style={StyleSheet.absoluteFill} onPress={skip} focusable />
    </Animated.View>
  );
}

/* ================= 等待帧（黑底静态，与 native splash 视觉连续） ================= */
function BootFrame({ onSkip }: { onSkip?: () => void }) {
  const { width } = useWindowDimensions();
  const logoSize = Math.max(140, Math.min(220, width * 0.52));
  return (
    <View style={[StyleSheet.absoluteFill, styles.root, styles.boot]}>
      <Image
        source={require("../assets/images/splash-logo.png")}
        style={[styles.bootLogo, { width: logoSize, height: logoSize }]}
        resizeMode="contain"
      />
      <Text style={styles.bootText}>正在准备照片…</Text>
      <Text style={styles.bootHint}>{SKIP_HINT}</Text>
      {onSkip ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onSkip}
          focusable
          {...(Platform.isTV ? { hasTVPreferredFocus: true } : {})}
        />
      ) : null}
    </View>
  );
}

/* ================= 决策层 ================= */
type Boot =
  | { kind: "loading" }
  | { kind: "panda"; reason?: string }
  | {
      kind: "wall";
      sources: ImageSourcePropType[];
      larges: (ImageSourcePropType | null)[];
    };

export default function PhotoWallSplash({ onDone }: { onDone: () => void }) {
  const mode = useMemo<SplashMode>(
    () => SPLASH_MODES[Math.floor(Math.random() * SPLASH_MODES.length)],
    []
  );
  // 档位按屏幕最短边判定（与 hooks/useResponsiveLayout 的断点同口径，避免启动期依赖 store）
  const { width, height } = useWindowDimensions();
  const deviceType = useMemo<'tv' | 'tablet' | 'mobile'>(() => {
    if (Platform.isTV) return 'tv';
    const shortest = Math.min(width, height);
    if (shortest >= 1024) return 'tv';
    if (shortest >= 768) return 'tablet';
    return 'mobile';
  }, [width, height]);
  const [boot, setBoot] = useState<Boot>({ kind: "loading" });
  const skippedRef = useRef(false);

  // 等待帧可跳过：按确认键直接进入应用
  const skipAll = useCallback(() => {
    if (skippedRef.current) return;
    skippedRef.current = true;
    onDone();
  }, [onDone]);

  // 首帧渲染完成后隐藏 native splash（避免窗口露白）
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await resolveWall();
        if (!alive || skippedRef.current) return;
        if (res.kind === "wall") {
          setBoot({ kind: "wall", sources: res.sources, larges: res.larges });
        } else {
          setBoot({ kind: "panda", reason: res.reason });
        }
      } catch {
        if (alive) setBoot({ kind: "panda", reason: "fetch-failed" });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (boot.kind === "loading") return <BootFrame onSkip={skipAll} />;
  if (boot.kind === "panda") {
    return (
      <PandaSplash
        onDone={onDone}
        debugText={boot.reason ? REASON_TEXT[boot.reason] : undefined}
      />
    );
  }
  // 手机/平板：不拼熊猫（屏小拼不出图案），改「疏网格 + 定时放大某张」；电视维持四模式
  if (deviceType !== "tv") {
    return (
      <GridZoomScene
        sources={boot.sources}
        larges={boot.larges}
        onDone={onDone}
        deviceType={deviceType}
      />
    );
  }
  return (
    <WallScene
      key={mode}
      mode={mode}
      sources={boot.sources}
      onDone={onDone}
      deviceType={deviceType}
    />
  );
}

/* ================= 样式 ================= */
const styles = StyleSheet.create({
  root: {
    backgroundColor: BG,
    zIndex: 999,
    elevation: 999,
  },
  boot: {
    alignItems: "center",
    justifyContent: "center",
  },
  bootLogo: {
    width: 220,
    height: 220,
    opacity: 0.9,
  },
  bootText: {
    marginTop: 26,
    color: CREAM,
    fontSize: 16,
    letterSpacing: 4,
    opacity: 0.35,
  },
  bootHint: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 24,
    textAlign: "center",
    color: CREAM,
    fontSize: 14,
    letterSpacing: 3,
    opacity: 0.28,
  },
  tile: {
    position: "absolute",
    overflow: "hidden",
    backgroundColor: "#17181C",
  },
  litRing: {
    borderWidth: 1,
    borderColor: "rgba(244,239,230,0.16)",
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
  bright: {
    backgroundColor: "#FFFFFF",
  },
  dark: {
    backgroundColor: "#000000",
  },
  zoom: {
    position: "absolute",
    overflow: "hidden",
    backgroundColor: "#17181C",
    borderWidth: 1,
    borderColor: "rgba(244,239,230,0.18)",
    zIndex: 5,
  },
  gridWordmark: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "46%",
    textAlign: "center",
    color: CREAM,
    fontWeight: "600",
    textShadowColor: "rgba(0,0,0,0.65)",
    textShadowRadius: 14,
    opacity: 0,
  },
  wordmark: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "50%",
    textAlign: "center",
    color: CREAM,
    fontWeight: "600",
    opacity: 0,
  },
  dot: {
    color: CORAL,
  },
  hint: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 24,
    textAlign: "center",
    color: CREAM,
    fontSize: 14,
    letterSpacing: 3,
    opacity: 0,
  },
});
