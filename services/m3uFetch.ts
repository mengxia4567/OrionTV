import Logger from "@/utils/Logger";
import { SettingsManager } from "@/services/storage";
import { api, getStoredAuthToken } from "@/services/api";
import { parseM3U, Channel } from "@/services/m3u";

const logger = Logger.withTag("M3UFetch");

/** 取 URL 的 origin（协议+主机+端口），解析失败返回空串 */
function originOf(u: string): string {
  const m = (u || "").trim().match(/^(https?:\/\/[^/?#]+)/i);
  return m ? m[1].toLowerCase() : "";
}

/**
 * 直播源清单已不再公开（服务端校验登录令牌）。
 * 仅当直播源地址与「播放代理 / 服务器地址」同源时才附带令牌，
 * 避免用户填了第三方订阅地址时把登录令牌发给别人。
 */
async function buildAuthHeaders(m3uUrl: string): Promise<Record<string, string>> {
  try {
    const s = await SettingsManager.get();
    const target = originOf(m3uUrl);
    const trusted = [s?.vodProxyUrl, s?.apiBaseUrl].map((x) => originOf(x || "")).filter(Boolean);
    if (!target || !trusted.includes(target)) return {};
    const token = await getStoredAuthToken();
    return token ? { Authorization: `Token ${token}` } : {};
  } catch {
    return {};
  }
}

export const fetchAndParseM3u = async (m3uUrl: string): Promise<Channel[]> => {
  try {
    let response = await fetch(m3uUrl, { headers: await buildAuthHeaders(m3uUrl) });
    if (response.status === 401) {
      // 令牌过期：走统一会话自愈（续期 / 静默重登），成功后重试一次
      const recovered = await api.triggerAuthRecovery().catch(() => false);
      if (recovered) {
        response = await fetch(m3uUrl, { headers: await buildAuthHeaders(m3uUrl) });
      }
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch M3U: ${response.status} ${response.statusText}`);
    }
    const m3uText = await response.text();
    return parseM3U(m3uText);
  } catch (error) {
    logger.info("Error fetching or parsing M3U:", error);
    return []; // Return empty array on error
  }
};
