import { Platform } from "react-native";
import * as ScreenOrientation from "expo-screen-orientation";
import { fullscreenOrientationFor, NaturalSize } from "@/utils/fullscreenPolicy";

/**
 * 进入全屏时调用（在 expo-av 的 onFullscreenUpdate = PLAYER_WILL_PRESENT 里）：
 * 按视频比例锁定方向。lockAsync 直接设置 Activity 方向，**不受系统「自动旋转」开关影响**
 * （这正是用户在手机上"全屏仍是竖屏"的原因：自动旋转关闭 + App 从不锁方向）。
 * 电视端不处理。
 */
export async function lockForFullscreen(size?: NaturalSize | null): Promise<void> {
  if (Platform.isTV) return;
  try {
    const target = fullscreenOrientationFor(size);
    await ScreenOrientation.lockAsync(
      target === "portrait"
        ? ScreenOrientation.OrientationLock.PORTRAIT_UP
        : ScreenOrientation.OrientationLock.LANDSCAPE
    );
  } catch {
    // 个别设备/系统不支持时静默忽略，不影响播放
  }
}

/** 退出全屏后恢复为系统默认（app.json: orientation = default，随传感器） */
export async function unlockAfterFullscreen(): Promise<void> {
  if (Platform.isTV) return;
  try {
    await ScreenOrientation.unlockAsync();
  } catch {
    // ignore
  }
}
