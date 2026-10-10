/**
 * 照片墙 · 运行时照片源（登录令牌校验 + 服务端动态照片）v2
 *
 * 链路：43 发布器（/data/picture 原图 → /data/wall-photos 缩略图 + manifest，cron 每 5 分钟）
 *   → nginx https://live.137621.xyz/wall/（auth_request 复验 MoonTV 登录态，无授权 401）
 *   → App 启动时凭「登录令牌」拉 manifest → 增量下载缩略图到本地 → 照片墙用本地文件渲染
 *
 * 资格（不满足则回退熊猫动画）：
 *   - 设置里已配置服务器地址（apiBaseUrl）
 *   - 已成功登录（存在登录令牌，getStoredAuthToken）
 *
 * 每次启动都会尝试拉取（超时/失败则用本地已缓存集；首次无缓存则回退熊猫）。
 */
import type { ImageSourcePropType } from "react-native";
import * as FileSystem from "expo-file-system";
import { SettingsManager } from "@/services/storage";
import { getStoredAuthToken } from "@/services/api";

const BASE_URL = "https://live.137621.xyz/wall";
const WALL_DIR = (FileSystem.documentDirectory ?? "") + "wall/";
const STATE_FILE = WALL_DIR + "state.json";
const MANIFEST_TIMEOUT_MS = 3000;
const REFRESH_BUDGET_MS = 7000;
const DL_CONCURRENCY = 4;

/** 少于此数量视为不可用（回退熊猫） */
export const MIN_PHOTOS = 4;

interface WallState {
  updatedAt: number;
  /** 本地文件名（带版本前缀 v<updatedAt>_） */
  files: string[];
  /** 是否已下全（false 时下次启动补齐） */
  complete: boolean;
}

async function authHeaders(): Promise<Record<string, string>> {
  try {
    const token = await getStoredAuthToken();
    return token ? { Authorization: `Token ${token}` } : {};
  } catch {
    return {};
  }
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

async function writeState(st: WallState): Promise<void> {
  try {
    await FileSystem.makeDirectoryAsync(WALL_DIR, { intermediates: true });
    await FileSystem.writeAsStringAsync(STATE_FILE, JSON.stringify(st));
  } catch {
    /* ignore */
  }
}

/** 是否具备照片墙资格：配置了服务器地址 + 有登录令牌 */
export async function isWallEligible(): Promise<boolean> {
  if (!FileSystem.documentDirectory) return false;
  try {
    const settings = await SettingsManager.get();
    if (!settings || !settings.apiBaseUrl) return false;
  } catch {
    return false;
  }
  try {
    const token = await getStoredAuthToken();
    return !!token;
  } catch {
    return false;
  }
}

/** 并发受限地下载一批缩略图（带登录令牌；失败单张跳过） */
async function downloadAll(
  fileNames: string[],
  prefix: string,
  updatedAt: number,
  deadline: number
): Promise<string[]> {
  const ok: string[] = [];
  const headers = await authHeaders();
  let idx = 0;
  const worker = async () => {
    while (idx < fileNames.length && Date.now() < deadline) {
      const f = fileNames[idx];
      idx += 1;
      const dst = WALL_DIR + prefix + f;
      try {
        await FileSystem.downloadAsync(`${BASE_URL}/${f}?v=${updatedAt}`, dst, {
          headers,
        });
        ok.push(prefix + f);
      } catch {
        /* 单张失败继续 */
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(DL_CONCURRENCY, fileNames.length) }, worker)
  );
  return ok;
}

/**
 * 启动时刷新照片集。返回可用文件名列表（带版本前缀）；不可用返回 null。
 */
export async function refreshWallPhotos(): Promise<string[] | null> {
  if (!FileSystem.documentDirectory) return null;
  const local = await readState();

  // 1) 拉 manifest（带登录令牌；超时 3s）
  let man: { updatedAt?: number; files?: string[] } | null = null;
  try {
    const headers = await authHeaders();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), MANIFEST_TIMEOUT_MS);
    const res = await fetch(`${BASE_URL}/manifest.json`, {
      signal: ctrl.signal,
      headers: { "Cache-Control": "no-cache", ...headers },
    });
    clearTimeout(timer);
    if (res.ok) {
      man = (await res.json()) as { updatedAt?: number; files?: string[] };
    }
  } catch {
    man = null;
  }
  if (!man || !man.updatedAt || !Array.isArray(man.files) || man.files.length === 0) {
    // 拉不到 → 用本地缓存
    return local && local.files.length >= MIN_PHOTOS ? local.files : null;
  }

  const deadline = Date.now() + REFRESH_BUDGET_MS;
  const prefix = `v${man.updatedAt}_`;

  // 2) 本地已是当前版本：缺图则补齐
  if (local && local.updatedAt === man.updatedAt) {
    const missing = man.files.filter((f) => !local.files.includes(prefix + f));
    if (missing.length === 0 || local.complete) {
      return local.files.length >= MIN_PHOTOS ? local.files : null;
    }
    const gained = await downloadAll(missing, prefix, man.updatedAt, deadline);
    const merged = Array.from(new Set([...local.files, ...gained]));
    await writeState({
      updatedAt: man.updatedAt,
      files: merged,
      complete: merged.length >= man.files.length,
    });
    return merged.length >= MIN_PHOTOS ? merged : null;
  }

  // 3) 新版本：全量下载
  const gained = await downloadAll(man.files, prefix, man.updatedAt, deadline);
  if (gained.length >= MIN_PHOTOS) {
    await writeState({
      updatedAt: man.updatedAt,
      files: gained,
      complete: gained.length >= man.files.length,
    });
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
    return gained;
  }

  // 新版本下载失败 → 尽量退回旧缓存
  return local && local.files.length >= MIN_PHOTOS ? local.files : null;
}

/** 给出可渲染的图片源（照片墙决策层用）；不可用返回 null */
export async function resolveWallPhotos(): Promise<ImageSourcePropType[] | null> {
  const files = await refreshWallPhotos();
  if (!files || files.length === 0) return null;
  return files.map((f) => ({ uri: WALL_DIR + f }));
}
