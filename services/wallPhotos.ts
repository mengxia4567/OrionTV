/**
 * 照片墙 · 运行时照片源 v3
 *
 * 链路：43 发布器（/data/picture → /data/wall-photos，cron 每 5 分钟）
 *   → nginx https://live.137621.xyz/wall/（auth_request 复验 MoonTV 登录态，无授权 401）
 *   → App 启动时凭「登录令牌」拉 manifest → 增量下载缩略图到本地 → 照片墙用本地文件渲染
 *
 * v3（2026-10-11）修复与增强：
 *   ① 清单 401 时自动触发会话自愈（refresh → 静默重登）并重试一次
 *      ——修复「登录过但访问令牌过期（4h）→ 一直回退熊猫」的问题；
 *   ② 超时放宽：清单 9s / 下载总预算 18s / 单文件 12s（国内经 CF 访问较慢）；
 *   ③ 返回明确失败原因，用于熊猫回退页的小字提示（电视端可据此定位问题）。
 */
import type { ImageSourcePropType } from "react-native";
import * as FileSystem from "expo-file-system";
import { SettingsManager } from "@/services/storage";
import { api, getStoredAuthToken } from "@/services/api";

const BASE_URL = "https://live.137621.xyz/wall";
const WALL_DIR = (FileSystem.documentDirectory ?? "") + "wall/";
const STATE_FILE = WALL_DIR + "state.json";
const MANIFEST_TIMEOUT_MS = 9000;
const REFRESH_BUDGET_MS = 18000;
const FILE_TIMEOUT_MS = 12000;
const DL_CONCURRENCY = 4;

/** 少于此数量视为不可用（回退熊猫） */
export const MIN_PHOTOS = 4;

export type WallFailure =
  | "not-configured"
  | "not-logged-in"
  | "auth-401"
  | "timeout"
  | "empty"
  | "fetch-failed";

export type WallResolution =
  | { kind: "wall"; sources: ImageSourcePropType[] }
  | { kind: "panda"; reason: WallFailure };

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

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("TIMEOUT")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

interface ManifestResult {
  status: number; // 200 / 401 / -1(网络异常或超时)
  updatedAt?: number;
  files?: string[];
}

async function fetchManifest(): Promise<ManifestResult> {
  try {
    const headers = await authHeaders();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), MANIFEST_TIMEOUT_MS);
    const res = await fetch(`${BASE_URL}/manifest.json`, {
      signal: ctrl.signal,
      headers: { "Cache-Control": "no-cache", ...headers },
    });
    clearTimeout(timer);
    if (!res.ok) return { status: res.status };
    const man = (await res.json()) as { updatedAt?: number; files?: string[] };
    if (!man || !man.updatedAt || !Array.isArray(man.files) || man.files.length === 0) {
      return { status: 200 };
    }
    return { status: 200, updatedAt: man.updatedAt, files: man.files };
  } catch {
    return { status: -1 };
  }
}

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
        await withTimeout(
          FileSystem.downloadAsync(`${BASE_URL}/${f}?v=${updatedAt}`, dst, { headers }),
          FILE_TIMEOUT_MS
        );
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

function toSources(files: string[] | undefined | null): ImageSourcePropType[] | null {
  if (!files || files.length < MIN_PHOTOS) return null;
  return files.map((f) => ({ uri: WALL_DIR + f }));
}

/**
 * 启动时解析照片墙结果：
 *   - 资格不足（未配置/未登录）→ panda + 原因
 *   - 拉取成功或有可用缓存 → wall
 *   - 其余 → panda + 原因
 */
export async function resolveWall(): Promise<WallResolution> {
  if (!FileSystem.documentDirectory) {
    return { kind: "panda", reason: "fetch-failed" };
  }

  // 1) 资格：已配置服务器地址 + 已登录（有令牌）
  let apiBaseUrl = "";
  try {
    const s = await SettingsManager.get();
    apiBaseUrl = s?.apiBaseUrl ?? "";
  } catch {
    apiBaseUrl = "";
  }
  if (!apiBaseUrl) return { kind: "panda", reason: "not-configured" };
  try {
    const token = await getStoredAuthToken();
    if (!token) return { kind: "panda", reason: "not-logged-in" };
  } catch {
    return { kind: "panda", reason: "not-logged-in" };
  }

  const local = await readState();

  // 2) 拉清单；401 → 会话自愈 → 重试一次
  let man = await fetchManifest();
  if (man.status === 401) {
    const recovered = await api.triggerAuthRecovery();
    if (recovered) {
      man = await fetchManifest();
    }
  }
  if (man.status === 401) {
    const cached = toSources(local?.files);
    return cached ? { kind: "wall", sources: cached } : { kind: "panda", reason: "auth-401" };
  }
  if (man.status !== 200 || !man.files || !man.updatedAt) {
    const cached = toSources(local?.files);
    if (cached) return { kind: "wall", sources: cached };
    return { kind: "panda", reason: man.status === 200 ? "empty" : "timeout" };
  }

  const prefix = `v${man.updatedAt}_`;

  // 3) 本地已是当前版本：完整 → 直接用；不完整 → 补齐
  if (local && local.updatedAt === man.updatedAt) {
    if (!local.complete) {
      const missing = man.files.filter((f) => !local.files.includes(prefix + f));
      if (missing.length > 0) {
        const deadline = Date.now() + REFRESH_BUDGET_MS;
        const gained = await downloadAll(missing, prefix, man.updatedAt, deadline);
        const merged = Array.from(new Set([...local.files, ...gained]));
        await writeState({
          updatedAt: man.updatedAt,
          files: merged,
          complete: merged.length >= man.files.length,
        });
        const mergedSources = toSources(merged);
        if (mergedSources) return { kind: "wall", sources: mergedSources };
        return { kind: "panda", reason: "fetch-failed" };
      }
    }
    const cached = toSources(local.files);
    if (cached) return { kind: "wall", sources: cached };
  }

  // 4) 新版本：全量下载
  const deadline = Date.now() + REFRESH_BUDGET_MS;
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
    return { kind: "wall", sources: gained.map((f) => ({ uri: WALL_DIR + f })) };
  }
  const cached = toSources(local?.files);
  if (cached) return { kind: "wall", sources: cached };
  return { kind: "panda", reason: "fetch-failed" };
}
