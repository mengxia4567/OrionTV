import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * 点播播放链路偏好（按源记忆）
 *
 * 背景：同一部剧在不同源上，**客户端直连 CDN** 与 **经媒体代理** 谁快并不固定
 * （取决于源站 CDN、运营商、代理机器位置）。服务器侧测不出你设备的真实情况，
 * 所以在 App 里实测两条链路，谁快用谁，并按源记住结论。
 */
export type VodPath = "direct" | "proxy";

const KEY = "vodPathPrefs";

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
