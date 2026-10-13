import { EventEmitter } from "expo-modules-core";
import { requireOptionalNativeModule } from "expo";

export type VideoSessionAction = "play" | "pause" | "next" | "prev" | "seek";
export interface VideoSessionEvent {
  action: VideoSessionAction;
  /** seek 时的目标位置（毫秒） */
  positionMs: number;
}

interface VideoSessionNative {
  start(title: string, subtitle: string | null, artworkUrl: string | null, canSkip: boolean, isLive: boolean): void;
  update(playing: boolean, positionMs: number, durationMs: number, rate: number): void;
  stop(): void;
}

// 旧安装包 / 非 Android 没有这个原生模块：全部退化为空操作
const native = requireOptionalNativeModule<VideoSessionNative>("VideoSession");
const emitter = native ? new EventEmitter(native as never) : null;

export const videoSessionAvailable = native != null;

export const startVideoSession = (
  title: string,
  subtitle: string,
  artworkUrl: string | null,
  canSkip: boolean,
  isLive: boolean,
) => native?.start(title, subtitle, artworkUrl, canSkip, isLive);

export const updateVideoSession = (playing: boolean, positionMs: number, durationMs: number, rate: number) =>
  native?.update(playing, positionMs, durationMs, rate);

export const stopVideoSession = () => native?.stop();

export function onVideoSessionAction(cb: (e: VideoSessionEvent) => void): () => void {
  if (!emitter) return () => {};
  const sub = emitter.addListener("onAction", cb);
  return () => sub.remove();
}
