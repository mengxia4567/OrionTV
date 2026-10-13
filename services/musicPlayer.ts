/**
 * musicPlayer — react-native-track-player（RNTP 4.x）的薄封装。
 *
 * 为什么换内核：expo-av 没有 MediaSession，做不了通知栏 / 锁屏 / 耳机线控；RNTP 用系统
 * MediaSession + 前台服务承载播放，页面切走、息屏都不断播，并自带通知卡片与锁屏控制。
 *
 * 约定（保持 musicStore 原有设计不变）：
 *   - 队列 / 播放模式 / 换源 / 续播 / 进度上报仍由 musicStore 自己管；
 *   - RNTP 里**始终只有一首曲**（`reset → add → play`），上一首/下一首由通知栏事件回调 store 决定。
 *
 * ⚠️ 本文件会 import 原生模块，Jest 里请 mock；纯逻辑放在 utils/musicPlayerState.ts。
 */
import TrackPlayer, { AppKilledPlaybackBehavior, Capability } from "react-native-track-player";

import { parseDurationText } from "@/utils/musicPlayerState";

export interface PlayableTrack {
  /** 唯一 id（source:songId） */
  id: string;
  url: string;
  headers?: Record<string, string>;
  title: string;
  artist: string;
  album?: string;
  artwork?: string;
  /** "03:51" 之类，用来让通知栏进度条在拿到真实时长前就有刻度 */
  durationText?: string;
}

let setupPromise: Promise<void> | null = null;

/** 初始化播放器（只做一次；热重载 / 服务已存在时的「already initialized」视为成功） */
export function ensurePlayerReady(): Promise<void> {
  if (setupPromise) return setupPromise;
  setupPromise = (async () => {
    try {
      await TrackPlayer.setupPlayer({ autoHandleInterruptions: true, waitForBuffer: true });
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? e);
      if (!/already.*initiali[sz]ed/i.test(msg)) {
        setupPromise = null; // 失败允许下次重试
        throw e;
      }
    }
    await TrackPlayer.updateOptions({
      android: {
        // 用户从最近任务划掉 App：停止播放并移除通知（不留「僵尸」通知）
        appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
      },
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.SeekTo,
      ],
      compactCapabilities: [Capability.SkipToPrevious, Capability.Play, Capability.SkipToNext],
      progressUpdateEventInterval: 0.5,
    });
  })();
  return setupPromise;
}

/** 载入并开始播放一首曲（会先清空上一首）。resumeSec > 0 时在开播前定位到续播点。 */
export async function loadAndPlay(track: PlayableTrack, resumeSec = 0): Promise<void> {
  await ensurePlayerReady();
  await TrackPlayer.reset();
  await TrackPlayer.add({
    id: track.id,
    url: track.url,
    headers: track.headers,
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork: track.artwork,
    duration: parseDurationText(track.durationText),
  });
  if (resumeSec > 0) {
    try {
      await TrackPlayer.seekTo(resumeSec);
    } catch {
      /* 续播定位失败就从头放 */
    }
  }
  await TrackPlayer.play();
}

export async function pausePlayer(): Promise<void> {
  await TrackPlayer.pause();
}

export async function resumePlayer(): Promise<void> {
  await TrackPlayer.play();
}

export async function seekPlayer(sec: number): Promise<void> {
  await TrackPlayer.seekTo(Math.max(0, sec));
}

export async function resetPlayer(): Promise<void> {
  try {
    await TrackPlayer.reset();
  } catch {
    /* 播放器尚未初始化时 reset 会抛错，忽略 */
  }
}

/** 当前是否有已装载的曲（用于「暂停后点播放」还是「重新开播」的判断） */
export async function hasActiveTrack(): Promise<boolean> {
  try {
    return (await TrackPlayer.getActiveTrack()) != null;
  } catch {
    return false;
  }
}

export async function isPlayerPlaying(): Promise<boolean> {
  try {
    const { state } = await TrackPlayer.getPlaybackState();
    return state === "playing" || state === "buffering" || state === "loading";
  } catch {
    return false;
  }
}
