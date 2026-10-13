/**
 * 直播手势判定（纯函数，无原生依赖，可单测）
 */
export type SwipeDir = "up" | "down" | "left" | "right";

export interface SwipeOptions {
  /** 最小位移（px），小于它视为点按 */
  minDistance?: number;
  /** 主方向需大于副方向的倍数，避免斜划误判 */
  dominance?: number;
}

export function classifySwipe(dx: number, dy: number, opts: SwipeOptions = {}): SwipeDir | null {
  const min = opts.minDistance ?? 50;
  const dom = opts.dominance ?? 1.4;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < min) return null;
  if (ay >= ax * dom) return dy < 0 ? "up" : "down";
  if (ax >= ay * dom) return dx < 0 ? "left" : "right";
  return null;
}

/** 两次点按间隔在窗口内即视为双击 */
export function isDoubleTap(prevAt: number | null, nowAt: number, windowMs = 280): boolean {
  if (prevAt === null) return false;
  const gap = nowAt - prevAt;
  return gap >= 0 && gap <= windowMs;
}
