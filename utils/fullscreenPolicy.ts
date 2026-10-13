/**
 * 全屏方向策略（纯函数，无原生依赖，可单测）
 *
 * 主流视频 App（B 站 / 腾讯视频 / YouTube）的做法：按视频画面比例决定——
 *   - 横屏内容（16:9 影视、直播）→ 全屏转横屏
 *   - 竖屏内容（短剧等，高 > 宽）→ 全屏保持竖屏
 *   - 尺寸未知（尚未拿到 naturalSize）→ 按横屏处理（影视/直播绝大多数是横屏）
 */
export interface NaturalSize {
  width: number;
  height: number;
}

export type FullscreenOrientation = "landscape" | "portrait";

export function fullscreenOrientationFor(size?: NaturalSize | null): FullscreenOrientation {
  if (size && size.width > 0 && size.height > 0 && size.height > size.width) {
    return "portrait";
  }
  return "landscape";
}
