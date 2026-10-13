/**
 * musicStore — 全局音乐播放引擎（电视端 / 手机端共用）
 *
 * 职责（v1.6.0 音乐重设计的地基）：
 *   - 播放内核：react-native-track-player（见 services/musicPlayer.ts）；RNTP 里始终只有当前一首
 *   - 播放队列（songs[] + index）与播放模式（loop / single / random）
 *   - 播放状态（进度/时长/缓冲/播放中/加载中）供任何组件订阅
 *   - 歌词加载与内存缓存；播放上报（尽力而为）；失败自动换源重试一次
 *
 * 生命周期：模块级单例（页面卸载不销毁声音）→ 实现「切页不断播」；
 *   迷你播放器 / 全屏播放器由 _layout 全局挂载并订阅本 store。
 *
 * 注意：播放器本身是原生单例，store 只订阅它的事件，不持有实例。
 */
import TrackPlayer, { Event } from "react-native-track-player";
import { create } from "zustand";
import Toast from "react-native-toast-message";

import { api, getStoredAuthToken } from "@/services/api";
import Logger from "@/utils/Logger";
import { parseLrc, LyricLine } from "@/utils/lyrics";
import { pickBestMatch, otherSource, sourceLabel } from "@/utils/musicSource";
import { mapPlayerState, isTransitionalState } from "@/utils/musicPlayerState";
import {
  ensureNotificationPermission,
  hasActiveTrack,
  isPlayerPlaying,
  loadAndPlay,
  pausePlayer,
  resetPlayer,
  resumePlayer,
  seekPlayer,
} from "@/services/musicPlayer";

const logger = Logger.withTag("MusicStore");

export type MusicPlayMode = "loop" | "single" | "random";
export type MusicQuality = "128k" | "320k";

export interface MusicSong {
  songId: string;
  source: string; // "wy" | "kw" | ...
  songmid?: string;
  name: string;
  artist: string;
  album?: string;
  cover?: string;
  durationText?: string;
  /** 续播起点（毫秒；来自播放历史 playProgressSec） */
  resumeMs?: number;
}

/* ---------------- 模块级单例（不进 state） ---------------- */
let playNoRetry = false; // 当前这首是否禁止「失败换源」（手动换源/换音质/重试路径）
let loadingNewTrack = false; // 正在换曲：忽略 reset 带来的 none/stopped 过渡态与迟到的「队列结束」事件
let lastRetryKey = ""; // 防止换源重试循环
let failToastKey = ""; // 同一首歌的「播放失败」提示只弹一次（防错误事件多次回调刷屏）
const lyricCache = new Map<string, string>(); // key: source:songId

async function authHeaders(): Promise<Record<string, string>> {
  try {
    const token = await getStoredAuthToken();
    return token ? { Authorization: `Token ${token}` } : {};
  } catch {
    return {};
  }
}

const songKey = (s: MusicSong) => `${s.source}:${s.songId}`;

/* ---------------- 播放进度上报（「续播」的唯一数据来源） ---------------- */
const REPORT_INTERVAL_MS = 10000; // 播放中每 10s 落一次
const MIN_PROGRESS_SEC = 5; // 首播不足 5s 不写进度（避免把"误点一下"记成续播点）

let progressTimer: ReturnType<typeof setInterval> | null = null;
let reportingKey = ""; // 正在上报的曲（切歌即换）
let completedKey = ""; // 刚自然播完的曲：切歌时不要再把尾声进度写回

function stopProgressReporting() {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
  reportingKey = "";
}

/** 把某一曲的进度写回服务端历史（失败静默，不影响播放） */
async function reportProgress(
  song: MusicSong,
  positionMs: number,
  durationMs: number,
  opts?: { force?: boolean }
) {
  const sec = Math.max(0, Math.round(positionMs / 1000));
  if (!opts?.force && sec < MIN_PROGRESS_SEC) return; // 未达阈值不写进度
  await api.saveMusicHistory({
    songId: song.songId,
    source: song.source,
    songmid: song.songmid,
    name: song.name,
    artist: song.artist,
    album: song.album,
    cover: song.cover,
    durationText: song.durationText,
    durationSec: durationMs ? Math.round(durationMs / 1000) : undefined,
    playProgressSec: sec,
    playedAt: Date.now(),
  });
}

