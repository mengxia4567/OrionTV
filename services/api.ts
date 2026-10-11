import AsyncStorage from "@react-native-async-storage/async-storage";

// region: --- Interface Definitions ---
export interface DoubanItem {
  title: string;
  poster: string;
  rate?: string;
}

export interface DoubanResponse {
  code: number;
  message: string;
  list: DoubanItem[];
}

export interface VideoDetail {
  id: string;
  title: string;
  poster: string;
  source: string;
  source_name: string;
  desc?: string;
  type?: string;
  year?: string;
  area?: string;
  director?: string;
  actor?: string;
  remarks?: string;
}

export interface SearchResult {
  id: number;
  title: string;
  poster: string;
  episodes: string[];
  source: string;
  source_name: string;
  class?: string;
  year: string;
  desc?: string;
  type_name?: string;
}

export interface Favorite {
  cover: string;
  title: string;
  source_name: string;
  total_episodes: number;
  search_title: string;
  year: string;
  save_time?: number;
}

export interface PlayRecord {
  title: string;
  source_name: string;
  cover: string;
  index: number;
  total_episodes: number;
  play_time: number;
  total_time: number;
  save_time: number;
  year: string;
}

export interface ApiSite {
  key: string;
  api: string;
  name: string;
  detail?: string;
}

export interface ServerConfig {
  SiteName: string;
  StorageType: "localstorage" | "redis" | string;
}

// region: --- Auth Token Storage ---
// 登录令牌以 Authorization 头作为认证主通道（比 cookie 在 RN 各平台上更可靠）。
// 服务端中间件优先读取该头，支持 "Token xxx" / "Bearer xxx" / 原始值三种形式。
export const AUTH_TOKEN_KEY = "authToken";

export async function getStoredAuthToken(): Promise<string | null> {
  try {
    const token = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
    return token && token.trim() ? token : null;
  } catch {
    return null;
  }
}

export async function setStoredAuthToken(token: string | null | undefined): Promise<void> {
  try {
    if (token && token.trim()) {
      await AsyncStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
    }
  } catch {
    // 忽略存储异常，不影响主流程
  }
}

export class API {
  public baseURL: string = "";

  // 会话失效自愈回调（由 authStore 注册：先续期、再静默重登）
  private onAuthRecovery: (() => Promise<boolean>) | null = null;

  constructor(baseURL?: string) {
    if (baseURL) {
      this.baseURL = baseURL;
    }
  }

  public setBaseUrl(url: string) {
    this.baseURL = url;
  }

  /** 点播流代理覆盖（可选）：设置后所有 m3u8 播放地址改为经该地址代理 */
  private vodProxyUrl = "";
  private vodProxyToken = "";

  public setVodProxy(url: string | null | undefined, token: string | null | undefined) {
    this.vodProxyUrl = (url || "").trim().replace(/\/+$/, "");
    this.vodProxyToken = (token || "").trim();
  }

  public setAuthRecoveryHandler(handler: (() => Promise<boolean>) | null) {
    this.onAuthRecovery = handler;
  }

  /** 供非 _fetch 链路（照片墙等）在遇到 401 时主动触发一次会话自愈（续期 → 静默重登） */
  public async triggerAuthRecovery(): Promise<boolean> {
    if (!this.onAuthRecovery) {
      return false;
    }
    try {
      return await this.onAuthRecovery();
    } catch {
      return false;
    }
  }

  private async _fetch(
    url: string,
    options: RequestInit & { skipAuth?: boolean; skipRecovery?: boolean } = {},
    retried = false
  ): Promise<Response> {
    if (!this.baseURL) {
      throw new Error("API_URL_NOT_SET");
    }

    const { skipAuth = false, skipRecovery = false, ...init } = options;

    const headers = new Headers(init.headers);
    if (!skipAuth) {
      const token = await getStoredAuthToken();
      if (token) {
        headers.set("Authorization", `Token ${token}`);
      }
    }

    const response = await fetch(`${this.baseURL}${url}`, { ...init, headers });

    if (response.status === 401) {
      // 令牌过期/失效：自动续期或静默重登一次，然后重试原请求
      if (!skipAuth && !skipRecovery && !retried && this.onAuthRecovery) {
        const recovered = await this.onAuthRecovery().catch(() => false);
        if (recovered) {
          return this._fetch(url, options, true);
        }
      }
      throw new Error("UNAUTHORIZED");
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response;
  }

  async login(username?: string | undefined, password?: string): Promise<{ ok: boolean; token?: string }> {
    const response = await this._fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      skipAuth: true,
    });

    // 存储cookie到AsyncStorage（兼容不支持 token 的服务端）
    const cookies = response.headers.get("Set-Cookie");
    if (cookies) {
      await AsyncStorage.setItem("authCookies", cookies);
    }

