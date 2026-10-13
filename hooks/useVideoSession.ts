import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { Audio } from "expo-av";
import {
  onVideoSessionAction,
  startVideoSession,
  stopVideoSession,
  updateVideoSession,
  videoSessionAvailable,
} from "../modules/video-session";
import { ensureNotificationPermission } from "@/utils/notificationPermission";

interface Options {
  /** 页面是否应该有通知栏卡片（聚焦且有内容在播） */
  enabled: boolean;
  title: string;
  subtitle: string;
  artwork?: string | null;
  /** 能否上一集/下一集（点播）或上一台/下一台（直播） */
  canSkip: boolean;
  isLive: boolean;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  rate: number;
  onPlay: () => void;
  onPause: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  onSeek?: (ms: number) => void;
}

/** 状态同步的最小间隔：进度走动超过 1 秒、或播放/暂停翻转才通知系统，避免每帧刷新 */
const POSITION_SYNC_MS = 1000;

/**
 * 点播 / 直播的通知栏卡片 + 锁屏控制 + 耳机线控（手机、平板；电视不处理）。
 * 画面由 expo-av 播放，这里只把状态同步给系统媒体会话，并把通知按钮转回播放动作。
 */
export function useVideoSession(o: Options) {
  const supported = Platform.OS === "android" && !Platform.isTV && videoSessionAvailable;
  const active = supported && o.enabled && !!o.title;
  const latest = useRef(o);
  latest.current = o;
  const last = useRef<{ playing: boolean | null; pos: number }>({ playing: null, pos: -POSITION_SYNC_MS * 2 });

  // 会话生命周期：开始 → 允许后台恢复播放（通知栏点播放时 App 可能在后台）→ 结束时还原
  useEffect(() => {
    if (!active) return;
    void ensureNotificationPermission();
    void Audio.setAudioModeAsync({ staysActiveInBackground: true }).catch(() => {});
    const off = onVideoSessionAction((e) => {
      const h = latest.current;
      if (e.action === "play") h.onPlay();
      else if (e.action === "pause") h.onPause();
      else if (e.action === "next") h.onNext?.();
      else if (e.action === "prev") h.onPrev?.();
      else if (e.action === "seek" && e.positionMs >= 0) h.onSeek?.(e.positionMs);
    });
    return () => {
      off();
      stopVideoSession();
      void Audio.setAudioModeAsync({ staysActiveInBackground: false }).catch(() => {});
    };
  }, [active]);

  // 标题 / 封面 / 能力变化（换集、换台）
  useEffect(() => {
    if (!active) return;
    startVideoSession(o.title, o.subtitle, o.artwork ?? null, o.canSkip, o.isLive);
    last.current = { playing: null, pos: -POSITION_SYNC_MS * 2 };
  }, [active, o.title, o.subtitle, o.artwork, o.canSkip, o.isLive]);

  // 播放状态 / 进度
  useEffect(() => {
    if (!active) return;
    const l = last.current;
    if (l.playing !== o.playing || Math.abs(o.positionMs - l.pos) >= POSITION_SYNC_MS) {
      last.current = { playing: o.playing, pos: o.positionMs };
      updateVideoSession(o.playing, o.positionMs, o.durationMs, o.rate);
    }
  }, [active, o.playing, o.positionMs, o.durationMs, o.rate]);
}
