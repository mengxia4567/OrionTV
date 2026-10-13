/**
 * SearchPane — 音乐搜索（双源 wy+kw 合并去重）
 *
 * - 电视端：不弹软键盘 —— 「手机扫码输入」主入口 + 热搜/历史一键搜
 * - 手机端：常规输入框（键盘）+ 热搜/历史
 * - 远程输入（targetPage='music'）联动：手机扫码发词 → 自动搜索
 * - 结果合并双源（同名同歌手去重，优先网易云），各条保留自身源，播放自动可用
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";
import { Smartphone, X } from "lucide-react-native";

import { ThemedText } from "@/components/ThemedText";
import SongList from "@/components/music/SongList";
import { RemoteControlModal } from "@/components/RemoteControlModal";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { useSettingsStore } from "@/stores/settingsStore";
import { useRemoteControlStore } from "@/stores/remoteControlStore";
import { api } from "@/services/api";
import { useMusicStore, MusicSong } from "@/stores/musicStore";
import { getSearchHistory, pushSearchHistory } from "@/utils/searchHistory";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("MusicSearch");

/** 搜索源模式：all=双源合并；wy/kw=单源 */
type SrcMode = "all" | "wy" | "kw";
const SRC_TABS: { key: SrcMode; label: string }[] = [
  { key: "all", label: "双源" },
  { key: "wy", label: "网易云" },
  { key: "kw", label: "酷我" },
];

