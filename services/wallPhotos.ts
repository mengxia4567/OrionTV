/**
 * 照片墙 · 运行时照片源 v4
 *
 * 链路（地址均由设置推导，仓库不预置任何具体域名）：
 *   - 「播放代理地址」（设置项，建议填国内直连的加速入口）优先：<代理地址>/wall
 *   - 「服务器地址」（设置项）：<服务器地址>/wall 兜底
 *   服务端（发布器 → 静态目录 → nginx /wall/，登录令牌校验，无授权 401）
 *   → App 启动：**有完整缓存立即渲染（零等待）**；后台静默刷新，新照片下次启动生效
 *
 * v4（2026-10-11）：
 *   ① 主链路改为设置中的「播放代理地址」（未配置时走「服务器地址」）
 *   ② 缓存优先：complete 缓存直接使用，启动不再等待网络；首次/不完整才同步等待
 *   ③ 沿用 v3 的 401 自愈 / 超时预算 / 失败原因上报
 */
import type { ImageSourcePropType } from "react-native";
import * as FileSystem from "expo-file-system";
import { SettingsManager } from "@/services/storage";
import { api, getStoredAuthToken } from "@/services/api";

/**
 * 照片墙地址由设置推导（仓库不预置具体域名）：
 *   「播放代理地址」优先（通常是国内直连的加速入口），其次「服务器地址」兜底。
 */
async function getWallBases(): Promise<string[]> {
  const bases: string[] = [];
  try {
    const s = await SettingsManager.get();
    const proxy = (s?.vodProxyUrl || "").trim().replace(/\/+$/, "");
    if (proxy) bases.push(`${proxy}/wall`);
    const apiBase = (s?.apiBaseUrl || "").trim().replace(/\/+$/, "");
    if (apiBase) bases.push(`${apiBase}/wall`);
  } catch {
    /* ignore */
  }
  return Array.from(new Set(bases));
}
const WALL_DIR = (FileSystem.documentDirectory ?? "") + "wall/";
const STATE_FILE = WALL_DIR + "state.json";
const MANIFEST_TIMEOUT_MS = 7000;
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
  /** 命中可用链路的 base（供下载使用） */
  base?: string;
}

/** 依次尝试推导出的地址，返回第一个成功（200）或最先出现的 401；全失败返回 -1 */
async function fetchManifest(): Promise<ManifestResult> {
  let lastStatus = -1;
  const bases = await getWallBases();
  for (const base of bases) {
    try {
      const headers = await authHeaders();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), MANIFEST_TIMEOUT_MS);
      const res = await fetch(`${base}/manifest.json`, {
        signal: ctrl.signal,
        headers: { "Cache-Control": "no-cache", ...headers },
      });
      clearTimeout(timer);
      if (res.status === 401) {
        lastStatus = 401;
        continue; // 换备用链路再试；仍 401 才判定登录失效
      }
      if (!res.ok) {
        lastStatus = -1;
        continue;
      }
      const man = (await res.json()) as { updatedAt?: number; files?: string[] };
      if (!man || !man.updatedAt || !Array.isArray(man.files) || man.files.length === 0) {
        return { status: 200, base };
      }
      return { status: 200, updatedAt: man.updatedAt, files: man.files, base };
    } catch {
      lastStatus = lastStatus === 401 ? 401 : -1;
      continue;
    }
  }
  return { status: lastStatus === 401 ? 401 : -1 };
}

async function downloadAll(
  fileNames: string[],
  prefix: string,
  updatedAt: number,
  deadline: number,
  base: string
): Promise<string[]> {
  const ok: string[] = [];
  // 确保目标目录存在：全新安装时 documentDirectory/wall 不存在，
  // 若不先创建，downloadAsync 会因父目录缺失而全部失败（v1.4.3 及更早的 bug）
  try {
    await FileSystem.makeDirectoryAsync(WALL_DIR, { intermediates: true });
  } catch {
    /* 目录已存在或创建失败均继续，后续单张失败会自行兜底 */
  }
  const headers = await authHeaders();
  let idx = 0;
  const worker = async () => {
    while (idx < fileNames.length && Date.now() < deadline) {
      const f = fileNames[idx];
      idx += 1;
      const dst = WALL_DIR + prefix + f;
      try {
        await withTimeout(
          FileSystem.downloadAsync(`${base}/${f}?v=${updatedAt}`, dst, { headers }),
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

/** 一次完整同步：清单 → 下载新缺失 → 写状态。供首屏等待与后台静默刷新共用 */
async function syncFromServer(): Promise<WallResolution> {
  // 2) 拉清单；401 → 会话自愈 → 重试一次
  let man = await fetchManifest();
  if (man.status === 401) {
    const recovered = await api.triggerAuthRecovery();
    if (recovered) {
      man = await fetchManifest();
    }
  }
  if (man.status === 401) {
    return { kind: "panda", reason: "auth-401" };
  }
  if (man.status !== 200 || !man.files || !man.updatedAt || !man.base) {
    return { kind: "panda", reason: man.status === 200 ? "empty" : "timeout" };
  }

  const prefix = `v${man.updatedAt}_`;
  const local = await readState();

  // 3) 本地已是当前版本：完整 → 直接用；不完整 → 补齐
  if (local && local.updatedAt === man.updatedAt) {
    if (!local.complete) {
      const missing = man.files.filter((f) => !local.files.includes(prefix + f));
      if (missing.length > 0) {
        const deadline = Date.now() + REFRESH_BUDGET_MS;
        const gained = await downloadAll(missing, prefix, man.updatedAt, deadline, man.base);
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
  const gained = await downloadAll(man.files, prefix, man.updatedAt, deadline, man.base);
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
  return { kind: "panda", reason: "fetch-failed" };
}

/** 防止并发重复后台刷新 */
let syncing = false;

function kickBackgroundSync(): void {
  if (syncing) return;
  syncing = true;
  syncFromServer()
    .catch(() => undefined)
    .finally(() => {
      syncing = false;
    });
}

/**
 * 启动时解析照片墙结果：
 *   - 资格不足（未配置/未登录）→ panda + 原因
 *   - 已有完整缓存 → 立即 wall（零等待），后台静默刷新
 *   - 首次/不完整 → 等待一次同步；失败时退回可用缓存或 panda + 原因
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

  // 2) 缓存优先：完整缓存立即使用（启动零等待），后台静默刷新
  if (local && local.complete) {
    const cached = toSources(local.files);
    if (cached) {
      kickBackgroundSync();
      return { kind: "wall", sources: cached };
    }
  }

  // 3) 首次或不完整：等待一次同步；失败时退回部分缓存
  try {
    return await syncFromServer();
  } catch {
    const cached = toSources(local?.files);
    if (cached) return { kind: "wall", sources: cached };
    return { kind: "panda", reason: "fetch-failed" };
  }
}
