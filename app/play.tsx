import React, { useEffect, useRef, useCallback, memo, useMemo, useState } from "react";
import { StyleSheet, TouchableOpacity, BackHandler, AppState, AppStateStatus, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Video, VideoFullscreenUpdate } from "expo-av";
import { lockForFullscreen, unlockAfterFullscreen } from "@/utils/fullscreenOrientation";
import type { NaturalSize } from "@/utils/fullscreenPolicy";
import { useKeepAwake } from "expo-keep-awake";
import { ThemedView } from "@/components/ThemedView";
import { PlayerControls } from "@/components/PlayerControls";
import { EpisodeSelectionModal } from "@/components/EpisodeSelectionModal";
import { SourceSelectionModal } from "@/components/SourceSelectionModal";
import { SpeedSelectionModal } from "@/components/SpeedSelectionModal";
import { SeekingBar } from "@/components/SeekingBar";
import MobileVodControls from "@/components/MobileVodControls";
import { useImmersiveFullscreen } from "@/hooks/useImmersiveFullscreen";
import { useVideoFit } from "@/hooks/useVideoFit";
import { useVideoSession } from "@/hooks/useVideoSession";
import VideoLoadingAnimation from "@/components/VideoLoadingAnimation";
import useDetailStore from "@/stores/detailStore";
import { useTVRemoteHandler } from "@/hooks/useTVRemoteHandler";
import Toast from "react-native-toast-message";
import usePlayerStore, { selectCurrentEpisode } from "@/stores/playerStore";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { useVideoHandlers } from "@/hooks/useVideoHandlers";

// 优化的加载动画组件
const LoadingContainer = memo(
  ({ style, currentEpisode }: { style: any; currentEpisode: { url: string; title: string } | undefined }) => {
    return (
      <View style={style}>
        <VideoLoadingAnimation showProgressBar />
      </View>
    );
  }
);

LoadingContainer.displayName = "LoadingContainer";

// 移到组件外部避免重复创建
const createResponsiveStyles = (deviceType: string) => {
  const isMobile = deviceType === "mobile";
  const isTablet = deviceType === "tablet";

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: "black",
      // 移动端和平板端可能需要状态栏处理
      ...(isMobile || isTablet ? { paddingTop: 0 } : {}),
    },
    videoContainer: {
      ...StyleSheet.absoluteFillObject,
      // 为触摸设备添加更多的交互区域
      ...(isMobile || isTablet ? { zIndex: 1 } : {}),
    },
    videoPlayer: {
      ...StyleSheet.absoluteFillObject,
    },
    loadingContainer: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0, 0, 0, 0.8)",
      justifyContent: "center",
      alignItems: "center",
      zIndex: 10,
    },
  });
};

