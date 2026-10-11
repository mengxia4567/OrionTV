/**
 * 音乐 — MoonTVPlus 音乐模块（经已配置的服务器中转，无需额外设置）
 *
 * 功能：搜索（酷我音源）/ 播放 / 暂停 / 上一首 / 下一首；
 *       支持「手机扫码」远程输入搜索词（TV 上打中文方便）；
 *       热门搜索词一键搜。
 * 入口：侧栏「音乐」（route: /music）
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Audio } from "expo-av";
import { Music as MusicIcon, Pause, Play, SkipBack, SkipForward } from "lucide-react-native";

import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { StyledButton } from "@/components/StyledButton";
import { RemoteControlModal } from "@/components/RemoteControlModal";
import ResponsiveNavigation from "@/components/navigation/ResponsiveNavigation";
import ResponsiveHeader from "@/components/navigation/ResponsiveHeader";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { useSettingsStore } from "@/stores/settingsStore";
import { useRemoteControlStore } from "@/stores/remoteControlStore";
import { api, getStoredAuthToken } from "@/services/api";
import Toast from "react-native-toast-message";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("Music");

interface Song {
  songId: string;
  source: string;
  songmid?: string;
  name: string;
  artist: string;
  album?: string;
  cover?: string;
  durationText?: string;
}

export default function MusicScreen() {
  const { deviceType } = useResponsiveLayout();
  const { apiBaseUrl } = useSettingsStore();
  const { showModal: showRemoteModal, lastMessage, targetPage, clearMessage } =
    useRemoteControlStore();

  const [query, setQuery] = useState("");
  const [hotWords, setHotWords] = useState<string[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);
  const inputRef = useRef<TextInput>(null);

  // 音频会话（TV 上无静音开关，保持简单默认配置即可）
  useEffect(() => {
    Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    }).catch(() => undefined);
    return () => {
      soundRef.current?.unloadAsync().catch(() => undefined);
      soundRef.current = null;
    };
  }, []);

  // 热门搜索
  useEffect(() => {
    (async () => {
      try {
        const res = await api.musicHotSearch("kw");
        const raw = res?.data?.list || res?.data?.hots || res?.data || [];
        const words: string[] = (Array.isArray(raw) ? raw : [])
          .map((x: any) =>
            typeof x === "string" ? x : x?.name || x?.keyword || x?.word || ""
          )
          .filter((w: string) => !!w)
          .slice(0, 14);
        setHotWords(words);
      } catch {
        /* 热点失败不打扰 */
      }
    })();
  }, [apiBaseUrl]);

  const doSearch = useCallback(
    async (q?: string) => {
      const term = (q ?? query).trim();
      if (!term) return;
      setIsSearching(true);
      try {
        const res = await api.musicSearch(term, "kw", 40);
        const list: Song[] = res?.data?.list || [];
        setSongs(list);
        if (list.length === 0) {
          Toast.show({ type: "info", text1: "没有找到相关歌曲" });
        }
      } catch (e) {
        logger.error("music search failed", e);
        Toast.show({ type: "error", text1: "搜索失败，请检查网络或登录状态" });
      } finally {
        setIsSearching(false);
      }
    },
    [query]
  );

  // 远程输入（手机扫码发搜索词）
  useEffect(() => {
    if (lastMessage && targetPage === "music") {
      const real = lastMessage.split("_")[0];
      setQuery(real);
      void doSearch(real);
      clearMessage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessage, targetPage]);

  const playAt = useCallback(
    async (index: number, list?: Song[]) => {
      const arr = list || songs;
      const song = arr[index];
      if (!song) return;
      setIsLoadingAudio(true);
      setCurrentIndex(index);
      try {
        if (soundRef.current) {
          try {
            await soundRef.current.unloadAsync();
          } catch {
            /* ignore */
          }
          soundRef.current = null;
        }
        const uri = api.buildMusicStreamUrl(song, "320k");
        const token = await getStoredAuthToken();
        const headers: Record<string, string> = token
          ? { Authorization: `Token ${token}` }
          : {};
        const { sound } = await Audio.Sound.createAsync(
          { uri, headers },
          { shouldPlay: true, progressUpdateIntervalMillis: 1000 },
          (status) => {
            if (!status.isLoaded) {
              if (status.error) {
                setIsPlaying(false);
                setIsLoadingAudio(false);
                Toast.show({ type: "error", text1: "播放失败，请重试" });
              }
              return;
            }
            setIsLoadingAudio(status.isBuffering && !status.isPlaying);
            setIsPlaying(status.isPlaying);
            if (status.didJustFinish) {
              const next = index + 1;
              if (next < arr.length) {
                setTimeout(() => void playAt(next, arr), 0);
              } else {
                setIsPlaying(false);
              }
            }
          }
        );
        soundRef.current = sound;
      } catch (e) {
        logger.error("music play failed", e);
        setIsLoadingAudio(false);
        setIsPlaying(false);
        Toast.show({ type: "error", text1: "播放失败，请重试" });
      }
    },
    [songs]
  );

  const togglePlay = async () => {
    const s = soundRef.current;
    if (!s) {
      if (songs.length > 0) void playAt(0);
      return;
    }
    try {
      const st = await s.getStatusAsync();
      if (st.isLoaded && st.isPlaying) {
        await s.pauseAsync();
      } else {
        await s.playAsync();
      }
    } catch {
      /* ignore */
    }
  };

  const playPrev = () => {
    if (songs.length === 0) return;
    let i = currentIndex - 1;
    if (i < 0) i = songs.length - 1;
    void playAt(i);
  };

  const playNextBtn = () => {
    if (songs.length === 0) return;
    let i = currentIndex + 1;
    if (i >= songs.length) i = 0;
    void playAt(i);
  };

  const current = currentIndex >= 0 ? songs[currentIndex] : undefined;

  const content = (
    <ThemedView style={styles.container}>
      {/* 头部：搜索 */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <MusicIcon size={22} color="#1DB954" />
          <ThemedText style={styles.title}>音乐</ThemedText>
        </View>
        <View style={styles.searchRow}>
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
            onSubmitEditing={() => void doSearch()}
          />
          <StyledButton
            text="搜索"
            variant="primary"
            onPress={() => void doSearch()}
            style={styles.searchBtn}
          />
          <StyledButton
            text="手机输入"
            onPress={() => showRemoteModal("music")}
            style={styles.searchBtn}
          />
        </View>
      </View>

      {/* 主体 */}
      {songs.length === 0 ? (
        <View style={styles.hotWrap}>
          {isSearching ? (
            <ActivityIndicator size="large" color="#1DB954" />
          ) : (
            <>
              <ThemedText style={styles.hotTitle}>热门搜索</ThemedText>
              <View style={styles.hotRow}>
                {hotWords.map((w, i) => (
                  <StyledButton
                    key={`${w}-${i}`}
                    text={w}
                    onPress={() => {
                      setQuery(w);
                      void doSearch(w);
                    }}
                    style={styles.hotChip}
                    hasTVPreferredFocus={i === 0 && deviceType === "tv"}
                  />
                ))}
              </View>
              {hotWords.length === 0 ? (
                <ThemedText style={styles.hint}>
                  输入关键词搜索，或点「手机输入」扫码用手机打字
                </ThemedText>
              ) : null}
            </>
          )}
        </View>
      ) : (
        <FlatList
          data={songs}
          keyExtractor={(item, idx) => `${item.songId}-${idx}`}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          renderItem={({ item, index }) => (
            <StyledButton
              onPress={() => void playAt(index)}
              isSelected={currentIndex === index}
              style={styles.songRow}
            >
              <View style={styles.songRowInner}>
                <ThemedText style={styles.songIndex}>{index + 1}</ThemedText>
                <View style={styles.songMeta}>
                  <ThemedText style={styles.songName} numberOfLines={1}>
                    {item.name}
                  </ThemedText>
                  <ThemedText style={styles.songArtist} numberOfLines={1}>
                    {item.artist}
                    {item.album ? ` · ${item.album}` : ""}
                  </ThemedText>
                </View>
                <ThemedText style={styles.songDur}>
                  {item.durationText || ""}
                </ThemedText>
                {currentIndex === index && isPlaying ? (
                  <MusicIcon size={16} color="#1DB954" />
                ) : null}
              </View>
            </StyledButton>
          )}
        />
      )}

      {/* 底部播放条 */}
      <View style={styles.player}>
        <View style={styles.nowPlaying}>
          <ThemedText style={styles.nowTitle} numberOfLines={1}>
            {current ? current.name : "未在播放"}
          </ThemedText>
          <ThemedText style={styles.nowSub} numberOfLines={1}>
            {current
              ? `${current.artist}${
                  isLoadingAudio ? " · 加载中…" : isPlaying ? " · 播放中" : ""
                }`
              : ""}
          </ThemedText>
        </View>
        <View style={styles.controls}>
          <StyledButton onPress={playPrev} style={styles.ctrlBtn}>
            <SkipBack size={20} color="#fff" />
          </StyledButton>
          <StyledButton
            onPress={() => void togglePlay()}
            variant="primary"
            style={styles.ctrlBtn}
          >
            {isPlaying ? (
              <Pause size={20} color="#fff" />
            ) : (
              <Play size={20} color="#fff" />
            )}
          </StyledButton>
          <StyledButton onPress={playNextBtn} style={styles.ctrlBtn}>
            <SkipForward size={20} color="#fff" />
          </StyledButton>
        </View>
      </View>

      <RemoteControlModal />
    </ThemedView>
  );

  if (deviceType === "tv") {
    return content;
  }

  return (
    <ResponsiveNavigation>
      <ResponsiveHeader title="音乐" showBackButton />
      {content}
    </ResponsiveNavigation>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f1012",
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 12,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  input: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 8,
    paddingHorizontal: 14,
    color: "#eee",
    backgroundColor: "#1b1c1f",
    fontSize: 15,
  },
  searchBtn: {
    minWidth: 88,
  },
  hotWrap: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 10,
  },
  hotTitle: {
    fontSize: 15,
    opacity: 0.7,
    marginBottom: 12,
  },
  hotRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  hotChip: {
    paddingHorizontal: 16,
  },
  hint: {
    marginTop: 24,
    opacity: 0.5,
    fontSize: 13,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  songRow: {
    marginBottom: 6,
    width: "100%",
  },
  songRowInner: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    gap: 12,
  },
  songIndex: {
    width: 34,
    textAlign: "center",
    opacity: 0.5,
    fontSize: 13,
  },
  songMeta: {
    flex: 1,
  },
  songName: {
    fontSize: 15,
    fontWeight: "600",
  },
  songArtist: {
    fontSize: 12,
    opacity: 0.6,
    marginTop: 2,
  },
  songDur: {
    fontSize: 12,
    opacity: 0.5,
    marginRight: 8,
  },
  player: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#26272b",
    backgroundColor: "#141518",
    gap: 18,
  },
  nowPlaying: {
    flex: 1,
  },
  nowTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  nowSub: {
    fontSize: 12,
    opacity: 0.6,
    marginTop: 2,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  ctrlBtn: {
    minWidth: 64,
    alignItems: "center",
    justifyContent: "center",
  },
});