    const data = await response.json();
    // 保存响应体中的 token（认证主通道）
    if (data && typeof data.token === "string") {
      await setStoredAuthToken(data.token);
    }
    return data;
  }

  /**
   * 尝试续期当前会话（服务端从 Authorization 头读取当前令牌）。
   * 成功返回新令牌并持久化；失败返回 null（调用方回退到静默重登）。
   */
  async refreshToken(): Promise<string | null> {
    try {
      const response = await this._fetch("/api/auth/refresh", {
        method: "POST",
        skipRecovery: true,
      });
      const data = await response.json();
      if (data && typeof data.token === "string" && data.token) {
        await setStoredAuthToken(data.token);
        return data.token;
      }
      return null;
    } catch {
      return null;
    }
  }

  async logout(): Promise<{ ok: boolean }> {
    const response = await this._fetch("/api/logout", {
      method: "POST",
      skipRecovery: true,
    });
    await AsyncStorage.setItem("authCookies", '');
    await setStoredAuthToken(null);
    return response.json();
  }

  async getServerConfig(): Promise<ServerConfig> {
    const response = await this._fetch("/api/server-config");
    return response.json();
  }

  async getFavorites(key?: string): Promise<Record<string, Favorite> | Favorite | null> {
    const url = key ? `/api/favorites?key=${encodeURIComponent(key)}` : "/api/favorites";
    const response = await this._fetch(url);
    return response.json();
  }

  async addFavorite(key: string, favorite: Omit<Favorite, "save_time">): Promise<{ success: boolean }> {
    const response = await this._fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, favorite }),
    });
    return response.json();
  }

  async deleteFavorite(key?: string): Promise<{ success: boolean }> {
    const url = key ? `/api/favorites?key=${encodeURIComponent(key)}` : "/api/favorites";
    const response = await this._fetch(url, { method: "DELETE" });
    return response.json();
  }

  async getPlayRecords(): Promise<Record<string, PlayRecord>> {
    const response = await this._fetch("/api/playrecords");
    return response.json();
  }

  async savePlayRecord(key: string, record: Omit<PlayRecord, "save_time">): Promise<{ success: boolean }> {
    const response = await this._fetch("/api/playrecords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, record }),
    });
    return response.json();
  }

  async deletePlayRecord(key?: string): Promise<{ success: boolean }> {
    const url = key ? `/api/playrecords?key=${encodeURIComponent(key)}` : "/api/playrecords";
    const response = await this._fetch(url, { method: "DELETE" });
    return response.json();
  }

  async getSearchHistory(): Promise<string[]> {
    const response = await this._fetch("/api/searchhistory");
    return response.json();
  }

  async addSearchHistory(keyword: string): Promise<string[]> {
    const response = await this._fetch("/api/searchhistory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword }),
    });
    return response.json();
  }

  async deleteSearchHistory(keyword?: string): Promise<{ success: boolean }> {
    const url = keyword ? `/api/searchhistory?keyword=${keyword}` : "/api/searchhistory";
    const response = await this._fetch(url, { method: "DELETE" });
    return response.json();
  }

  getImageProxyUrl(imageUrl: string): string {
    return `${this.baseURL}/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
  }

  /**
   * 点播 m3u8 走服务端代理（服务端可 302 到媒体加速代理：多线程缓存 + 预取）。
   * 非 m3u8 / 未配置服务器地址时原样返回。
   */
  getVodProxyUrl(originalUrl: string): string {
    if (!originalUrl) {
      return originalUrl;
    }
    const lower = originalUrl.toLowerCase();
    if (!((lower.startsWith("http://") || lower.startsWith("https://")) && lower.includes(".m3u8"))) {
      return originalUrl;
    }
    const encoded = encodeURIComponent(originalUrl);
    // 优先使用「播放代理」设置（设置中自行填写地址与令牌，仓库不预置域名）
    if (this.vodProxyUrl) {
      const t = this.vodProxyToken ? `&t=${encodeURIComponent(this.vodProxyToken)}` : "";
      // .m3u8 结尾：ExoPlayer 依据路径扩展名识别 HLS；/api/proxy/vod/m3u8 不含扩展名会被当作普通视频解析而失败
      return `${this.vodProxyUrl}/api/proxy/vod/playlist.m3u8?url=${encoded}${t}`;
    }
    if (!this.baseURL) {
      return originalUrl;
    }
    // .m3u8 结尾：同上下载说明（43 nginx 已同步支持该路径）
    return `${this.baseURL}/api/proxy/vod/playlist.m3u8?url=${encoded}`;
  }

  async getDoubanData(
    type: "movie" | "tv",
    tag: string,
    pageSize: number = 16,
    pageStart: number = 0
  ): Promise<DoubanResponse> {
    const url = `/api/douban?type=${type}&tag=${encodeURIComponent(tag)}&pageSize=${pageSize}&pageStart=${pageStart}`;
    const response = await this._fetch(url);
    return response.json();
  }

  async searchVideos(query: string): Promise<{ results: SearchResult[] }> {
    const url = `/api/search?q=${encodeURIComponent(query)}`;
    const response = await this._fetch(url);
    return response.json();
  }

  async searchVideo(query: string, resourceId: string, signal?: AbortSignal): Promise<{ results: SearchResult[] }> {
    const url = `/api/search/one?q=${encodeURIComponent(query)}&resourceId=${encodeURIComponent(resourceId)}`;
    const response = await this._fetch(url, { signal });
    const { results } = await response.json();
    return { results: results.filter((item: any) => item.title === query )};
  }

  async getResources(signal?: AbortSignal): Promise<ApiSite[]> {
    const url = `/api/search/resources`;
    const response = await this._fetch(url, { signal });
    return response.json();
  }

  async getVideoDetail(source: string, id: string): Promise<VideoDetail> {
    const url = `/api/detail?source=${source}&id=${id}`;
    const response = await this._fetch(url);
    return response.json();
  }
}

// 默认实例
export let api = new API();

/** 从代理 URL 还原原始地址（非代理 URL 返回 null）—— 播放失败自愈用 */
export function unwrapVodProxyUrl(url: string): string | null {
  try {
    // 兼容旧路径 /api/proxy/vod/m3u8 与新路径 /api/proxy/vod/playlist.m3u8
    const m = url.match(/\/api\/proxy\/vod\/(?:playlist\.)?m3u8\?url=([^&]+)/);
    if (!m) {
      return null;
    }
    const decoded = decodeURIComponent(m[1]);
    return decoded.startsWith("http") ? decoded : null;
  } catch {
    return null;
  }
}
