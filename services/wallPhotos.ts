/**
 * 照片墙 · 运行时照片源（服务端动态同步）
 *
 * - loadWallPhotoSources(): 启动时取照片源 —— 优先「已同步到本地的服务器照片集」，否则回退内置照片
 * - syncWallPhotos(): 后台同步 —— 拉取 manifest（约 200B），有更新则下载缩略图到本地
 *
 * 服务器侧（43）：
 *   /data/picture（用户丢原图的目录） → 发布器 /opt/wallpub/publish.js（cron 每 10 分钟）
 *   → /data/wall-photos/{p1.jpg..., manifest.json} → nginx https://live.137621.xyz/wall/
 *
 * 生效时机：每次启动完成后触发同步（_layout）；"这次放的照片，下次启动即用"。
 */
import type { ImageSourcePropType } from "react-native";
import * as FileSystem from "expo-file-system";
import { PHOTOS } from "@/assets/photos";

const BASE_URL = "https://live.137621.xyz/wall";
const WALL_DIR = (FileSystem.documentDirectory ?? "") + "wall/";
const STATE_FILE = WALL_DIR + "state.json";

interface WallState {
  updatedAt: number;
  /** 本地文件名（已带版本前缀 v<updatedAt>_） */
  files: string[];
}

async function readState(): Promise<WallState | null> {
  try {
    const info = await FileSystem.getInfoAsync(STATE_FILE);
    if (!info.exists) return null;
    const st = JSON.parse(await FileSystem.readAsStringAsync(STATE_FILE)) as WallState;
    if (!st || !Array.isArray(st.files) || st.files.length === 0) return null;
    return st;
  } catch {
    return null;
  }
}

/** 启动时取照片源：服务器同步集 > 内置集 */
export async function loadWallPhotoSources(): Promise<ImageSourcePropType[]> {
  if (!FileSystem.documentDirectory) return PHOTOS;
  const st = await readState();
  if (!st) return PHOTOS;
  return st.files.map((f) => ({ uri: WALL_DIR + f }));
}

/** 后台同步（幂等、失败静默）。返回是否有更新。 */
export async function syncWallPhotos(): Promise<boolean> {
  if (!FileSystem.documentDirectory) return false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(BASE_URL + "/manifest.json", {
      signal: ctrl.signal,
      headers: { "Cache-Control": "no-cache" },
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const man = (await res.json()) as { updatedAt?: number; files?: string[] };
    if (!man || !man.updatedAt || !Array.isArray(man.files) || man.files.length === 0) {
      return false;
    }
    const local = await readState();
    if (local && local.updatedAt === man.updatedAt) return false;

    await FileSystem.makeDirectoryAsync(WALL_DIR, { intermediates: true });
    const prefix = "v" + man.updatedAt + "_";
    for (const f of man.files) {
      const dst = WALL_DIR + prefix + f;
      const info = await FileSystem.getInfoAsync(dst);
      if (info.exists) continue;
      await FileSystem.downloadAsync(BASE_URL + "/" + f + "?v=" + man.updatedAt, dst);
    }
    await FileSystem.writeAsStringAsync(
      STATE_FILE,
      JSON.stringify({
        updatedAt: man.updatedAt,
        files: man.files.map((f) => prefix + f),
      })
    );
    // 清理旧版本文件（失败无碍）
    try {
      const names = await FileSystem.readDirectoryAsync(WALL_DIR);
      await Promise.all(
        names
          .filter((n) => n.endsWith(".jpg") && !n.startsWith(prefix))
          .map((n) => FileSystem.deleteAsync(WALL_DIR + n, { idempotent: true }))
      );
    } catch {
      /* ignore */
    }
    return true;
  } catch {
    return false;
  }
}
