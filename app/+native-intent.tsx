import { useMusicStore } from "@/stores/musicStore";

/**
 * 系统把外部链接交给路由之前的改写入口。
 *
 * 音乐通知栏卡片被点击时，react-native-track-player 会带着 `trackplayer://notification.click`
 * 回到 App——它不是页面路径，直接交给路由会落到「This screen doesn't exist」。
 * 这里改为：不跳转，直接在当前页面上展开全屏播放器（冷启动则回首页）。
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  if (path.includes("notification.click")) {
    useMusicStore.getState().setPlayerOpen(true);
    return initial ? "/" : "";
  }
  return path;
}
