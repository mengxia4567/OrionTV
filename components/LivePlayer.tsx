import React, { forwardRef, useImperativeHandle, useRef, useState, useEffect } from "react";
import { View, StyleSheet, Text, ActivityIndicator, Pressable, Platform } from "react-native";
import { Video, ResizeMode, AVPlaybackStatus, VideoFullscreenUpdate } from "expo-av";
import { Maximize } from "lucide-react-native";
import { useKeepAwake } from "expo-keep-awake";
import { lockForFullscreen, unlockAfterFullscreen } from "@/utils/fullscreenOrientation";
import type { NaturalSize } from "@/utils/fullscreenPolicy";

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
}

/** 供外部（触控控制条）调用 */
export interface LivePlayerHandle {
  toggleFullscreen: () => Promise<void>;
}

const PLAYBACK_TIMEOUT = 15000; // 15 seconds

const LivePlayer = forwardRef<LivePlayerHandle, LivePlayerProps>(function LivePlayer(
  { streamUrl, channelTitle, onPlaybackStatusUpdate, shouldPlay = true, hideFullscreenButton = false, onNaturalSize },
  ref
) {
  const video = useRef<Video>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isTimeout, setIsTimeout] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
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
  useImperativeHandle(ref, () => ({ toggleFullscreen }));

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  useKeepAwake();

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

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
  }, [streamUrl]);


  const handlePlaybackStatusUpdate = (status: AVPlaybackStatus) => {
    if (status.isLoaded) {
      if (status.isPlaying) {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        setIsLoading(false);
        setIsTimeout(false);
      } else if (status.isBuffering) {
        setIsLoading(true);
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
        <Text style={styles.messageText}>
          {Platform.isTV ? "按向下键选择频道" : "长按画面选择频道"}
        </Text>
      </View>
    );
  }

  if (isTimeout) {
    return (
      <View style={styles.container}>
        <Text style={styles.messageText}>加载失败，请重试</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Video
        ref={video}
        style={styles.video}
        source={{
          uri: streamUrl,
        }}
        resizeMode={ResizeMode.CONTAIN}
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
      {isLoading && (
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
