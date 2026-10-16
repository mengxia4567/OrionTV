import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * 本机源偏好（只影响这台设备，不改服务端配置）
 *
 * - hidden：在搜索结果 / 换源列表里隐藏这些源（服务端仍然会搜它们，
 *   但 `/api/search` 不支持按源过滤，所以「隐藏」是展示层的选择）
 * - preferred：优先选中的源（搜到它就用它做默认播放源，而不是清晰度最高的）
 */
export interface SourcePrefs {
  hidden: string[];
  preferred: string | null;
}

const KEY = "sourcePrefs";
let cache: SourcePrefs | null = null;
const listeners = new Set<() => void>();

const load = async (): Promise<SourcePrefs> => {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<SourcePrefs>) : {};
    cache = { hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [], preferred: parsed.preferred ?? null };
  } catch {
    cache = { hidden: [], preferred: null };
  }
  return cache!;
};

const persist = async (next: SourcePrefs) => {
  cache = next;
  listeners.forEach((fn) => fn());
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 忽略写入失败 */
  }
};

/** 同步读（渲染路径上用） */
export const getSourcePrefsSync = (): SourcePrefs => cache ?? { hidden: [], preferred: null };

export const primeSourcePrefs = async (): Promise<void> => {
  await load();
};

export const isSourceHidden = (key: string): boolean => getSourcePrefsSync().hidden.includes(key);

export const setSourceHidden = async (key: string, hidden: boolean): Promise<void> => {
  const p = await load();
  const next = new Set(p.hidden);
  if (hidden) next.add(key);
  else next.delete(key);
  await persist({ ...p, hidden: Array.from(next) });
};

export const setPreferredSource = async (key: string | null): Promise<void> => {
  const p = await load();
  await persist({ ...p, preferred: key });
};

export const subscribeSourcePrefs = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
