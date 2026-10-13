/**
 * 播放内核（react-native-track-player）状态 → musicStore 里 UI 用的三个布尔值。
 * 纯函数，可单测。RNTP 的 State 是字符串枚举，这里直接用字面量，避免测试里 import 原生模块。
 *
 *   playing   → 播放中
 *   buffering → 缓冲中（想播但数据不够）
 *   loading   → 正在加载新曲（首次拿到数据之前）
 *   ready / paused → 已就绪或暂停（不算加载中）
 *   none / stopped / ended / error → 全 false（none/stopped 在换曲瞬间会出现，调用方负责忽略）
 */
export type PlayerStateName =
  | "none"
  | "ready"
  | "playing"
  | "paused"
  | "stopped"
  | "loading"
  | "buffering"
  | "error"
  | "ended";

export interface UiPlayState {
  isPlaying: boolean;
  isBuffering: boolean;
  isLoading: boolean;
}

export function mapPlayerState(state: string): UiPlayState {
  switch (state) {
    case "playing":
      return { isPlaying: true, isBuffering: false, isLoading: false };
    case "buffering":
      return { isPlaying: false, isBuffering: true, isLoading: false };
    case "loading":
      return { isPlaying: false, isBuffering: true, isLoading: true };
    case "ready":
    case "paused":
      return { isPlaying: false, isBuffering: false, isLoading: false };
    default:
      return { isPlaying: false, isBuffering: false, isLoading: false };
  }
}

/** 换曲过程中应忽略的「过渡态」（reset 之后会先后冒出 none / stopped） */
export function isTransitionalState(state: string): boolean {
  return state === "none" || state === "stopped" || state === "ended";
}

/** "03:51" / "1:02:03" / "231"（秒）→ 秒；解析不了返回 undefined */
export function parseDurationText(text?: string): number | undefined {
  if (!text) return undefined;
  const t = text.trim();
  if (!t) return undefined;
  if (/^\d+$/.test(t)) return Number(t) || undefined;
  const parts = t.split(":").map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n) || n < 0) || parts.length < 2 || parts.length > 3) return undefined;
  const sec = parts.reduce((acc, n) => acc * 60 + n, 0);
  return sec > 0 ? sec : undefined;
}
