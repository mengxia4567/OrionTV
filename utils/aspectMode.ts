/**
 * 全屏画面比例策略（纯函数，可单测）
 *
 * 现在的手机多为 20:9 长屏，16:9 视频「适应」后左右会有大块黑边。主流播放器的做法是提供比例选项：
 *   - 自动：按裁切比例决定。「填充」裁掉的画面不超过 25% 时自动填充，否则适应（避免 4:3 老片被切掉太多）
 *   - 适应：完整显示，不裁切、不变形（可能有黑边）
 *   - 填充：等比放大铺满，超出屏幕的部分被裁切（可能切掉内嵌字幕）
 *   - 拉伸：拉伸铺满，画面会变形
 * 只在全屏时生效；非全屏（竖屏小窗）始终「适应」。
 */
export type AspectMode = "auto" | "fit" | "fill" | "stretch";
export type VideoFit = "contain" | "cover" | "stretch";

export interface Size {
  width: number;
  height: number;
}

export const ASPECT_MODES: AspectMode[] = ["auto", "fit", "fill", "stretch"];

export const ASPECT_LABEL: Record<AspectMode, string> = {
  auto: "自动",
  fit: "适应",
  fill: "填充",
  stretch: "拉伸",
};

/** 「自动」模式下，填充允许裁掉的画面占比上限 */
export const AUTO_FILL_MAX_CROP = 0.25;

const valid = (s?: Size | null): s is Size => !!s && s.width > 0 && s.height > 0;

/** 填充（cover）时视频被裁掉的比例：0 = 不裁，0.2 = 裁掉 20% */
export function cropFractionOfFill(video: Size, box: Size): number {
  const rv = video.width / video.height;
  const rb = box.width / box.height;
  return 1 - Math.min(rv, rb) / Math.max(rv, rb);
}

export function resolveVideoFit(
  mode: AspectMode,
  video: Size | null | undefined,
  box: Size | null | undefined,
  fullscreen: boolean,
): VideoFit {
  if (!fullscreen) return "contain";
  if (mode === "fit") return "contain";
  if (mode === "fill") return "cover";
  if (mode === "stretch") return "stretch";
  if (!valid(video) || !valid(box)) return "contain";
  return cropFractionOfFill(video, box) <= AUTO_FILL_MAX_CROP ? "cover" : "contain";
}

export function nextAspectMode(mode: AspectMode): AspectMode {
  const i = ASPECT_MODES.indexOf(mode);
  return ASPECT_MODES[(i + 1) % ASPECT_MODES.length];
}

export function isAspectMode(v: unknown): v is AspectMode {
  return typeof v === "string" && (ASPECT_MODES as string[]).includes(v);
}
