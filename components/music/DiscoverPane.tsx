/**
 * DiscoverPane — 音乐发现（排行榜横排 + 推荐歌单网格）
 * 电视端：横排卡片焦点移动；手机端：横滑 + 2 列网格
 */
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import MediaCard from "@/components/music/MediaCard";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { api } from "@/services/api";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("MusicDiscover");

export interface OpenListArg {
  kind: "songlist" | "board";
  source: string;
  id: string;
  title: string;
}

export default function DiscoverPane({ onOpenList }: { onOpenList: (arg: OpenListArg) => void }) {
  const { deviceType, screenWidth } = useResponsiveLayout();
  const isTV = deviceType === "tv";

  const [boards, setBoards] = useState<any[]>([]);
  const [songlists, setSonglists] = useState<any[]>([]);
  const [songlistPage, setSonglistPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tags, setTags] = useState<{ id: string; name: string }[]>([]);
  const [activeTag, setActiveTag] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const [b, s, t] = await Promise.all([
        api.musicBoards("wy").catch(() => null),
        api.musicSonglists("wy", 1).catch(() => null),
        api.musicSonglistTags("wy").catch(() => null),
      ]);
      const bl = b?.data?.boards || b?.data?.list || [];
      const sl = s?.data?.list || s?.data?.songlists || [];
      setBoards(bl);
      setSonglists(sl);
      setSonglistPage(1);
      setActiveTag("");
      const tlRaw = t?.data?.tags || t?.data?.list || [];
      const tl = (Array.isArray(tlRaw) ? tlRaw : [])
        .map((x: any) =>
          typeof x === "string"
            ? { id: x, name: x }
            : { id: String(x?.id ?? x?.tagId ?? x?.name ?? ""), name: String(x?.name ?? x?.label ?? "") }
        )
        .filter((x: any) => x.id && x.name)
        .slice(0, 10);
      setTags(tl);
      if (!bl.length && !sl.length) setFailed(true);
    } catch (e) {
      logger.error("discover load failed", e);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  /** 按标签重载歌单（""=全部） */
  const reloadSonglists = async (tagId: string) => {
    setActiveTag(tagId);
    try {
      const s = await api.musicSonglists("wy", 1, tagId);
      setSonglists(s?.data?.list || s?.data?.songlists || []);
      setSonglistPage(1);
    } catch {
      /* 忽略 */
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  const loadMoreSonglists = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const p = songlistPage + 1;
      const s = await api.musicSonglists("wy", p, activeTag);
      const list = s?.data?.list || s?.data?.songlists || [];
      if (list.length) {
        setSonglists((prev) => [...prev, ...list]);
        setSonglistPage(p);
      }
    } catch {
      /* 忽略 */
    } finally {
      setLoadingMore(false);
    }
  };

  const cardSize = isTV ? 190 : Math.floor((screenWidth - 16 * 2 - 12) / 2);
  const cols = isTV ? 5 : 2;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1DB954" />
      </View>
    );
  }

  if (failed && boards.length === 0 && songlists.length === 0) {
    return (
      <View style={styles.center}>
        <ThemedText style={{ opacity: 0.55, marginBottom: 14 }}>内容加载失败</ThemedText>
        <Pressable onPress={() => void load()} focusable>
          {({ focused }) => (
            <View style={[styles.moreBtnInner, focused && isTV ? styles.moreBtnFocused : null]}>
              <ThemedText style={styles.moreText}>点击重试</ThemedText>
            </View>
          )}
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.wrap}>
      {boards.length > 0 ? (
        <>
          <ThemedText style={[styles.sectionTitle, isTV ? styles.sectionTitleTv : null]}>排行榜</ThemedText>
          <FlatList
            horizontal
            data={boards.slice(0, 12)}
            keyExtractor={(item, i) => String(item.id ?? item.bangid ?? i)}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.hRow}
            renderItem={({ item, index }) => (
              <MediaCard
                title={item.name || item.title || "榜单"}
                cover={item.img || item.pic || item.cover}
                size={isTV ? 170 : 132}
                hasTVPreferredFocus={index === 0}
                onPress={() =>
                  onOpenList({
                    kind: "board",
                    source: item.source || "wy",
                    id: String(item.id ?? item.bangid ?? ""),
                    title: item.name || "榜单",
                  })
                }
              />
            )}
          />
        </>
      ) : null}

      <ThemedText style={[styles.sectionTitle, isTV ? styles.sectionTitleTv : null]}>推荐歌单</ThemedText>
      {tags.length > 0 ? (
        <View style={styles.tagRow}>
          {[{ id: "", name: "全部" }, ...tags].map((t) => {
            const active = activeTag === t.id;
            return (
              <Pressable key={t.id || "all"} onPress={() => void reloadSonglists(t.id)} focusable>
                {({ focused }) => (
                  <View
                    style={[
                      styles.tagChip,
                      active ? styles.tagChipActive : null,
                      focused && isTV ? styles.tagChipFocused : null,
                    ]}
                  >
                    <ThemedText style={[styles.tagText, active ? styles.tagTextActive : null]}>
                      {t.name}
                    </ThemedText>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <FlatList
        key={`grid-${cols}`}
        data={songlists}
        numColumns={cols}
        scrollEnabled={false}
        columnWrapperStyle={styles.gridRow}
        keyExtractor={(item, i) => String(item.id ?? item.dissid ?? i)}
        renderItem={({ item }) => (
          <MediaCard
            title={item.name || "歌单"}
            cover={item.img || item.pic || item.cover}
            subtitle={item.author || undefined}
            size={cardSize}
            onPress={() =>
              onOpenList({
                kind: "songlist",
                source: item.source || "wy",
                id: String(item.id ?? item.dissid ?? ""),
                title: item.name || "歌单",
              })
            }
          />
        )}
        ListFooterComponent={
          <View style={styles.moreWrap}>
            <Pressable onPress={() => void loadMoreSonglists()} focusable style={styles.moreBtn}>
              {({ focused }) => (
                <View style={[styles.moreBtnInner, focused && isTV ? styles.moreBtnFocused : null]}>
                  {loadingMore ? (
                    <ActivityIndicator color="#1DB954" />
                  ) : (
                    <ThemedText style={styles.moreText}>加载更多</ThemedText>
                  )}
                </View>
              )}
            </Pressable>
          </View>
        }
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  wrap: {
    paddingBottom: 140,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginTop: 14,
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  sectionTitleTv: {
    fontSize: 20,
    paddingHorizontal: 24,
  },
  hRow: {
    paddingHorizontal: 12,
    gap: 10,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  tagChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#1B1C1F",
    borderWidth: 1,
    borderColor: "#2A2C31",
  },
  tagChipActive: {
    backgroundColor: "rgba(29,185,84,0.16)",
    borderColor: "#1DB954",
  },
  tagChipFocused: {
    borderColor: "#1DB954",
  },
  tagText: {
    fontSize: 12,
    opacity: 0.7,
  },
  tagTextActive: {
    color: "#1DB954",
    fontWeight: "700",
    opacity: 1,
  },
  gridRow: {
    gap: 12,
    paddingHorizontal: 12,
  },
  moreWrap: {
    alignItems: "center",
    paddingVertical: 18,
  },
  moreBtn: {
    minWidth: 140,
  },
  moreBtnInner: {
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#33353B",
    alignItems: "center",
  },
  moreBtnFocused: {
    borderColor: "#1DB954",
    backgroundColor: "rgba(29,185,84,0.12)",
  },
  moreText: {
    fontSize: 14,
    opacity: 0.75,
  },
});
