import { Platform, StatusBar } from "react-native";
import * as ScreenOrientation from "expo-screen-orientation";
import * as NavigationBar from "expo-navigation-bar";
import { fullscreenOrientationFor, NaturalSize } from "@/utils/fullscreenPolicy";

/**
 * 应用内「沉浸式全屏」（手机 / 平板）：
 *   锁定方向（按视频比例：横屏内容 → 横屏，竖屏内容 → 竖屏）+ 隐藏状态栏与导航栏。
 * 不再使用 expo-av 的原生全屏窗口——它在「先改方向再弹窗」时会卡死，且盖住 RN 层
 * （全屏里没有手势/控制条）。应用内全屏时画面和控制层是同一棵 RN 树，手势与控制条照常可用。
 * 电视端不处理（TV 没有方向概念，沿用遥控器流程）。
 */
export async function enterImmersive(size?: NaturalSize | null): Promise<void> {
  if (Platform.isTV) return;
  try {
    const target = fullscreenOrientationFor(size);
    await ScreenOrientation.lockAsync(
      target === "portrait"
        ? ScreenOrientation.OrientationLock.PORTRAIT_UP
        : ScreenOrientation.OrientationLock.LANDSCAPE
    );
  } catch {
    // 个别设备不支持时忽略，仍然隐藏系统栏
  }
  try {
    StatusBar.setHidden(true, "fade");
    if (Platform.OS === "android") {
      await NavigationBar.setVisibilityAsync("hidden");
      await NavigationBar.setBehaviorAsync("overlay-swipe");
    }
  } catch {
    // ignore
  }
}

/** 退出：先回竖屏，稍后释放方向锁（随系统「自动旋转」），并恢复系统栏 */
export async function exitImmersive(): Promise<void> {
  if (Platform.isTV) return;
  try {
    StatusBar.setHidden(false, "fade");
    if (Platform.OS === "android") {
      await NavigationBar.setVisibilityAsync("visible");
    }
  } catch {
    // ignore
  }
  try {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    setTimeout(() => {
      void ScreenOrientation.unlockAsync().catch(() => {});
    }, 400);
  } catch {
    try {
      await ScreenOrientation.unlockAsync();
    } catch {
      // ignore
    }
  }
}
