/**
 * 装饰性「波谱条」的目标高度生成（纯函数，可单测）
 *
 * 说明：expo-av 不暴露音频 FFT 数据，所以这里是**装饰性**动效（随播放状态起伏），并非真实频谱。
 * 为了看起来像音乐而不是随机抖动：
 *   - 相邻两次目标差距有上限（平滑，避免一帧从低到高的突变）
 *   - 中间的条整体偏高、两侧偏低（像真实频谱常见的「中频凸起」）
 */
export interface BarTargetOptions {
  /** 当前条序号 0..count-1 */
  index: number;
  count: number;
  /** 上一次的目标（0..1） */
  prev: number;
  /** 注入随机数（测试用），返回 [0,1) */
  rnd?: () => number;
  /** 单次最大变化幅度 */
  maxStep?: number;
}

export const BAR_MIN = 0.14;
export const BAR_MAX = 1;

export function barTarget(opts: BarTargetOptions): number {
  const { index, count, prev } = opts;
  const rnd = opts.rnd ?? Math.random;
  const maxStep = opts.maxStep ?? 0.55;

  // 中间权重高、两侧低：以条序号距中心的归一化距离做抛物线
  const mid = (count - 1) / 2;
  const dist = mid === 0 ? 0 : Math.abs(index - mid) / mid; // 0(中) → 1(边)
  const ceil = BAR_MIN + (BAR_MAX - BAR_MIN) * (1 - 0.45 * dist * dist);

  const raw = BAR_MIN + rnd() * (ceil - BAR_MIN);
  // 平滑：相对上一次的变化不超过 maxStep
  const lo = Math.max(BAR_MIN, prev - maxStep);
  const hi = Math.min(ceil, prev + maxStep);
  const v = Math.min(Math.max(raw, lo), Math.max(lo, hi));
  return Math.min(BAR_MAX, Math.max(BAR_MIN, v));
}

/** 单次动画时长（毫秒）：略带随机，避免各条同步 */
export function barDuration(rnd: () => number = Math.random): number {
  return 220 + Math.floor(rnd() * 260);
}