/** 开播即入历史（不带进度 → 服务端保留原续播点），并启动节流上报 */
function startProgressReporting(
  song: MusicSong,
  get: () => { current: MusicSong | null; position: number; duration: number; isPlaying: boolean }
) {
  completedKey = "";
  void api.saveMusicHistory({
    songId: song.songId,
    source: song.source,
    songmid: song.songmid,
    name: song.name,
    artist: song.artist,
    album: song.album,
    cover: song.cover,
    durationText: song.durationText,
    playedAt: Date.now(),
  });
  reportingKey = songKey(song);
  progressTimer = setInterval(() => {
    const st = get();
    const cur = st.current;
    if (!cur || songKey(cur) !== reportingKey || !st.isPlaying) return;
    void reportProgress(cur, st.position, st.duration);
  }, REPORT_INTERVAL_MS);
}

/* ---------------- store ---------------- */
interface MusicStoreState {
  queue: MusicSong[];
  index: number;
  mode: MusicPlayMode;
  quality: MusicQuality;
  isPlaying: boolean;
  isBuffering: boolean;
  isLoading: boolean;
  position: number; // ms
  duration: number; // ms
  current: MusicSong | null;
  lyricText: string;
  /** 解析后的歌词行（随 lyricText 一次性解析，供各视图 O(log n) 定位） */
  lyricLines: LyricLine[];
  /** 全屏播放器开关（跨组件控制） */
  playerOpen: boolean;
  /** 跨组件搜索请求（如全屏播放器点歌手名 → 音乐搜索页），消费后置空 */
  searchRequest: string;

  setPlayerOpen: (v: boolean) => void;
  requestSearch: (q: string) => void;
  clearSearchRequest: () => void;
  moveQueueItem: (from: number, to: number) => void;
  removeFromQueue: (index: number) => Promise<void>;
  playQueue: (songs: MusicSong[], startIndex?: number) => Promise<void>;
  playAt: (i: number, opts?: { noRetry?: boolean }) => Promise<void>;
  toggle: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  seek: (ms: number) => Promise<void>;
  seekBy: (deltaMs: number) => Promise<void>;
  setMode: (m: MusicPlayMode) => void;
  setQuality: (q: MusicQuality) => Promise<void>;
  /** 手动切到另一平台的「同款」（wy ⇄ kw），保持当前播放进度 */
  switchSource: () => Promise<void>;
  stop: () => Promise<void>;
}

