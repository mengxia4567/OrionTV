import { SettingsManager } from "@/services/storage";
import { buildAuthHeaders } from "@/services/m3uFetch";
import { api, getStoredAuthToken } from "@/services/api";

/**
 * 点播源元数据（服务端巡检结果）
 *
 * 162 每 6 小时巡检一次：43 视角体检（搜索命中 / 延迟 / 集数 / 清晰度）+ 只启用最快的
 * 10 个源，结果发布在 `<直播源同源>/vod/sources.json`（需登录令牌，与直播清单同一套鉴权）。
 * App 读它来做「源管理」页，因此不需要自己探测就能看到每个源的健康与延迟。
 */
export interface VodSourceMeta {
  key: string;
  name: string;
  api: string;
  enabled: boolean;
  proxy_mode: boolean;
  ok: boolean | null;
  latency_ms: number | null;
  episodes: number | null;
  resolution: string | null;
  rank: number | null;
}

export interface VodSourceMetaDoc {
  updated_at: string;
  count: number;
  enabled: number;
  sources: VodSourceMeta[];
}

/** 从「直播源地址」推导元数据地址（同源同令牌） */
export const vodMetaUrlOf = (m3uUrl: string): string => {
  const m = (m3uUrl || "").trim().match(/^(https?:\/\/[^/?#]+)/i);
  return m ? `${m[1]}/vod/sources.json` : "";
};

/** 自有域名：这些主机上带令牌是安全的（直播清单/媒体代理同一套令牌） */
const OWN_HOSTS = ["live.121214.xyz", "video.121214.xyz", "live.137621.xyz"];

const headersFor = async (url: string): Promise<Record<string, string>> => {
  const h = await buildAuthHeaders(url);
  if (Object.keys(h).length) return h;
  // 直播源没配「播放代理」时 buildAuthHeaders 会拒绝带令牌（避免发给第三方订阅）；
  // 但若目标是我们自有域名，就补上令牌，否则源管理页读不到数据。
  try {
    const host = (url.match(/^https?:\/\/([^/?#]+)/i)?.[1] || "").toLowerCase();
    if (OWN_HOSTS.includes(host)) {
      const token = await getStoredAuthToken();
      return token ? { Authorization: `Token ${token}` } : {};
    }
  } catch {
    /* ignore */
  }
  return {};
};

export const fetchVodSourceMeta = async (): Promise<VodSourceMetaDoc | null> => {
  const s = await SettingsManager.get();
  const url = vodMetaUrlOf(s?.m3uUrl || "");
  if (!url) return null;
  let res = await fetch(url, { headers: await headersFor(url) });
  if (res.status === 401) {
    // 与直播清单一致：令牌过期时走统一会话自愈（续期 / 静默重登），成功后重试一次
    const recovered = await api.triggerAuthRecovery().catch(() => false);
    if (recovered) {
      res = await fetch(url, { headers: await headersFor(url) });
    }
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const doc = (await res.json()) as VodSourceMetaDoc;
  return doc;
};