export default function PlayScreen() {
  const videoRef = useRef<Video>(null);
  const router = useRouter();
  useKeepAwake();
  const [isFullscreen, setIsFullscreen] = useState(false);
  // 手机/平板：应用内沉浸式全屏（锁方向 + 隐藏系统栏）；TV 沿用原生全屏
  const fullscreen = useImmersiveFullscreen();
  const resizeMode = useVideoFit(fullscreen.naturalSize, fullscreen.isFullscreen);
  /** 视频真实尺寸：全屏时按比例决定横/竖 */
  const naturalSizeRef = useRef<NaturalSize | null>(null);

  /** 点播全屏（expo-av 原生全屏；Android/iOS 均支持） */
  const toggleFullscreen = useCallback(async () => {
    try {
      if (isFullscreen) {
        await videoRef.current?.dismissFullscreenPlayer();
      } else {
        await lockForFullscreen(naturalSizeRef.current);
        await videoRef.current?.presentFullscreenPlayer();
      }
    } catch {
      // 不支持时恢复方向并静默忽略
      void unlockAfterFullscreen();
    }
  }, [isFullscreen]);

  // 响应式布局配置
  const { deviceType } = useResponsiveLayout();

  const {
    episodeIndex: episodeIndexStr,
    position: positionStr,
    source: sourceStr,
    id: videoId,
    title: videoTitle,
  } = useLocalSearchParams<{
    episodeIndex: string;
    position?: string;
    source?: string;
    id?: string;
    title?: string;
  }>();
  const episodeIndex = parseInt(episodeIndexStr || "0", 10);
  const position = positionStr ? parseInt(positionStr, 10) : undefined;

  const { detail } = useDetailStore();
  const source = sourceStr || detail?.source;
  const id = videoId || detail?.id.toString();
  const title = videoTitle || detail?.title;
  const {
    isLoading,
    showControls,
    // showNextEpisodeOverlay,
    initialPosition,
    introEndTime,
    playbackRate,
    setVideoRef,
    handlePlaybackStatusUpdate,
    setShowControls,
    // setShowNextEpisodeOverlay,
    reset,
    loadVideo,
  } = usePlayerStore();
  const currentEpisode = usePlayerStore(selectCurrentEpisode);

  // 使用Video事件处理hook
  const { videoProps } = useVideoHandlers({
    videoRef,
    currentEpisode,
    initialPosition,
    introEndTime,
    playbackRate,
    handlePlaybackStatusUpdate,
    deviceType,
    detail: detail || undefined,
  });

  // 通知栏 / 锁屏媒体卡片（手机、平板）：状态同步给系统，按钮转回播放动作
  const status = usePlayerStore((s) => s.status);
  const reloadNonce = usePlayerStore((s) => s.reloadNonce);
  const episodes = usePlayerStore((s) => s.episodes);
  const currentEpisodeIndex = usePlayerStore((s) => s.currentEpisodeIndex);
  const loadedStatus = status && status.isLoaded ? status : null;
  useVideoSession({
    enabled: !!currentEpisode?.url,
    title: detail?.title ?? title ?? "",
    subtitle: episodes[currentEpisodeIndex]?.title ?? "",
    artwork: detail?.poster ?? null,
    canSkip: episodes.length > 1,
    isLive: false,
    playing: !!loadedStatus?.isPlaying,
    positionMs: loadedStatus?.positionMillis ?? 0,
    durationMs: loadedStatus?.durationMillis ?? 0,
    rate: playbackRate,
    onPlay: () => void videoRef.current?.playAsync(),
    onPause: () => void videoRef.current?.pauseAsync(),
    onNext: () => {
      if (currentEpisodeIndex < episodes.length - 1) void usePlayerStore.getState().playEpisode(currentEpisodeIndex + 1);
    },
    onPrev: () => {
      if (currentEpisodeIndex > 0) void usePlayerStore.getState().playEpisode(currentEpisodeIndex - 1);
    },
    onSeek: (ms) => void videoRef.current?.setPositionAsync(ms),
  });

  // TV遥控器处理 - 总是调用hook，但根据设备类型决定是否使用结果
  const tvRemoteHandler = useTVRemoteHandler();

  // 优化的动态样式 - 使用useMemo避免重复计算
  const dynamicStyles = useMemo(() => createResponsiveStyles(deviceType), [deviceType]);

  useEffect(() => {

    setVideoRef(videoRef);
    if (source && id && title) {
      loadVideo({ source, id, episodeIndex, position, title });
    } else {
    }

    return () => {
      reset(); // Reset state when component unmounts
    };
  }, [episodeIndex, source, position, setVideoRef, reset, loadVideo, id, title]);

  // 优化的屏幕点击处理
  const onScreenPress = useCallback(() => {
    if (deviceType === "tv") {
      tvRemoteHandler.onScreenPress();
    } else {
      setShowControls(!showControls);
    }
  }, [deviceType, tvRemoteHandler, setShowControls, showControls]);

  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === "background" || nextAppState === "inactive") {
        videoRef.current?.pauseAsync();
      }
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const backAction = () => {
      if (fullscreen.isFullscreen) {
        void fullscreen.exit();
        return true;
      }
      if (showControls) {
        setShowControls(false);
        return true;
      }
      router.back();
      return true;
    };

    const backHandler = BackHandler.addEventListener("hardwareBackPress", backAction);

    return () => backHandler.remove();
  }, [showControls, setShowControls, router, fullscreen]);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;

    if (isLoading) {
      timeoutId = setTimeout(() => {
        if (usePlayerStore.getState().isLoading) {
          usePlayerStore.setState({ isLoading: false });
          Toast.show({ type: "error", text1: "播放超时，请重试" });
        }
      }, 60000); // 1 minute
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isLoading]);

  if (!detail) {
    return <VideoLoadingAnimation showProgressBar />;
  }

  return (
    <ThemedView focusable style={dynamicStyles.container}>
      <TouchableOpacity
        activeOpacity={1}
        style={dynamicStyles.videoContainer}
        onPress={onScreenPress}
        disabled={deviceType !== "tv"} // 手机/平板的点击由 MobileVodControls 自己处理
      >
        {/* 条件渲染Video组件：只有在有有效URL时才渲染 */}
        {currentEpisode?.url ? (
          <Video
            key={reloadNonce}
            ref={videoRef}
            style={dynamicStyles.videoPlayer}
            onReadyForDisplay={(e) => {
              const ns = e?.naturalSize;
              if (ns && ns.width > 0 && ns.height > 0) {
                naturalSizeRef.current = { width: ns.width, height: ns.height };
                fullscreen.setNaturalSize({ width: ns.width, height: ns.height });
              }
            }}
            onFullscreenUpdate={(e) => {
              setIsFullscreen(e.fullscreenUpdate === VideoFullscreenUpdate.PLAYER_DID_PRESENT);
              if (e.fullscreenUpdate === VideoFullscreenUpdate.PLAYER_DID_DISMISS) {
                void unlockAfterFullscreen();
              }
            }}
            {...videoProps}
            resizeMode={resizeMode}
          />
        ) : (
          <LoadingContainer style={dynamicStyles.loadingContainer} currentEpisode={currentEpisode} />
        )}

        {showControls && deviceType === "tv" && (
          <PlayerControls
            showControls={showControls}
            setShowControls={setShowControls}
            onToggleFullscreen={() => void toggleFullscreen()}
          />
        )}

        <SeekingBar />

        {/* 只在Video组件存在且正在加载时显示加载动画覆盖层 */}
        {currentEpisode?.url && isLoading && (
          <View style={dynamicStyles.loadingContainer}>
            <VideoLoadingAnimation showProgressBar />
          </View>
        )}

        {deviceType !== "tv" && currentEpisode?.url ? (
          <MobileVodControls
            isFullscreen={fullscreen.isFullscreen}
            onToggleFullscreen={fullscreen.toggle}
            onBack={() => (fullscreen.isFullscreen ? void fullscreen.exit() : router.back())}
          />
        ) : null}

        {/* <NextEpisodeOverlay visible={showNextEpisodeOverlay} onCancel={() => setShowNextEpisodeOverlay(false)} /> */}
      </TouchableOpacity>

      <EpisodeSelectionModal />
      <SourceSelectionModal />
      <SpeedSelectionModal />
    </ThemedView>
  );
}
