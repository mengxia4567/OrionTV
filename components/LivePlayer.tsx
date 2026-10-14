import React, { forwardRef, useImperativeHandle, useRef, useState, useEffect } from "react";
import { View, StyleSheet, Text, ActivityIndicator, Pressable, Platform } from "react-native";
import { Video, ResizeMode, AVPlaybackStatus, VideoFullscreenUpdate } from "expo-av";
import { Maximize } from "lucide-react-native";
import { useKeepAwake } from "expo-keep-awake";
import { lockForFullscreen, unlockAfterFullscreen } from "@/utils/fullscreenOrientation";
import type { NaturalSize } from "@/utils/fullscreenPolicy";
import { createStallTracker, trackPosition, shouldShowBuffering } from "@/utils/playbackStall";

interface LivePlayerProps {
  streamUrl: string | null;
  channelTitle?: string | null;
  onPlaybackStatusUpdate: (status: AVPlaybackStatus) => void;
  /** 是否允许播放（本页聚焦 且 全局音乐未在播放时才为 true，避免与音乐同时出声） */
  shouldPlay?: boolean;
  /** 隐藏右下角自带的全屏按钮（手机/平板由 LiveTouchControls 统一提供） */
  hideFullscreenButton?: boolean;
  /** 手机/平板：视频真实尺寸回调（应用内全屏据此决定横/竖） */
  onNaturalSize?: (size: NaturalSize) => void;
  /** 画面缩放方式（默认适应；手机/平板全屏时由画面比例设置决定） */
  resizeMode?: ResizeMode;
  /** 加载失败状态变化（手机/平板由触控层显示「重试」按钮） */
  onFailedChange?: (failed: boolean) => void;
}

/** 供外部（触控控制条）调用 */
export interface LivePlayerHandle {
  toggleFullscreen: () => Promise<void>;
  play: () => void;
  pause: () => void;
  retry: () => void;
}

const PLAYBACK_TIMEOUT = 15000; // 15 seconds

