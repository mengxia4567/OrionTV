import AsyncStorage from "@react-native-async-storage/async-storage";

/** 单次 API 请求的超时（不含调用方自带的 signal）：避免弱网/错地址无限等待 */
const REQUEST_TIMEOUT_MS = 15000;

/** 这些图源国内直连会被防盗链或墙，必须经服务端图片代理 */
const PROXY_IMAGE_HOSTS = [
  "doubanio.com",
  "douban.com",
  "tmdb.org",
  "bgm.tv",
  "bangumi.tv",
  "bangumi.lol",
];

function needsImageProxy(imageUrl: string): boolean {
  try {
    const host = new URL(imageUrl).hostname.toLowerCase();
    return PROXY_IMAGE_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

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

/**
 * 内存令牌缓存：`<Image>` 的 source 不能 await，必须同步拿到令牌。
 * 读/写令牌的两处入口都会刷新它，正常流程（启动登录态检查）已提前填充。
 */
let cachedAuthToken: string | null = null;

/** 已登录时返回令牌（同步）；未登录/尚未读取时返回 null */
export function getCachedAuthToken(): string | null {
  return cachedAuthToken;
}

export async function getStoredAuthToken(): Promise<string | null> {
  try {
    const token = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
    cachedAuthToken = token && token.trim() ? token : null;
    return cachedAuthToken;
  } catch {
    return cachedAuthToken;
  }
}

export async function setStoredAuthToken(token: string | null | undefined): Promise<void> {
  const next = token && token.trim() ? token : null;
  cachedAuthToken = next;
  try {
    if (next) {
      await AsyncStorage.setItem(AUTH_TOKEN_KEY, next);
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
    options: RequestInit & { skipAuth?: boolean; skipRecovery?: boolean; timeoutMs?: number } = {},
    retried = false
  ): Promise<Response> {
    if (!this.baseURL) {
      throw new Error("API_URL_NOT_SET");
    }

    const { skipAuth = false, skipRecovery = false, timeoutMs, ...init } = options;
    const timeout = timeoutMs ?? REQUEST_TIMEOUT_MS;

    const headers = new Headers(init.headers);
    if (!skipAuth) {
      const token = await getStoredAuthToken();
      if (token) {
        headers.set("Authorization", `Token ${token}`);
      }
    }

    // 未显式传入 signal 时自带超时：坏网络/错地址不再无限挂起（此前保存与首屏会一直等）
    const controller = init.signal ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
    let response: Response;
    try {
      response = await fetch(`${this.baseURL}${url}`, {
        ...init,
        headers,
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch (error) {
      if (controller?.signal.aborted) {
        throw new Error("TIMEOUT");
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }

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
    // 保存设置时会顺带刷新：这里用短超时，服务器地址填错时不要长期挂住
    const response = await this._fetch("/api/server-config", { timeoutMs: 8000 });
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
   * 海报图片源：
   *  - 豆瓣 / TMDB / Bangumi 的图国内直连会被防盗链或墙（418/403/超时）→ 走服务端图片代理，并带登录令牌
   *  - 其它源站封面本来就能直连，保持原样（走代理反而会被豆瓣 Referer 影响）
   * `<Image>` 的 source 不能 await，所以用内存缓存的令牌；未登录时只返回 uri（服务端会 401）。
   */
  getImageSource(imageUrl: string): {
    uri: string;
    headers?: Record<string, string>;
  } {
    if (!needsImageProxy(imageUrl)) {
      return { uri: imageUrl };
    }
    const uri = this.getImageProxyUrl(imageUrl);
    const token = getCachedAuthToken();
    return token ? { uri, headers: { Authorization: `Token ${token}` } } : { uri };
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

  // ===== 音乐（MoonTVPlus 音乐模块；后端在服务器侧配置，App 无需额外设置） =====
  async musicSearch(q: string, source = "kw", limit = 40): Promise<any> {
    const response = await this._fetch(
      `/api/music/v2/search?q=${encodeURIComponent(q)}&source=${source}&type=song&page=1&limit=${limit}`
    );
    return response.json();
  }

  async musicHotSearch(source = "kw"): Promise<any> {
    const response = await this._fetch(
      `/api/music/v2/discovery/hot-search?source=${source}`
    );
    return response.json();
  }

  /** 构建音乐流地址（expo-av 播放时需另附 Authorization 头） */
  buildMusicStreamUrl(
    song: {
      source: string;
      songId: string;
      songmid?: string;
      name?: string;
      artist?: string;
      durationText?: string;
    },
    quality = "320k"
  ): string {
    const parts = [
      `source=${encodeURIComponent(song.source)}`,
      `songId=${encodeURIComponent(song.songId)}`,
      song.songmid ? `songmid=${encodeURIComponent(song.songmid)}` : "",
      song.name ? `name=${encodeURIComponent(song.name)}` : "",
      song.artist ? `artist=${encodeURIComponent(song.artist)}` : "",
      song.durationText ? `durationText=${encodeURIComponent(song.durationText)}` : "",
      `quality=${encodeURIComponent(quality)}`,
    ].filter(Boolean);
    return `${this.baseURL}/api/music/v2/stream?${parts.join("&")}`;
  }

  // ===== 音乐 · 发现（榜单 / 歌单 / 歌手 / 专辑） =====
  /** 排行榜列表 */
  async musicBoards(source = "wy"): Promise<any> {
    const response = await this._fetch(`/api/music/v2/discovery/boards?source=${source}`);
    return response.json();
  }

  /** 榜单歌曲 */
  async musicBoardSongs(source: string, boardId: string, page = 1): Promise<any> {
    const response = await this._fetch(
      `/api/music/v2/discovery/board-songs?source=${source}&boardId=${encodeURIComponent(boardId)}&page=${page}`
    );
    return response.json();
  }

  /** 推荐歌单广场 */
  async musicSonglists(source = "wy", page = 1, tagId = "", sortId = "hot"): Promise<any> {
    const parts = [`source=${source}`, `page=${page}`, `sortId=${encodeURIComponent(sortId)}`];
    if (tagId) parts.push(`tagId=${encodeURIComponent(tagId)}`);
    const response = await this._fetch(`/api/music/v2/discovery/songlists?${parts.join("&")}`);
    return response.json();
  }

  /** 歌单标签（分类） */
  async musicSonglistTags(source = "wy"): Promise<any> {
    const response = await this._fetch(`/api/music/v2/discovery/songlist-tags?source=${source}`);
    return response.json();
  }

  /** 歌单详情（含歌曲列表） */
  async musicSonglistDetail(source: string, id: string, page = 1): Promise<any> {
    const response = await this._fetch(
      `/api/music/v2/discovery/songlist-detail?source=${source}&id=${encodeURIComponent(id)}&page=${page}`
    );
    return response.json();
  }

  /** 歌手歌曲 */
  async musicArtistSongs(source: string, id: string, order = "hot"): Promise<any> {
    const response = await this._fetch(
      `/api/music/v2/discovery/artist-songs?source=${source}&id=${encodeURIComponent(id)}&order=${order}`
    );
    return response.json();
  }

  /** 专辑歌曲 */
  async musicAlbumSongs(source: string, id: string): Promise<any> {
    const response = await this._fetch(
      `/api/music/v2/discovery/album-songs?source=${source}&id=${encodeURIComponent(id)}`
    );
    return response.json();
  }

  // ===== 音乐 · 歌词 / 我的 / 历史 =====
  /** 歌词（LRC 文本；tlyric 为翻译，可能为空） */
  async musicLyric(song: {
    source: string;
    songId: string;
    songmid?: string;
    name?: string;
    artist?: string;
    durationText?: string;
  }): Promise<{ lyric: string; tlyric: string }> {
    const response = await this._fetch(`/api/music/v2/lyric`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ song }),
    });
    const j = await response.json().catch(() => ({} as any));
    const d = j?.data || {};
    return { lyric: d.lyric || "", tlyric: d.tlyric || "" };
  }

  /** 我的歌单列表 */
  async musicPlaylists(): Promise<any> {
    const response = await this._fetch(`/api/music/v2/playlists`);
    return response.json();
  }

  /** 创建歌单 */
  async musicPlaylistCreate(name: string, description?: string): Promise<any> {
    const response = await this._fetch(`/api/music/v2/playlists`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    return response.json();
  }

  /** 编辑歌单（改名/描述） */
  async musicPlaylistUpdate(
    playlistId: string,
    patch: { name?: string; description?: string }
  ): Promise<any> {
    const response = await this._fetch(
      `/api/music/v2/playlists/${encodeURIComponent(playlistId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }
    );
    return response.json();
  }

  /** 歌单歌曲列表 */
  async musicPlaylistSongs(playlistId: string): Promise<any> {
    const response = await this._fetch(
      `/api/music/v2/playlists/${encodeURIComponent(playlistId)}/songs`
    );
    return response.json();
  }

  /** 歌曲加入歌单 */
  async musicPlaylistAddSong(
    playlistId: string,
    song: {
      source: string;
      songId: string;
      songmid?: string;
      name: string;
      artist: string;
      album?: string;
      cover?: string;
      durationText?: string;
    }
  ): Promise<any> {
    const response = await this._fetch(
      `/api/music/v2/playlists/${encodeURIComponent(playlistId)}/songs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ song }),
      }
    );
    return response.json();
  }

  /** 从歌单移除歌曲 */
  async musicPlaylistRemoveSong(playlistId: string, songId: string): Promise<any> {
    const response = await this._fetch(
      `/api/music/v2/playlists/${encodeURIComponent(playlistId)}/songs?songId=${encodeURIComponent(songId)}`,
      { method: "DELETE" }
    );
    return response.json();
  }

  /** 删除歌单 */
  async musicPlaylistDelete(playlistId: string): Promise<any> {
    const response = await this._fetch(
      `/api/music/v2/playlists/${encodeURIComponent(playlistId)}`,
      { method: "DELETE" }
    );
    return response.json();
  }

  /** 播放历史（records） */
  async musicHistory(): Promise<any> {
    const response = await this._fetch(`/api/music/v2/history`);
    return response.json();
  }

  /**
   * 播放历史入库（含播放进度）——「续播」的数据来源。
   * 不带 playProgressSec 时服务端保留原值（用于开播时"确保入历史"而不冲掉续播点）。
   * 尽力而为：失败不影响播放。
   */
  async saveMusicHistory(record: {
    songId: string;
    source: string;
    songmid?: string;
    name: string;
    artist: string;
    album?: string;
    cover?: string;
    durationText?: string;
    durationSec?: number;
    playProgressSec?: number;
    playedAt?: number;
  }): Promise<any> {
    try {
      const response = await this._fetch(`/api/music/v2/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record: { ...record, playedAt: record.playedAt ?? Date.now() } }),
      });
      return await response.json().catch(() => null);
    } catch {
      return null;
    }
  }

  /** 播放上报（尽力而为：失败不影响播放） */
  async musicPlayReport(song: {
    source: string;
    songId: string;
    songmid?: string;
    name?: string;
    artist?: string;
    album?: string;
    cover?: string;
    durationText?: string;
  }): Promise<any> {
    try {
      const response = await this._fetch(`/api/music/v2/play`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ song, playedAt: Date.now() }),
      });
      return await response.json().catch(() => null);
    } catch {
      return null;
    }
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
    // 全源搜索由服务端逐个源查，耗时远高于普通接口
    const response = await this._fetch(url, { timeoutMs: 45000 });
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
