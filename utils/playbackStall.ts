/**
 * 判断播放是否「真的卡住」。
 *
 * expo-av 在播放 HLS 时 isBuffering 常常一直为 true（表示在后台下载分片，并不代表画面停了），
 * 只看 isBuffering 会在正常播放时一直显示加载圈。这里改看播放位置：
 * 位置还在前进就不算卡住；超过 STALL_AFTER_MS 没有前进才算。
 */
export const STALL_AFTER_MS = 1500;
/** 位置前进不足这个毫秒数视为没动（避免抖动） */
const MIN_ADVANCE_MS = 100;

export interface StallTracker {
  pos: number;
  /** 最近一次位置向前推进的时间（从未推进过为 0） */
  advancedAt: number;
}

export function createStallTracker(): StallTracker {
  return { pos: -1, advancedAt: 0 };
}

/** 每次拿到新状态时调用，记录位置是否推进 */
export function trackPosition(t: StallTracker, positionMillis: number, now: number): void {
  if (positionMillis > t.pos + MIN_ADVANCE_MS && t.pos >= 0) {
    t.advancedAt = now;
  }
  t.pos = positionMillis;
}

/** 位置已经超过 STALL_AFTER_MS 没有前进（从未推进过也算） */
export function isStalled(t: StallTracker, now: number): boolean {
  return now - t.advancedAt >= STALL_AFTER_MS;
}

/**
 * 是否应显示加载圈：缓冲中、没有在播放、且播放位置确实停了。
 * isPlaying 为 true 时（画面在出）无论 isBuffering 如何都不显示。
 */
export function shouldShowBuffering(
  isBuffering: boolean,
  isPlaying: boolean,
  t: StallTracker,
  now: number,
): boolean {
  return isBuffering && !isPlaying && isStalled(t, now);
}
