/**
 * PhotoWallSplash — 开机动画「照片墙」
 *
 * 四个模式，启动时随机抽一个：
 *   A 汇聚星河  — 照片从四周飞入汇聚成墙 → 呼吸推进 → 随机点亮 → 字标
 *   B 拼字熊猫  — 快闪成墙 → 墙溶解，只留照片拼出的熊猫头（眼斑压暗）→ 眨眼 → 字标
 *   C 派对墙    — 弹跳入场 → 波浪操 → 转圈派对 → 字标
 *   D 全餐      — A 的飞入 + B 的熊猫 + 眨眼 + 字标（推荐观感）
 *
 * 照片来源（动态）：启动时优先用「服务器同步到本地的照片集」（services/wallPhotos.ts），
 * 否则回退内置 assets/photos。服务器新照片由 43 的发布器产出（/data/picture → live.137621.xyz/wall/）。
 *
 * 设计口径（与 agent-data/projects/oriontv-splash 中的预览/生成器一致）：
 *   - 网格 16×9 = 144 格；熊猫遮罩为纯几何计算（computePandaMask，参数与 maskgen.py v3 逐位一致）
 *   - 零新依赖：只用 react-native-reanimated 的 transform/opacity；墙级动画作用于整层容器
 *   - 任意时刻按「确认键」/点击可跳过；超过 9s 兜底自动结束
 *
 * 由 agent-data/projects/oriontv-splash 的部署脚本落地到本仓库，请勿只手改本文件而不同步源脚本。
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
import { PHOTOS } from "@/assets/photos";
import { loadWallPhotoSources } from "@/services/wallPhotos";

/* ================= 常量 ================= */
const COLS = 16;
const ROWS = 9;
const N = COLS * ROWS;
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

/* ================= 熊猫遮罩（纯几何，v3 参数） =================
 * ears/head/lens 坐标空间 1024×1024（同 assets/images/splash-logo.svg 语义）
 * 与 maskgen.py：hfrac=.78 / cy=.43 / thr=.45 / holeThr=.55
 */
const EARS: number[][] = [[396, 360, 84], [628, 360, 84]];
const HEAD: number[] = [512, 540, 225, 205];
const LENS: number[][] = [[384, 522, 92], [640, 522, 92]];
const CONTENT_H = 461;
const CENTER_X = 512;
const CENTER_Y = 510.5;
const HFRAC = 0.78;
const CY = 0.43;
const THR = 0.45;
const HOLE_THR = 0.55;

/** 返回 0=暗格 1=亮格 2=暗洞（眼斑） */
export function computePandaMask(cols: number, rows: number): number[][] {
  const ss = 12;
  const w = cols * ss;
  const h = rows * ss;
  const scale = (HFRAC * h) / CONTENT_H;
  const ccx = w / 2;
  const ccy = CY * h;
  const cir = (x: number, y: number, c: number[]) =>
    (x - c[0]) ** 2 + (y - c[1]) ** 2 <= c[2] * c[2];
  const ell = (x: number, y: number) =>
    ((x - HEAD[0]) / HEAD[2]) ** 2 + ((y - HEAD[1]) / HEAD[3]) ** 2 <= 1;
  const cls = (u: number, v: number) => {
    const x = CENTER_X + (u - ccx) / scale;
    const y = CENTER_Y + (v - ccy) / scale;
    if (!(EARS.some((e) => cir(x, y, e)) || ell(x, y))) return 0;
    return LENS.some((l) => cir(x, y, l)) ? 2 : 1;
  };
  const mask: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) {
      const cnt = [0, 0, 0];
      for (let i = 0; i < ss; i++) {
        for (let j = 0; j < ss; j++) {
          cnt[cls(c * ss + i + 0.5, r * ss + j + 0.5)] += 1;
        }
      }
      const total = ss * ss;
      row.push(
        cnt[2] / total >= HOLE_THR ? 2 : cnt[1] / total >= THR ? 1 : 0
      );
    }
    mask.push(row);
  }
  return mask;
}

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

/** 循环填充照片到 144 格：每轮重洗，跨轮避免相邻重复 */
function assignPhotos(photos: ImageSourcePropType[]): ImageSourcePropType[] {
  const out: ImageSourcePropType[] = [];
  if (!photos || photos.length === 0) return out;
  let pool: ImageSourcePropType[] = [];
  while (out.length < N) {
    if (pool.length === 0) pool = shuffleIdx(photos.length).map((i) => photos[i]);
    const last = out[out.length - 1];
    if (out.length > 0 && pool[0] === last && pool.length > 1) {
      [pool[0], pool[1]] = [pool[1], pool[0]];
    }
    out.push(pool.shift() as ImageSourcePropType);
  }
  return out;
}

