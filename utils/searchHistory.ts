/**
 * 音乐搜索历史（本地存储，最多 12 条，去重置顶）
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "music_search_history_v1";

export async function getSearchHistory(): Promise<string[]> {
  try {
    const s = await AsyncStorage.getItem(KEY);
    const arr = s ? JSON.parse(s) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function pushSearchHistory(q: string): Promise<string[]> {
  const term = (q || "").trim();
  if (!term) return getSearchHistory();
  const cur = await getSearchHistory();
  const next = [term, ...cur.filter((x) => x !== term)].slice(0, 12);
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}
