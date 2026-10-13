/**
 * MiniPlayer — 音乐页内的迷你播放条（_layout 挂载，只在 /music 下显示）
 *
 * - 有「当前曲」且未打开全屏播放器时显示
 * - 电视端：底部通栏（大控件，遥控器可达：下键深入 → 播放/暂停/下一首/打开全屏）
 * - 手机端：悬浮于底部 tab 栏上方（圆角卡片；点条体展开全屏播放器）
 * - 进度线独立子组件订阅（避免 500ms 进度更新引起整条重渲染）
 */
import React from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { useSegments } from "expo-router";
import { Music as MusicIcon, Pause, Play, SkipForward, X } from "lucide-react-native";

import { ThemedText } from "@/components/ThemedText";
import { StyledButton } from "@/components/StyledButton";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { useMusicStore } from "@/stores/musicStore";

/** 细进度线（独立订阅 position/duration） */
function ProgressLine({ height = 2 }: { height?: number }) {
  const position = useMusicStore((s) => s.position);
  const duration = useMusicStore((s) => s.duration);
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  return (
    <View style={[styles.progressTrack, { height }]}>
      <View style={[styles.progressFill, { width: `${pct}%` }]} />
    </View>
  );
}

export default function MiniPlayer() {
  const { deviceType } = useResponsiveLayout();
  const current = useMusicStore((s) => s.current);
  const isPlaying = useMusicStore((s) => s.isPlaying);
  const isLoading = useMusicStore((s) => s.isLoading);
  const playerOpen = useMusicStore((s) => s.playerOpen);
  const toggle = useMusicStore((s) => s.toggle);
  const next = useMusicStore((s) => s.next);
  const stop = useMusicStore((s) => s.stop);
  const setPlayerOpen = useMusicStore((s) => s.setPlayerOpen);
  // 迷你播放条只在音乐页内出现；去其他页面不再悬浮（音乐仍在后台播放，通知栏可控）
  const inMusic = useSegments()[0] === "music";

  if (!current || playerOpen || !inMusic) return null;

  const isMobile = deviceType === "mobile";
  const bar = isMobile ? styles.barMobile : styles.barTv;

  return (
    <View style={[styles.wrap, isMobile ? styles.wrapMobile : styles.wrapTv]} pointerEvents="box-none">
      <View style={[styles.bar, bar]}>
        <ProgressLine height={isMobile ? 2 : 3} />
        <View style={styles.row}>
          <Pressable style={styles.main} onPress={() => setPlayerOpen(true)} focusable>
            <View style={styles.coverBox}>
              {current.cover ? (
                <Image source={{ uri: current.cover }} style={styles.cover} resizeMode="cover" />
              ) : (
                <MusicIcon size={isMobile ? 20 : 26} color="#1DB954" />
              )}
            </View>
            <View style={styles.meta}>
              <ThemedText style={[styles.name, isMobile ? styles.nameMobile : styles.nameTv]} numberOfLines={1}>
                {current.name}
              </ThemedText>
              <ThemedText style={styles.artist} numberOfLines={1}>
                {current.artist}
                {isLoading ? " · 加载中…" : ""}
              </ThemedText>
            </View>
          </Pressable>
          <View style={styles.controls}>
            <StyledButton
              onPress={() => void toggle()}
              variant="primary"
              style={isMobile ? styles.ctrlMobile : styles.ctrlTv}
            >
              {isPlaying ? (
                <Pause size={isMobile ? 18 : 24} color="#fff" />
              ) : (
                <Play size={isMobile ? 18 : 24} color="#fff" />
              )}
            </StyledButton>
            <StyledButton onPress={() => void next()} style={isMobile ? styles.ctrlMobile : styles.ctrlTv}>
              <SkipForward size={isMobile ? 18 : 24} color="#fff" />
            </StyledButton>
            {/* 关闭：停止播放并清除当前曲目（迷你条随之隐藏） */}
            <StyledButton onPress={() => void stop()} style={isMobile ? styles.ctrlMobile : styles.ctrlTv}>
              <X size={isMobile ? 18 : 24} color="#B9BBC1" />
            </StyledButton>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    // 手机：悬浮于底部 tab 栏（高 84）之上；TV：贴底通栏
    bottom: 0,
  },
  wrapMobile: {
    paddingHorizontal: 8,
    bottom: 84,
  },
  wrapTv: {
    paddingHorizontal: 0,
    bottom: 0,
  },
  bar: {
    backgroundColor: "#1C1C1E",
    overflow: "hidden",
  },
  barMobile: {
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 8,
  },
  barTv: {
    borderTopWidth: 1,
    borderTopColor: "#2A2B30",
  },
  progressTrack: {
    backgroundColor: "#33353B",
    width: "100%",
  },
  progressFill: {
    backgroundColor: "#1DB954",
    height: "100%",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  main: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 14,
    paddingVertical: 8,
    gap: 12,
  },
  coverBox: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: "#26272B",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  cover: {
    width: "100%",
    height: "100%",
  },
  meta: {
    flex: 1,
  },
  name: {
    fontWeight: "600",
  },
  nameMobile: {
    fontSize: 14,
  },
  nameTv: {
    fontSize: 20,
  },
  artist: {
    fontSize: 12,
    opacity: 0.6,
    marginTop: 2,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingRight: 8,
  },
  ctrlMobile: {
    minWidth: 44,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  ctrlTv: {
    minWidth: 64,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
});
