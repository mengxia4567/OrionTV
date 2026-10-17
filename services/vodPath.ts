import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * 点播播放链路偏好（按源记忆，**手动选择**）
 *
 * 背景：同一部剧在不同源上，**客户端直连 CDN** 与 **经媒体代理** 谁快并不固定，
 * 而 App 侧的一次测速（尤其电视的弱网/WiFi）经常高估直连：显示速度不错，实际播放持续缓冲。
 * 所以不再自动选路：默认走代理，播放页可手动切直连/代理，选择按源记住。
 */
export type VodPath = "direct" | "proxy";

// v2：v1 是「自动测速选路」时期写入的结论（电视上常把直连判成更快），升级后不再沿用；
// 新键只保存用户手动选择，未选过一律默认代理。
const KEY = "vodPathPrefsV2";

let cache: Record<string, VodPath> | null = null;

const load = async (): Promise<Record<string, VodPath>> => {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as Record<string, VodPath>) : {};
  } catch {
    cache = {};
  }
  return cache!;
};

/** 同步读取（播放路径上使用；未加载时为默认值） */
export const getVodPathSync = (source: string): VodPath => {
  if (!source) return "proxy";
  return cache?.[source] ?? "proxy";
};

export const getVodPath = async (source: string): Promise<VodPath> => {
  const p = await load();
  return p[source] ?? "proxy";
};

/** 同步写入（播放中切换要立刻生效）：先改内存缓存，再异步落盘 */
export const setVodPathSync = (source: string, mode: VodPath): void => {
  if (!source) return;
  cache = { ...(cache ?? {}), [source]: mode };
  AsyncStorage.setItem(KEY, JSON.stringify(cache)).catch(() => undefined);
};

export const setVodPath = async (source: string, mode: VodPath): Promise<void> => {
  const p = await load();
  if (p[source] === mode) return;
  p[source] = mode;
  cache = p;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 忽略写入失败 */
  }
};

export const primeVodPathPrefs = async (): Promise<void> => {
  await load();
};