const norm = (s: string) =>
  (s || "")
    .toLowerCase()
    .replace(/[\s·・\-—_()（）[\]【】'"]/g, "")
    .trim();

export default function SearchPane() {
  const { deviceType } = useResponsiveLayout();
  const isTV = deviceType === "tv";
  const { apiBaseUrl } = useSettingsStore();
  const { showModal: showRemoteModal, lastMessage, targetPage, clearMessage } = useRemoteControlStore();

  const [query, setQuery] = useState("");
  const [hotWords, setHotWords] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [results, setResults] = useState<MusicSong[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [srcMode, setSrcMode] = useState<SrcMode>("all");
  const inputRef = useRef<TextInput>(null);

  // 跨组件搜索请求（如全屏播放器点歌手名 → 自动搜索）
  const searchRequest = useMusicStore((s) => s.searchRequest);
  const clearSearchRequest = useMusicStore((s) => s.clearSearchRequest);

  /* 热搜 + 历史 */
  useEffect(() => {
    (async () => {
      setHistory(await getSearchHistory());
      try {
        const res = await api.musicHotSearch("kw");
        const raw = res?.data?.list || res?.data?.hots || res?.data || [];
        const words: string[] = (Array.isArray(raw) ? raw : [])
          .map((x: any) => (typeof x === "string" ? x : x?.name || x?.keyword || x?.word || ""))
          .filter((w: string) => !!w)
          .slice(0, 12);
        setHotWords(words);
      } catch {
        /* 忽略 */
      }
    })();
  }, [apiBaseUrl]);

  const doSearch = useCallback(
    async (q?: string, srcOverride?: SrcMode) => {
      const term = (q ?? "").trim();
      if (!term) return;
      const mode = srcOverride || srcMode;
      setQuery(term);
      setIsSearching(true);
      setSearched(true);
      try {
        const sources = mode === "all" ? ["wy", "kw"] : [mode];
        const resList = await Promise.all(
          sources.map((s) => api.musicSearch(term, s, 30).catch(() => null))
        );
        const seen = new Set<string>();
        const merged: MusicSong[] = [];
        for (const res of resList) {
          const l: MusicSong[] = res?.data?.list || [];
          for (const s of l) {
            if (!s?.songId || !s?.name) continue;
            const k = `${norm(s.name)}|${norm(s.artist || "")}`;
            if (seen.has(k)) continue;
            seen.add(k);
            merged.push(s);
          }
        }
        setResults(merged);
        setHistory(await pushSearchHistory(term));
        if (!merged.length) logger.info("no results for", term);
      } catch (e) {
        logger.error("search failed", e);
      } finally {
        setIsSearching(false);
      }
    },
    [srcMode]
  );

  /* 跨组件搜索请求（全屏播放器点歌手名等） */
  useEffect(() => {
    if (searchRequest) {
      void doSearch(searchRequest);
      clearSearchRequest();
    }
  }, [searchRequest, doSearch, clearSearchRequest]);

  /* 远程输入联动（手机扫码发来的搜索词） */
  useEffect(() => {
    if (lastMessage && targetPage === "music") {
      const real = lastMessage.split("_")[0];
      void doSearch(real);
      clearMessage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessage, targetPage]);

  const chips = (
    <View style={styles.chipsWrap}>
      {history.length > 0 ? (
        <>
          <ThemedText style={styles.chipsTitle}>搜索历史</ThemedText>
          <View style={styles.chipsRow}>
            {history.map((w, i) => (
              <Pressable key={`h-${w}-${i}`} onPress={() => void doSearch(w)} focusable>
                {({ focused }) => (
                  <View style={[styles.chip, focused && isTV ? styles.chipFocused : null]}>
                    <ThemedText style={styles.chipText}>{w}</ThemedText>
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
      <ThemedText style={[styles.chipsTitle, { marginTop: 14 }]}>热门搜索</ThemedText>
      <View style={styles.chipsRow}>
        {hotWords.map((w, i) => (
          <Pressable key={`t-${w}-${i}`} onPress={() => void doSearch(w)} focusable>
            {({ focused }) => (
              <View style={[styles.chip, focused && isTV ? styles.chipFocused : null]}>
                <ThemedText style={styles.chipText}>{w}</ThemedText>
              </View>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );

  return (
    <View style={styles.root}>
      {/* 输入区 */}
      {isTV ? (
        <View style={styles.tvInputRow}>
          <Pressable onPress={() => showRemoteModal("music")} focusable hasTVPreferredFocus>
            {({ focused }) => (
              <View style={[styles.tvInputBtn, focused ? styles.tvInputBtnFocused : null]}>
                <Smartphone size={18} color="#1DB954" />
                <ThemedText style={styles.tvInputText}>手机扫码输入</ThemedText>
              </View>
            )}
          </Pressable>
          {query ? (
            <View style={styles.tvQueryBox}>
              <ThemedText style={styles.tvQueryText} numberOfLines={1}>
                {query}
              </ThemedText>
              <Pressable
                onPress={() => {
                  setQuery("");
                  setResults([]);
                  setSearched(false);
                }}
                focusable
              >
                <X size={16} color="#888" />
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.mobileInputRow}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="搜索歌曲 / 歌手"
            placeholderTextColor="#888"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => void doSearch(query)}
          />
          <Pressable onPress={() => void doSearch(query)} style={styles.searchBtn}>
            <ThemedText style={styles.searchBtnText}>搜索</ThemedText>
          </Pressable>
        </View>
      )}

      {/* 搜索源切换 */}
      <View style={styles.srcRow}>
        {SRC_TABS.map((t) => {
          const active = srcMode === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => {
                setSrcMode(t.key);
                if (searched && query) void doSearch(query, t.key);
              }}
              focusable
            >
              {({ focused }) => (
                <View
                  style={[
                    styles.srcChip,
                    active ? styles.srcChipActive : null,
                    focused && isTV ? styles.srcChipFocused : null,
                  ]}
                >
                  <ThemedText style={[styles.srcText, active ? styles.srcTextActive : null]}>
                    {t.label}
                  </ThemedText>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      {/* 结果 / 推荐词 */}
      {searched ? (
        isSearching ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#1DB954" />
          </View>
        ) : (
          <SongList
            songs={results}
            ListEmptyComponent={
              <View style={styles.center}>
                <ThemedText style={{ opacity: 0.5 }}>没有找到相关歌曲</ThemedText>
              </View>
            }
          />
        )
      ) : (
        chips
      )}

      <RemoteControlModal />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  /* TV 输入 */
  tvInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  tvInputBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#33353B",
  },
  tvInputBtnFocused: {
    borderColor: "#1DB954",
    backgroundColor: "rgba(29,185,84,0.12)",
  },
  tvInputText: {
    fontSize: 15,
  },
  tvQueryBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#1B1C1F",
    maxWidth: 360,
  },
  tvQueryText: {
    fontSize: 15,
    opacity: 0.9,
  },
  /* 手机输入 */
  mobileInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  input: {
    flex: 1,
    height: 42,
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 10,
    paddingHorizontal: 14,
    color: "#eee",
    backgroundColor: "#1b1c1f",
    fontSize: 15,
  },
  searchBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#1DB954",
  },
  searchBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
  /* 词条 */
  srcRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  srcChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#1B1C1F",
    borderWidth: 1,
    borderColor: "#2A2C31",
  },
  srcChipActive: {
    backgroundColor: "rgba(29,185,84,0.16)",
    borderColor: "#1DB954",
  },
  srcChipFocused: {
    borderColor: "#1DB954",
  },
  srcText: {
    fontSize: 12,
    opacity: 0.7,
  },
  srcTextActive: {
    color: "#1DB954",
    fontWeight: "700",
    opacity: 1,
  },
  chipsWrap: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  chipsTitle: {
    fontSize: 14,
    opacity: 0.6,
    marginBottom: 8,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#1B1C1F",
    borderWidth: 1,
    borderColor: "#2A2C31",
  },
  chipFocused: {
    borderColor: "#1DB954",
    backgroundColor: "rgba(29,185,84,0.12)",
  },
  chipText: {
    fontSize: 13,
    opacity: 0.85,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
  },
});