export const useMusicStore = create<MusicStoreState>((set, get) => {
  /** 自然播完 */
  const onFinish = async () => {
    const { mode, index } = get();
    // 播完：进度归零，避免下次"续播到结尾"；并标记以防切歌时把尾声进度写回
    const finished = get().current;
    if (finished) {
      completedKey = songKey(finished);
      void reportProgress(finished, 0, get().duration, { force: true });
    }
    if (mode === "single") {
      await get().playAt(index);
      return;
    }
    await get().next();
  };

  /** 加载歌词（带缓存；仅当前曲落地，防竞态） */
  const loadLyric = async (song: MusicSong) => {
    const key = songKey(song);
    const cached = lyricCache.get(key);
    if (cached !== undefined) {
      set({ lyricText: cached, lyricLines: parseLrc(cached) });
      return;
    }
    try {
      const { lyric } = await api.musicLyric(song);
      lyricCache.set(key, lyric || "");
      const cur = get().current;
      if (cur && songKey(cur) === key) {
        set({ lyricText: lyric || "", lyricLines: parseLrc(lyric || "") });
      }
    } catch {
      /* 歌词失败不影响播放 */
    }
  };

  /** 同一首歌的失败提示只弹一次 */
  const notifyPlayFailed = (song: MusicSong, text = "播放失败，请稍后再试") => {
    const k = songKey(song);
    if (failToastKey === k) return;
    failToastKey = k;
    Toast.show({ type: "error", text1: text });
  };

  /** 在另一平台找「同款」（名字+歌手+时长都对得上，否则 null）；已切歌则 null */
  const findSameSongElsewhere = async (song: MusicSong, target: "wy" | "kw") => {
    const res = await api.musicSearch(`${song.name} ${song.artist}`.trim(), target, 8);
    const list: any[] = res?.data?.list || [];
    return pickBestMatch(song, list);
  };

  /** 播放失败 → 换源（另一平台严格匹配同款）重试一次；找不到同款就明说，不乱切 */
  const maybeRetryOtherSource = async (song: MusicSong) => {
    const key = songKey(song);
    if (lastRetryKey === key) return;
    lastRetryKey = key;
    try {
      const other = otherSource(song.source);
      const match = await findSameSongElsewhere(song, other);
      const { queue, index, current } = get();
      if (!current || songKey(current) !== key) return; // 已经切歌，放弃
      if (!match?.songId) {
        notifyPlayFailed(song, `${sourceLabel(other)}未找到同款，请稍后再试`);
        return;
      }
      const fixed: MusicSong = { ...song, source: other, songId: match.songId, songmid: match.songmid };
      const nq = queue.slice();
      nq[index] = fixed;
      set({ queue: nq });
      Toast.show({ type: "info", text1: `以${sourceLabel(other)}音源重试` });
      await get().playAt(index, { noRetry: true });
    } catch {
      notifyPlayFailed(song);
    }
  };

  /* ---------------- 订阅 RNTP 事件（模块只创建一次 store，监听只注册一次） ---------------- */
  TrackPlayer.addEventListener(Event.PlaybackState, ({ state }) => {
    if (loadingNewTrack && isTransitionalState(state)) return;
    const ui = mapPlayerState(state);
    // 首次进入真实播放态 → 换曲完成
    if (state === "ready" || state === "playing" || state === "paused" || state === "buffering") {
      loadingNewTrack = false;
    }
    set({ isPlaying: ui.isPlaying, isBuffering: ui.isBuffering, isLoading: ui.isLoading });
  });

  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, ({ position, duration }) => {
    const patch: { position: number; duration?: number } = { position: Math.round(position * 1000) };
    if (duration > 0) patch.duration = Math.round(duration * 1000);
    set(patch);
  });

  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => {
    if (loadingNewTrack || !get().current) return;
    void onFinish();
  });

  TrackPlayer.addEventListener(Event.PlaybackError, (e) => {
    const song = get().current;
    if (!song) return;
    logger.warn("play error", e?.code, e?.message);
    loadingNewTrack = false;
    set({ isPlaying: false, isLoading: false, isBuffering: false });
    if (!playNoRetry) void maybeRetryOtherSource(song);
    else notifyPlayFailed(song);
  });

  return {
    queue: [],
    index: -1,
    mode: "loop",
    quality: "320k",
    isPlaying: false,
    isBuffering: false,
    isLoading: false,
    position: 0,
    duration: 0,
    current: null,
    lyricText: "",
    lyricLines: [],
    playerOpen: false,
    searchRequest: "",

    setPlayerOpen: (v) => set({ playerOpen: v }),

    requestSearch: (q) => set({ searchRequest: q }),
    clearSearchRequest: () => set({ searchRequest: "" }),

    /** 队列调序（上移/下移用）；自动跟随当前曲的新位置 */
    moveQueueItem: (from, to) => {
      const { queue, index } = get();
      if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return;
      const nq = queue.slice();
      const [it] = nq.splice(from, 1);
      nq.splice(to, 0, it);
      let ni = index;
      if (index === from) ni = to;
      else if (from < index && to >= index) ni = index - 1;
      else if (from > index && to <= index) ni = index + 1;
      set({ queue: nq, index: ni });
    },

    playQueue: async (songs, startIndex = 0) => {
      if (!songs.length) return;
      set({ queue: songs, index: startIndex });
      await get().playAt(startIndex);
    },

    /**
     * 从队列移除一首歌（主流音乐 App 标配；此前只有调序，没有删除）。
     * 移除的是当前正在播的曲：自动续播同一位置的下一首（即原来的下一曲）；
     * 队列移空：停止播放。移除的是其他曲：只调整 index，不打断播放。
     */
    removeFromQueue: async (idx) => {
      const { queue, index } = get();
      if (idx < 0 || idx >= queue.length) return;
      const nq = queue.slice();
      nq.splice(idx, 1);

      if (nq.length === 0) {
        await get().stop();
        return;
      }

      if (idx === index) {
        // 删的是当前曲：续播同一位置（原下一曲顶上来），越界则回到最后一首
        const ni = Math.min(idx, nq.length - 1);
        set({ queue: nq });
        await get().playAt(ni, { noRetry: true });
        return;
      }

      const ni = idx < index ? index - 1 : index;
      set({ queue: nq, index: ni });
    },

    playAt: async (i, opts) => {
      const { queue, quality } = get();
      const song = queue[i];
      if (!song) return;
      // 切歌前先把上一首的进度写回（续播数据来源）；刚自然播完的曲跳过（已写 0）
      const prev = get();
      if (
        prev.current &&
        songKey(prev.current) !== songKey(song) &&
        songKey(prev.current) !== completedKey
      ) {
        void reportProgress(prev.current, prev.position, prev.duration);
      }
      stopProgressReporting();
      const resumeTarget = song.resumeMs || 0; // 续播（来自播放历史）只执行一次
      lastRetryKey = ""; // 手动播新歌时重置重试闸
      failToastKey = "";
      playNoRetry = !!opts?.noRetry;
      loadingNewTrack = true;
      set({
        isLoading: true,
        index: i,
        current: song,
        lyricText: "",
        lyricLines: [],
        position: 0,
        duration: 0,
        isBuffering: true,
      });
      try {
        const uri = api.buildMusicStreamUrl(song, quality);
        const headers = await authHeaders();
        await loadAndPlay(
          {
            id: songKey(song),
            url: uri,
            headers,
            title: song.name,
            artist: song.artist,
            album: song.album,
            artwork: song.cover,
            durationText: song.durationText,
          },
          resumeTarget / 1000
        );
        if (resumeTarget > 0) {
          // 清掉队列中的续播标记（避免重复 seek）
          const q2 = get().queue.slice();
          if (q2[i]) {
            delete (q2[i] as { resumeMs?: number }).resumeMs;
            set({ queue: q2 });
          }
        }
        void ensureNotificationPermission();
        void loadLyric(song);
        if (!opts?.noRetry) void api.musicPlayReport(song);
        startProgressReporting(song, get);
      } catch (e) {
        logger.error("play failed", e);
        loadingNewTrack = false;
        set({ isLoading: false, isPlaying: false, isBuffering: false });
        if (!opts?.noRetry) void maybeRetryOtherSource(song);
        else notifyPlayFailed(song);
      }
    },

    toggle: async () => {
      if (!(await hasActiveTrack())) {
        const { queue, index, current } = get();
        if (current && index >= 0) await get().playAt(index);
        else if (queue.length) await get().playAt(0);
        return;
      }
      if (await isPlayerPlaying()) await get().pause();
      else await get().resume();
    },

    pause: async () => {
      try {
        await pausePlayer();
        const cur = get().current;
        if (cur) void reportProgress(cur, get().position, get().duration);
      } catch {
        /* ignore */
      }
    },

    resume: async () => {
      if (!(await hasActiveTrack())) {
        const { queue, index, current } = get();
        if (current && index >= 0) await get().playAt(index);
        else if (queue.length) await get().playAt(0);
        return;
      }
      try {
        await resumePlayer();
      } catch {
        /* ignore */
      }
    },

    next: async () => {
      const { queue, index, mode } = get();
      if (!queue.length) return;
      let n: number;
      if (mode === "random" && queue.length > 1) {
        do {
          n = Math.floor(Math.random() * queue.length);
        } while (n === index);
      } else {
        n = (index + 1) % queue.length;
      }
      await get().playAt(n);
    },

    prev: async () => {
      const { queue, index, mode } = get();
      if (!queue.length) return;
      let n: number;
      if (mode === "random" && queue.length > 1) {
        do {
          n = Math.floor(Math.random() * queue.length);
        } while (n === index);
      } else {
        n = (index - 1 + queue.length) % queue.length;
      }
      await get().playAt(n);
    },

    seek: async (ms) => {
      try {
        set({ position: Math.max(0, ms) }); // 乐观更新，避免拖完进度条先弹回旧位置
        await seekPlayer(Math.max(0, ms) / 1000);
      } catch {
        /* ignore */
      }
    },

    seekBy: async (deltaMs) => {
      const { position, duration } = get();
      const target = Math.max(0, Math.min(position + deltaMs, duration || Infinity));
      await get().seek(target);
    },

    setMode: (m) => set({ mode: m }),

    switchSource: async () => {
      const { current, index, position } = get();
      if (!current || index < 0) return;
      const target = otherSource(current.source);
      Toast.show({ type: "info", text1: `正在切换到${sourceLabel(target)}…` });
      try {
        const match = await findSameSongElsewhere(current, target);
        const cur2 = get().current;
        if (!cur2 || songKey(cur2) !== songKey(current)) return; // 期间已切歌
        if (!match?.songId) {
          Toast.show({ type: "error", text1: `${sourceLabel(target)}未找到同款` });
          return;
        }
        const fixed: MusicSong = {
          ...current,
          source: target,
          songId: match.songId,
          songmid: match.songmid,
          // 保持进度：超过 3 秒才续（刚开播就切，从头放更自然）
          resumeMs: position > 3000 ? position : 0,
        };
        const nq = get().queue.slice();
        nq[get().index] = fixed;
        set({ queue: nq });
        await get().playAt(get().index, { noRetry: true });
      } catch {
        Toast.show({ type: "error", text1: "切换音源失败，请稍后再试" });
      }
    },

    setQuality: async (q) => {
      const { quality, current, index } = get();
      if (q === quality) return;
      set({ quality: q });
      if (current && index >= 0) await get().playAt(index, { noRetry: true });
    },

    stop: async () => {
      const prevState = get();
      if (prevState.current) {
        void reportProgress(prevState.current, prevState.position, prevState.duration);
      }
      stopProgressReporting();
      loadingNewTrack = false;
      await resetPlayer();
      set({
        isPlaying: false,
        isBuffering: false,
        isLoading: false,
        position: 0,
        duration: 0,
        current: null,
        index: -1,
        lyricText: "",
        lyricLines: [],
      });
    },
  };
});
