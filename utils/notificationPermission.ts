import { PermissionsAndroid, Platform } from "react-native";

/** Android 13+ 需要运行时授权通知，否则通知栏卡片不显示（播放本身不受影响）；每个进程只问一次 */
let asked = false;

export async function ensureNotificationPermission(): Promise<void> {
  if (asked) return;
  asked = true;
  if (Platform.OS !== "android" || Platform.isTV || Number(Platform.Version) < 33) return;
  try {
    await PermissionsAndroid.request("android.permission.POST_NOTIFICATIONS" as never);
  } catch {
    /* 拒绝/异常都不影响播放 */
  }
}
