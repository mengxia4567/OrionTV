/**
 * 音乐 · 歌单 / 榜单详情页（/music/playlist?kind=&source=&id=&title=）
 * - kind=songlist：musicSonglistDetail（"my" 源走我的歌单接口）
 * - kind=board：musicBoardSongs
 * - 点击歌曲行：整单入队并从该曲开始播放
 */
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Play } from "lucide-react-native";
import Toast from "react-native-toast-message";

import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import SongList from "@/components/music/SongList";
import ResponsiveNavigation from "@/components/navigation/ResponsiveNavigation";
import ResponsiveHeader from "@/components/navigation/ResponsiveHeader";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { api } from "@/services/api";
import { useMusicStore, MusicSong } from "@/stores/musicStore";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("MusicList");

export default function MusicPlaylistScreen() {
  const { deviceType } = useResponsiveLayout();
  const isTV = deviceType === "tv";
  const params = useLocalSearchParams<{
    kind?: string;
    source?: string;
    id?: string;
    title?: string;
  }>();
  const kind = (params.kind as string) || "songlist";
  const source = (params.source as string) || "wy";
  const id = (params.id as string) || "";
  const title = (params.title as string) || "播放列表";

  const [songs, setSongs] = useState<MusicSong[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const playQueue = useMusicStore((s) => s.playQueue);

  /** 移除歌曲（仅我的歌单） */
  const handleRemove = async (index: number, song: MusicSong) => {
    try {
      await api.musicPlaylistRemoveSong(id, song.songId);
      setSongs((prev) => prev.filter((_, i) => i !== index));
      Toast.show({ type: "success", text1: "已从歌单移除" });
    } catch {
      Toast.show({ type: "error", text1: "移除失败，请重试" });
    }
  };

  const fetchPage = useCallback(
    async (p: number): Promise<MusicSong[]> => {
      if (!id) return [];
      try {
        if (source === "my") {
          // 我的歌单：一次全量（不分页）
          if (p > 1) return [];
          const r = await api.musicPlaylistSongs(id);
          return r?.data?.songs || [];
        }
        if (kind === "board") {
          const r = await api.musicBoardSongs(source, id, p);
          return r?.data?.list || r?.data?.songs || r?.data?.tracks || [];
        }
        const r = await api.musicSonglistDetail(source, id, p);
        return r?.data?.list || r?.data?.songs || r?.data?.tracks || [];
      } catch (e) {
        logger.error("fetch list failed", e);
        return [];
      }
    },
    [kind, source, id]
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setPage(1);
      setHasMore(true);
      const list = await fetchPage(1);
      if (!alive) return;
      setSongs(list);
      setHasMore(source !== "my" && list.length > 0);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [fetchPage]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const p = page + 1;
    const list = await fetchPage(p);
    if (list.length) {
      setSongs((prev) => [...prev, ...list]);
      setPage(p);
    } else {
      setHasMore(false);
    }
    setLoadingMore(false);
  };

  const body = (
    <ThemedView style={styles.container}>
      <View style={[styles.head, isTV ? styles.headTv : null]}>
        <View style={styles.headRow}>
          <View style={styles.headInfo}>
            {isTV ? (
              <ThemedText style={[styles.headTitle, styles.headTitleTv]} numberOfLines={1}>
                {title}
              </ThemedText>
            ) : null}
            <ThemedText style={styles.headSub}>
              {kind === "board" ? "排行榜" : source === "my" ? "我的歌单" : "歌单"} · 共 {songs.length}
              {hasMore ? "+" : ""} 首
            </ThemedText>
          </View>
          {songs.length > 0 ? (
            <Pressable onPress={() => void playQueue(songs, 0)} focusable>
              {({ focused }) => (
                <View style={[styles.playAll, focused && isTV ? styles.playAllFocused : null]}>
                  <Play size={15} color="#fff" />
                  <ThemedText style={styles.playAllText}>播放全部</ThemedText>
                </View>
              )}
            </Pressable>
          ) : null}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1DB954" />
        </View>
      ) : (
        <SongList
          songs={songs}
          onEndReached={() => void loadMore()}
          onRemove={source === "my" ? handleRemove : undefined}
          ListEmptyComponent={
            <View style={styles.center}>
              <ThemedText style={{ opacity: 0.5 }}>暂无歌曲</ThemedText>
            </View>
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator style={{ marginVertical: 16 }} color="#1DB954" /> : null
          }
        />
      )}
    </ThemedView>
  );

  if (isTV) {
    return body;
  }
  return (
    <ResponsiveNavigation>
      <ResponsiveHeader title={title} showBackButton />
      {body}
    </ResponsiveNavigation>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f1012",
  },
  head: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  headTv: {
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headInfo: {
    flex: 1,
  },
  playAll: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "#1DB954",
  },
  playAllFocused: {
    transform: [{ scale: 1.06 }],
    backgroundColor: "#22c55e",
  },
  playAllText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
  },
  headTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  headTitleTv: {
    fontSize: 26,
  },
  headSub: {
    fontSize: 12,
    opacity: 0.5,
    marginTop: 4,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
  },
});
