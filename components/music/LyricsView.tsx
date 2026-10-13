/**
 * LyricsView — 歌词滚动视图（电视端大字 / 手机中字，自动跟随当前行）
 *
 * - 解析 LRC（utils/lyrics）→ 固定行高 FlatList（getItemLayout 稳定滚动）
 * - 仅当「当前行索引」变化时滚动（避免 500ms 进度更新引发滚动抖动）
 * - 当前行高亮 + 相邻两行淡出层级（卡拉OK 感）
 * - 无歌词 → 占位文案
 */
import React, { useEffect, useRef } from "react";
import { FlatList, Pressable, StyleSheet, View, ViewStyle } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { useMusicStore } from "@/stores/musicStore";
import { findLineIndex, LyricLine } from "@/utils/lyrics";

interface Props {
  /** 歌词 fontSize（TV 大字 ~40；手机 ~20） */
  fontSize?: number;
  /** 高亮色 */
  accentColor?: string;
  style?: ViewStyle;
  /** 容器高度（决定可视行数；默认 flex:1） */
  height?: number;
  /** 滚动视图垂直内边距（让首行也可居中） */
  topPad?: number;
  /** 点击某行跳转到该行时间（毫秒）；不传则歌词仅展示，不可点 */
  onSeek?: (timeMs: number) => void;
}

export default function LyricsView({
  fontSize = 20,
  accentColor = "#1DB954",
  style,
  height,
  topPad = 120,
  onSeek,
}: Props) {
  const lyricText = useMusicStore((s) => s.lyricText);
  // 行数组由 store 一次性解析；此处 O(log n) 定位当前行（仅索引变化触发重渲染）
  const lines = useMusicStore((s) => s.lyricLines);
  const curIdx = useMusicStore((s) => findLineIndex(s.lyricLines, s.position));

  const lineH = Math.round(fontSize * 1.9);
  const listRef = useRef<FlatList<LyricLine>>(null);
  const lastScrolled = useRef(-1);

  useEffect(() => {
    if (curIdx < 0 || curIdx === lastScrolled.current) return;
    lastScrolled.current = curIdx;
    const t = setTimeout(() => {
      listRef.current?.scrollToIndex({ index: curIdx, viewPosition: 0.5, animated: true });
    }, 60);
    return () => clearTimeout(t);
  }, [curIdx]);

  if (!lyricText || lines.length === 0) {
    return (
      <View style={[styles.empty, style, height ? { height } : null]}>
        <ThemedText style={[styles.emptyText, { fontSize: Math.max(14, fontSize * 0.7) }]}>
          {lyricText ? "纯音乐，请欣赏" : "暂无歌词"}
        </ThemedText>
      </View>
    );
  }

  return (
    <FlatList
      ref={listRef}
      style={[styles.list, style, height ? { height } : null]}
      data={lines}
      keyExtractor={(_, i) => String(i)}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingTop: topPad, paddingBottom: topPad }}
      getItemLayout={(_, index) => ({
        length: lineH,
        offset: lineH * index + topPad,
        index,
      })}
      onScrollToIndexFailed={(info) => {
        // 兜底：等一帧后按 offset 直接滚
        setTimeout(() => {
          listRef.current?.scrollToOffset({
            offset: Math.max(0, info.averageItemLength * info.index),
            animated: true,
          });
        }, 80);
      }}
      renderItem={({ item, index }) => {
        const active = index === curIdx;
        const near = Math.abs(index - curIdx) <= 1;
        const row = (
          <View style={[styles.lineBox, { height: lineH }]}>
            <ThemedText
              style={{
                fontSize,
                lineHeight: lineH,
                textAlign: "center",
                fontWeight: active ? "700" : "400",
                color: active ? accentColor : "#E7E3DA",
                opacity: active ? 1 : near ? 0.62 : 0.34,
              }}
            >
              {item.text || "♪"}
            </ThemedText>
          </View>
        );
        if (!onSeek) return row;
        return (
          <Pressable onPress={() => onSeek(item.timeMs)} focusable>
            {row}
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  lineBox: {
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    opacity: 0.4,
    letterSpacing: 2,
  },
});