const LivePlayer = forwardRef<LivePlayerHandle, LivePlayerProps>(function LivePlayer(
  {
    streamUrl,
    channelTitle,
    onPlaybackStatusUpdate,
    shouldPlay = true,
    hideFullscreenButton = false,
    onNaturalSize,
    resizeMode = ResizeMode.CONTAIN,
    onFailedChange,
  },
  ref,
) {
  const video = useRef<Video>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isTimeout, setIsTimeout] = useState(false);
  /** 播放中的缓冲状态（是否真卡住由 shouldShowBuffering 结合播放位置判断） */
  const [isBufferingRaw, setIsBufferingRaw] = useState(false);
  const [isPlayingRaw, setIsPlayingRaw] = useState(false);
  const stallRef = useRef(createStallTracker());
  const [, setTick] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  /** 重试次数：变化时重新载入当前流 */
  const [attempt, setAttempt] = useState(0);
  /** 视频真实尺寸：全屏时按比例决定横/竖（横屏内容 → 横屏） */
  const naturalSizeRef = useRef<NaturalSize | null>(null);

  /** 原生全屏：先按视频比例锁方向，再进全屏；退出由 onFullscreenUpdate 恢复 */
  const toggleFullscreen = async () => {
    try {
      if (isFullscreen) {
        await video.current?.dismissFullscreenPlayer();
      } else {
        await lockForFullscreen(naturalSizeRef.current);
        await video.current?.presentFullscreenPlayer();
      }
    } catch {
      // 个别设备/系统不支持时恢复方向并静默忽略，不影响播放
      void unlockAfterFullscreen();
    }
  };
  useImperativeHandle(ref, () => ({
    toggleFullscreen,
    play: () => void video.current?.playAsync().catch(() => {}),
    pause: () => void video.current?.pauseAsync().catch(() => {}),
    retry: () => setAttempt((n) => n + 1),
  }));

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  useKeepAwake();

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    stallRef.current = createStallTracker();
    setIsBufferingRaw(false);
    setIsPlayingRaw(false);
    if (streamUrl) {
      setIsLoading(true);
      setIsTimeout(false);
      timeoutRef.current = setTimeout(() => {
        setIsTimeout(true);
        setIsLoading(false);
      }, PLAYBACK_TIMEOUT);
    } else {
      setIsLoading(false);
      setIsTimeout(false);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [streamUrl, attempt]);

  useEffect(() => {
    // 位置停住时状态推送间隔较长，用定时器保证「停够 1.5 秒」后能及时显示加载圈
    if (!isBufferingRaw) return;
    const timer = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, [isBufferingRaw]);

  useEffect(() => {
    onFailedChange?.(isTimeout);
  }, [isTimeout, onFailedChange]);

  const handlePlaybackStatusUpdate = (status: AVPlaybackStatus) => {
    if (status.isLoaded) {
      trackPosition(stallRef.current, status.positionMillis, Date.now());
      setIsBufferingRaw(status.isBuffering);
      setIsPlayingRaw(status.isPlaying);
      if (status.isPlaying) {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        setIsLoading(false);
        setIsTimeout(false);
      }
    } else {
      if (status.error) {
        setIsLoading(false);
        setIsTimeout(true);
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
      }
    }
    onPlaybackStatusUpdate(status);
  };

  if (!streamUrl) {
    return (
      <View style={styles.container}>
        <Text style={styles.messageText}>{Platform.isTV ? "按向下键选择频道" : "长按画面选择频道"}</Text>
      </View>
    );
  }

  if (isTimeout) {
    return (
      <View style={styles.container}>
        <Text style={styles.messageText}>加载失败</Text>
        {Platform.isTV ? (
          <Pressable style={styles.retryBtn} onPress={() => setAttempt((n) => n + 1)} focusable hasTVPreferredFocus>
            <Text style={styles.retryText}>重试</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Video
        key={attempt}
        ref={video}
        style={styles.video}
        source={{
          uri: streamUrl,
        }}
        resizeMode={resizeMode}
        shouldPlay={shouldPlay}
        onReadyForDisplay={(e) => {
          const ns = e?.naturalSize;
          if (ns && ns.width > 0 && ns.height > 0) {
            naturalSizeRef.current = { width: ns.width, height: ns.height };
            onNaturalSize?.({ width: ns.width, height: ns.height });
          }
        }}
        // 全屏状态跟随原生事件（用户也可用系统手势退出全屏）；退出后恢复系统方向
        onFullscreenUpdate={(e) => {
          setIsFullscreen(e.fullscreenUpdate === VideoFullscreenUpdate.PLAYER_DID_PRESENT);
          if (e.fullscreenUpdate === VideoFullscreenUpdate.PLAYER_DID_DISMISS) {
            void unlockAfterFullscreen();
          }
        }}
        onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
        onError={() => {
          setIsTimeout(true);
          setIsLoading(false);
        }}
      />
      {(isLoading || shouldShowBuffering(isBufferingRaw, isPlayingRaw, stallRef.current, Date.now())) && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.messageText}>加载中...</Text>
        </View>
      )}
      {channelTitle && !isLoading && !isTimeout && (
        <View style={styles.overlay} pointerEvents="none">
          <Text style={styles.title}>{channelTitle}</Text>
        </View>
      )}
      {/* 全屏入口：电视用遥控器聚焦后确认；手机/平板由触控控制条提供 */}
      {!hideFullscreenButton && (
        <Pressable
          style={styles.fullscreenBtn}
          onPress={() => void toggleFullscreen()}
          focusable
          {...(Platform.isTV ? { hasTVPreferredFocus: false } : {})}
          accessibilityLabel="全屏"
        >
          <Maximize size={22} color="#fff" />
        </Pressable>
      )}
    </View>
  );
});

export default LivePlayer;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#000",
  },
  video: {
    flex: 1,
    alignSelf: "stretch",
  },
  overlay: {
    position: "absolute",
    top: 20,
    left: 20,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    padding: 10,
    borderRadius: 5,
  },
  title: {
    color: "#fff",
    fontSize: 18,
  },
  messageText: {
    color: "#fff",
    fontSize: 16,
    marginTop: 10,
  },
  retryBtn: {
    marginTop: 16,
    minWidth: 120,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: "#00bb5e",
  },
  retryText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  fullscreenBtn: {
    position: "absolute",
    right: 16,
    bottom: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
});
