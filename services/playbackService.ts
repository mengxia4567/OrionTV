/**
 * RNTP 后台播放服务（headless JS 任务）：通知栏 / 锁屏 / 耳机线控 / 蓝牙按键的事件入口。
 * 由根目录 index.js 通过 `TrackPlayer.registerPlaybackService` 注册。
 *
 * 队列、播放模式、换源、续播都在 musicStore 里，这里只做「事件 → store 动作」的转发：
 *   播放 / 暂停 / 上一首 / 下一首 / 拖进度 / 停止。
 * 耳机线控：单击=播放/暂停（RemotePlay/RemotePause），双击=下一首、三击=上一首
 * （Android MediaSession 自己识别多击，转成 RemoteNext / RemotePrevious）。
 * 来电 / 其他 App 抢焦点由 setupPlayer 的 autoHandleInterruptions 自动处理。
 */
import TrackPlayer, { Event } from "react-native-track-player";

import { useMusicStore } from "@/stores/musicStore";

export default async function playbackService(): Promise<void> {
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    void useMusicStore.getState().resume();
  });
  TrackPlayer.addEventListener(Event.RemotePause, () => {
    void useMusicStore.getState().pause();
  });
  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    void useMusicStore.getState().next();
  });
  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    void useMusicStore.getState().prev();
  });
  TrackPlayer.addEventListener(Event.RemoteSeek, (e) => {
    void useMusicStore.getState().seek(Math.round(e.position * 1000));
  });
  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    void useMusicStore.getState().stop();
  });
}