function buildScene(
  mode: SplashMode,
  width: number,
  height: number,
  photos: ImageSourcePropType[]
): Scene {
  const tileW = (width - PAD * 2 - GAP * (COLS - 1)) / COLS;
  const tileH = (height - PAD * 2 - GAP * (ROWS - 1)) / ROWS;
  const k = width / 960; // 距离随屏宽缩放
  const sources = assignPhotos(photos);
  const mask = mode === "B" || mode === "D" ? computePandaMask(COLS, ROWS) : null;
  const rand = (a: number, b: number) => a + Math.random() * (b - a);

  const spinPicks = new Set<number>();
  if (mode === "C") {
    shuffleIdx(N).slice(0, 16).forEach((i) => spinPicks.add(i));
  }
  const popPicks = new Set<number>();
  if (mode === "A") {
    shuffleIdx(N).slice(0, 8).forEach((i) => popPicks.add(i));
  }

  const tiles: TileConfig[] = [];
  for (let i = 0; i < N; i++) {
    const c = i % COLS;
    const r = (i / COLS) | 0;
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
      const ang = Math.atan2(r - 4.5, c - 7.5) + rand(-0.3, 0.3);
      const dist = (760 + Math.random() * 520) * k;
      cfg.fx = Math.cos(ang) * dist;
      cfg.fy = Math.sin(ang) * dist * 0.72;
      cfg.fRot = rand(-22, 22);
      cfg.fScale = rand(1.25, 1.75);
      cfg.durIn = mode === "A" ? 560 : 520;
      cfg.delayIn =
        30 + Math.hypot(c - 7.5, r - 4.5) * 44 + Math.random() * (mode === "A" ? 180 : 150);
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
      cfg.wink = v === 2 && c >= 9 ? 1 : 0;
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

  // 拼图（morph）起点：B 固定 1000ms；D 在飞入结束后 260ms（绝对时间，与预览一致）
  if (mask) {
    const morphBase = mode === "B" ? 1000 : over + 260;
    for (let i = 0; i < N; i++) {
      const c = i % COLS;
      const r = (i / COLS) | 0;
      tiles[i].morphDelay = morphBase + (c + r) * 7;
    }
  }
  if (mode === "A") {
    let n = 0;
    popPicks.forEach((i) => {
      tiles[i].popAt = over + 220 + n * 190 + Math.random() * 80;
      n += 1;
    });
  }

  const wmSize = width * (mode === "B" || mode === "D" ? 0.04 : 0.048);
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

/* ================= 主体 ================= */
interface SplashProps {
  onDone: () => void;
}

interface ImplProps extends SplashProps {
  mode: SplashMode;
  sources: ImageSourcePropType[];
}

function PhotoWallSplashImpl({ mode, onDone, sources }: ImplProps) {
  const { width, height } = useWindowDimensions();
  const scene = useMemo(
    () => buildScene(mode, width, height, sources),
    [mode, width, height, sources]
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
      wp.value = withDelay(s.over + 1650, withTiming(1, { duration: 560, easing: EASE_OUT }));
      fade.value = withDelay(
        s.over + 2450,
        withTiming(1, { duration: 420, easing: Easing.in(Easing.quad) }, (f) => {
          if (f) {
            runOnJS(finish)();
          }
        })
      );
    } else if (mode === "B") {
      winkVal.value = withDelay(
        1850,
        withSequence(
          withTiming(1, { duration: 140, easing: Easing.out(Easing.quad) }),
          withDelay(180, withTiming(0, { duration: 260 }))
        )
      );
      wp.value = withDelay(2300, withTiming(1, { duration: 560, easing: EASE_OUT }));
      fade.value = withDelay(
        3150,
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
      wp.value = withDelay(2650, withTiming(1, { duration: 560, easing: EASE_OUT }));
      fade.value = withDelay(
        3450,
        withTiming(1, { duration: 420, easing: Easing.in(Easing.quad) }, (f) => {
          if (f) {
            runOnJS(finish)();
          }
        })
      );
    } else {
      winkVal.value = withDelay(
        s.over + 1150,
        withSequence(
          withTiming(1, { duration: 140, easing: Easing.out(Easing.quad) }),
          withDelay(180, withTiming(0, { duration: 260 }))
        )
      );
      wp.value = withDelay(s.over + 1550, withTiming(1, { duration: 560, easing: EASE_OUT }));
      fade.value = withDelay(
        s.over + 2500,
        withTiming(1, { duration: 420, easing: Easing.in(Easing.quad) }, (f) => {
          if (f) {
            runOnJS(finish)();
          }
        })
      );
    }
    // 兜底：异常情况下 9 秒强制结束，绝不卡死入口
    const guard = setTimeout(finish, 9000);
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
      <Animated.Text style={[styles.hint, hintStyle]}>按确认键跳过</Animated.Text>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={skip}
        focusable
        {...(Platform.isTV ? { hasTVPreferredFocus: true } : {})}
      />
    </Animated.View>
  );
}

/** 入口：启动时随机挑一个模式；照片源 = 服务器同步集 > 内置集 */
export default function PhotoWallSplash({ onDone }: SplashProps) {
  const mode = useMemo<SplashMode>(
    () => SPLASH_MODES[Math.floor(Math.random() * SPLASH_MODES.length)],
    []
  );
  const [sources, setSources] = useState<ImageSourcePropType[] | null>(null);

  useEffect(() => {
    let alive = true;
    loadWallPhotoSources()
      .then((s) => {
        if (alive) setSources(s);
      })
      .catch(() => {
        if (alive) setSources(PHOTOS);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 无照片素材时直接放行（保护入口，不阻塞 app）
  useEffect(() => {
    if (sources && sources.length === 0) onDone();
  }, [sources, onDone]);

  if (sources === null) {
    // 读本地同步状态的一瞬间（通常 <30ms），先给黑场
    return <View style={styles.root} />;
  }
  if (sources.length === 0) return null;

  return <PhotoWallSplashImpl key={mode} mode={mode} sources={sources} onDone={onDone} />;
}

/* ================= 样式 ================= */
const styles = StyleSheet.create({
  root: {
    backgroundColor: BG,
    zIndex: 999,
    elevation: 999,
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
