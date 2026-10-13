/**
 * 点播手势判定（纯函数，无原生依赖，可单测）
 *   水平拖动 = 跟手 seek｜双击左/右侧 = 快退/快进 10 秒｜双击中间 = 播放/暂停｜长按 = 临时倍速
 */
export type TapZone = "left" | "center" | "right";

/** 左 35% / 中间 30% / 右 35% */
export function tapZone(x: number, width: number): TapZone {
  if (width <= 0) return "center";
  const r = x / width;
  if (r < 0.35) return "left";
  if (r > 0.65) return "right";
  return "center";
}

/** 是否按「水平拖动」处理：位移足够且明显横向，避免斜划/点按误判 */
export function isHorizontalDrag(dx: number, dy: number): boolean {
  const ax = Math.abs(dx);
  return ax > 14 && ax > Math.abs(dy) * 1.5;
}

/** 满屏宽横划最多对应的时间跨度（毫秒）：长片也不会一划就跳很远 */
const MAX_SPAN_MS = 120_000;

/** 横向拖动 dx（px）对应的 seek 偏移（毫秒，带符号） */
export function seekDeltaMs(dx: number, width: number, durationMs: number): number {
  if (width <= 0 || durationMs <= 0) return 0;
  const span = Math.min(durationMs, MAX_SPAN_MS);
  return Math.round((dx / width) * span);
}

/** 目标位置 = 起点 + 偏移，限制在 [0, 时长] */
export function clampSeek(startMs: number, deltaMs: number, durationMs: number): number {
  return Math.max(0, Math.min(startMs + deltaMs, durationMs));
}

/** 长按期间的临时倍速 */
export const LONG_PRESS_RATE = 2;
export const LONG_PRESS_MS = 450;
