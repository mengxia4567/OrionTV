import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * 直播链路偏好（按频道记忆）：relay = 走 162 中继（列表默认），direct = 直连源站
 *
 * 为什么直播也做这件事：
 *  - 列表里给的是中继地址（服务器按 162 的实测质量选源），默认就该走中继；
 *  - 但**用户自己的网络到源站可能更好**，也可能 162 到该源恰好在抖 —— 所以
 *    留一条「直连」退路：中继失败时自动试直连，并把结论按频道记住。
 *
 * 注意：带 ua / ref 参数的源（官方流要校验 Referer/UA）**不能直连**，
 * 客户端发不出这些头，只能走中继；liveOriginOf() 会一并返回该标记。
 */
export type LivePath = "relay" | "direct";

const KEY = "livePathPrefs";

let cache: Record<string, LivePath> | null = null;

export const primeLivePathPrefs = async (): Promise<void> => {
  if (cache) return;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as Record<string, LivePath>) : {};
  } catch {
    cache = {};
  }
};

export const getLivePathSync = (channel: string): LivePath => {
  if (!channel) return "relay";
  return cache?.[channel] ?? "relay";
};

export const setLivePath = async (channel: string, path: LivePath): Promise<void> => {
  if (!channel) return;
  await primeLivePathPrefs();
  const p = cache ?? {};
  if (p[channel] === path) return;
  p[channel] = path;
  cache = p;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 忽略写入失败 */
  }
};

export interface LiveOriginInfo {
  /** 中继地址里解出的原始源地址；不是中继地址则为 null */
  origin: string | null;
  /** 该源是否要求 UA / Referer（要求则不能直连） */
  needsHeaders: boolean;
}

/** 从直播中继地址里解析出源地址与「是否必须走中继」 */
export const liveOriginOf = (url: string | null | undefined): LiveOriginInfo => {
  if (!url) return { origin: null, needsHeaders: false };
  try {
    const u = new URL(url);
    if (!u.pathname.startsWith("/livep/")) return { origin: null, needsHeaders: false };
    const origin = u.searchParams.get("url");
    const ua = u.searchParams.get("ua");
    const ref = u.searchParams.get("ref");
    const needsHeaders = Boolean(ref) || Boolean(ua && ua !== "ExoPlayerLib/2.18.1");
    return { origin: origin || null, needsHeaders };
  } catch {
    return { origin: null, needsHeaders: false };
  }
};
