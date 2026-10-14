/**
 * MiniPlayer — 音乐页内的迷你播放条（只在 /music 下显示）
 *
 * - 有「当前曲」且未打开全屏播放器时显示
 * - 手机/平板（variant="docked"）：像主流音乐 App 一样作为导航栏的一部分，
 *   紧贴在底部导航栏/内容区底部之上，占用布局空间、不遮挡列表；
 *   左圆形封面 · 中间「歌名 - 歌手」一行 · 右播放/暂停 + 下一首；点条体展开全屏播放器
 * - 电视（variant="tv"）：底部通栏（大控件，遥控器可达：下键深入 → 播放/暂停/下一首/打开全屏）
 * - 进度线独立子组件订阅（避免 500ms 进度更新引起整条重渲染）
 */
import React from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
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

interface MiniPlayerProps {
  /** docked：手机/平板，放进导航容器；tv：电视，全局绝对定位通栏 */
  variant: "docked" | "tv";
}

export default function MiniPlayer({ variant }: MiniPlayerProps) {
  const { deviceType } = useResponsiveLayout();
  const current = useMusicStore((s) => s.current);
  const isPlaying = useMusicStore((s) => s.isPlaying);
  const isLoading = useMusicStore((s) => s.isLoading);
  const playerOpen = useMusicStore((s) => s.playerOpen);
  const toggle = useMusicStore((s) => s.toggle);
  const next = useMusicStore((s) => s.next);
  const stop = useMusicStore((s) => s.stop);
  const setPlayerOpen = useMusicStore((s) => s.setPlayerOpen);
  // 迷你播放条只在音乐页内出现；去其他页面不再显示（音乐仍在后台播放，通知栏可控）
  const inMusic = useSegments()[0] === "music";

  if (!current || playerOpen || !inMusic) return null;
  // 两种形态按设备分工，避免同一时刻出现两条
  if ((variant === "tv") !== (deviceType === "tv")) return null;

  if (variant === "docked") {
    return (
      <View style={styles.dock}>
        <ProgressLine height={2} />
        <View style={styles.dockRow}>
          <Pressable style={styles.dockMain} onPress={() => setPlayerOpen(true)}>
            <View style={styles.dockCover}>
              {current.cover ? (
                <Image source={{ uri: current.cover }} style={styles.cover} resizeMode="cover" />
              ) : (
                <MusicIcon size={20} color="#1DB954" />
              )}
            </View>
            <Text style={styles.dockText} numberOfLines={1}>
              <Text style={styles.dockName}>{current.name}</Text>
              <Text style={styles.dockArtist}>
                {"  -  "}
                {current.artist}
                {isLoading ? " · 加载中…" : ""}
              </Text>
            </Text>
          </Pressable>
          <Pressable style={styles.dockBtn} onPress={() => void toggle()} hitSlop={6}>
            {isLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : isPlaying ? (
              <Pause size={26} color="#fff" fill="#fff" />
            ) : (
              <Play size={26} color="#fff" fill="#fff" />
            )}
          </Pressable>
          <Pressable style={styles.dockBtn} onPress={() => void next()} hitSlop={6}>
            <SkipForward size={24} color="#fff" fill="#fff" />
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, styles.wrapTv]} pointerEvents="box-none">
      <View style={[styles.bar, styles.barTv]}>
        <ProgressLine height={3} />
        <View style={styles.row}>
          <Pressable style={styles.main} onPress={() => setPlayerOpen(true)} focusable>
            <View style={styles.coverBox}>
              {current.cover ? (
                <Image source={{ uri: current.cover }} style={styles.cover} resizeMode="cover" />
              ) : (
                <MusicIcon size={26} color="#1DB954" />
              )}
            </View>
            <View style={styles.meta}>
              <ThemedText style={[styles.name, styles.nameTv]} numberOfLines={1}>
                {current.name}
              </ThemedText>
              <ThemedText style={styles.artist} numberOfLines={1}>
                {current.artist}
                {isLoading ? " · 加载中…" : ""}
              </ThemedText>
            </View>
          </Pressable>
          <View style={styles.controls}>
            <StyledButton onPress={() => void toggle()} variant="primary" style={styles.ctrlTv}>
              {isPlaying ? <Pause size={24} color="#fff" /> : <Play size={24} color="#fff" />}
            </StyledButton>
            <StyledButton onPress={() => void next()} style={styles.ctrlTv}>
              <SkipForward size={24} color="#fff" />
            </StyledButton>
            {/* 关闭：停止播放并清除当前曲目（迷你条随之隐藏） */}
            <StyledButton onPress={() => void stop()} style={styles.ctrlTv}>
              <X size={24} color="#B9BBC1" />
            </StyledButton>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // —— 手机/平板：贴在导航栏上方的迷你条 ——
  dock: {
    backgroundColor: "#232326",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#3A3B40",
  },
  dockRow: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 6,
  },
  dockMain: {
    flex: 1,
    height: "100%",
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 12,
    gap: 10,
  },
  dockCover: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#2E2F34",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  dockText: {
    flex: 1,
  },
  dockName: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  dockArtist: {
    color: "#9A9CA3",
    fontSize: 12,
  },
  dockBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  wrapTv: {
    paddingHorizontal: 0,
    bottom: 0,
  },
  bar: {
    backgroundColor: "#1C1C1E",
    overflow: "hidden",
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
  ctrlTv: {
    minWidth: 64,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
});
