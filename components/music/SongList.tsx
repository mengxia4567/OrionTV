/**
 * SongList — 歌曲列表（电视/手机通用）
 * 行：序号 / 歌名 / 歌手 / 时长 / 当前播放指示；TV 焦点行高亮
 * 点击行 = 从该行开始播放整单（onPlay 由调用方决定语义，默认 playQueue）
 */
import React, { useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Music as MusicIcon, Plus, X } from "lucide-react-native";
import Toast from "react-native-toast-message";

import { ThemedText } from "@/components/ThemedText";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { useMusicStore, MusicSong } from "@/stores/musicStore";
import { api } from "@/services/api";

interface Props {
  songs: MusicSong[];
  /** 自定义播放行为（默认整单入队从该曲播放） */
  onPlay?: (index: number, songs: MusicSong[]) => void;
  ListHeaderComponent?: React.ComponentType<any> | React.ReactElement | null;
  ListFooterComponent?: React.ComponentType<any> | React.ReactElement | null;
  ListEmptyComponent?: React.ComponentType<any> | React.ReactElement | null;
  onEndReached?: () => void;
  contentPaddingBottom?: number;
  /** 显示行尾「加入歌单」按钮（默认：非 TV 显示） */
  showAdd?: boolean;
  /** 显示行尾「移除」按钮（如我的歌单） */
  onRemove?: (index: number, song: MusicSong) => void;
}

export default function SongList({
  songs,
  onPlay,
  ListHeaderComponent,
  ListFooterComponent,
  ListEmptyComponent,
  onEndReached,
  contentPaddingBottom = 120,
  showAdd,
  onRemove,
}: Props) {
  const { deviceType } = useResponsiveLayout();
  const isTV = deviceType === "tv";
  const current = useMusicStore((s) => s.current);
  const isPlaying = useMusicStore((s) => s.isPlaying);
  const playQueue = useMusicStore((s) => s.playQueue);

  const showAddBtn = showAdd ?? !isTV;

  /* 加入歌单弹层 */
  const [addTarget, setAddTarget] = useState<MusicSong | null>(null);
  const [myLists, setMyLists] = useState<any[]>([]);
  const [adding, setAdding] = useState(false);

  const openAdd = async (song: MusicSong) => {
    setAddTarget(song);
    setMyLists([]);
    try {
      const r = await api.musicPlaylists();
      setMyLists(r?.data?.playlists || []);
    } catch {
      /* 忽略 */
    }
  };

  const doAdd = async (pl: any) => {
    if (!addTarget || adding) return;
    setAdding(true);
    try {
      const r = await api.musicPlaylistAddSong(String(pl.id), addTarget);
      if (r?.success === false) throw new Error(r?.error?.message || "failed");
      Toast.show({ type: "success", text1: `已加入「${pl.name}」` });
      setAddTarget(null);
    } catch (e: any) {
      const msg = String(e?.message || "");
      Toast.show({ type: "error", text1: msg.includes("已在") ? "歌曲已在歌单中" : "加入失败，请重试" });
    } finally {
      setAdding(false);
    }
  };

  const handlePlay = (index: number) => {
    if (onPlay) onPlay(index, songs);
    else void playQueue(songs, index);
  };

  const renderRow = (item: MusicSong, index: number) => {
          const isCurrent = !!current && current.songId === item.songId && current.source === item.source;
          return (
            <Pressable onPress={() => handlePlay(index)} focusable>
              {({ focused }) => (
                <View
                  style={[
                    styles.row,
                    isTV ? styles.rowTv : styles.rowMobile,
                    focused && isTV ? styles.rowFocused : null,
                    isCurrent ? styles.rowCurrent : null,
                  ]}
                >
                  <ThemedText style={[styles.index, isCurrent ? styles.indexActive : null]}>
                    {isCurrent && isPlaying ? "♪" : index + 1}
                  </ThemedText>
                  <View style={styles.meta}>
                    <ThemedText numberOfLines={1} style={[styles.name, isCurrent ? styles.nameActive : null]}>
                      {item.name}
                    </ThemedText>
                    <ThemedText numberOfLines={1} style={styles.artist}>
                      {item.artist}
                      {item.album ? ` · ${item.album}` : ""}
                    </ThemedText>
                  </View>
                  <ThemedText style={styles.dur}>{item.durationText || ""}</ThemedText>
                  {isCurrent ? <MusicIcon size={isTV ? 18 : 15} color="#1DB954" /> : null}
                  {showAddBtn ? (
                    <Pressable
                      onPress={() => void openAdd(item)}
                      hitSlop={8}
                      style={styles.rowAction}
                      accessibilityLabel="加入歌单"
                    >
                      <Plus size={17} color="#9AA0A6" />
                    </Pressable>
                  ) : null}
                  {onRemove ? (
                    <Pressable
                      onPress={() => onRemove(index, item)}
                      hitSlop={8}
                      style={styles.rowAction}
                      accessibilityLabel="移除"
                    >
                      <X size={17} color="#9AA0A6" />
                    </Pressable>
                  ) : null}
                </View>
              )}
            </Pressable>
          );
  };

  return (
    <>
      {isTV ? (
        /*
         * TV：不用 FlatList。榜单/歌单页上 FlatList 在 react-native-tvos 里会塌成 1~2dp（父层高度明明确定，
         * flex:1 却没撑开，v1.8.9 起就如此），用 ScrollView + map 规避（榜单 ~100 行量级，行不复杂）。
         * 「滚到底加载更多」自己用 onScroll 判断。
         */
        <ScrollView
          style={styles.list}
          contentContainerStyle={{ paddingBottom: contentPaddingBottom }}
          scrollEventThrottle={200}
          onScroll={(e) => {
            const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
            if (onEndReached && contentOffset.y + layoutMeasurement.height >= contentSize.height - layoutMeasurement.height * 0.4) {
              onEndReached();
            }
          }}
        >
          {ListHeaderComponent ? (React.isValidElement(ListHeaderComponent) ? ListHeaderComponent : React.createElement(ListHeaderComponent as React.ComponentType<any>)) : null}
          {songs.length === 0 && ListEmptyComponent
            ? React.isValidElement(ListEmptyComponent)
              ? ListEmptyComponent
              : React.createElement(ListEmptyComponent as React.ComponentType<any>)
            : null}
          {songs.map((item, index) => (
            <React.Fragment key={`${item.source}-${item.songId}-${index}`}>{renderRow(item, index)}</React.Fragment>
          ))}
          {ListFooterComponent ? (React.isValidElement(ListFooterComponent) ? ListFooterComponent : React.createElement(ListFooterComponent as React.ComponentType<any>)) : null}
        </ScrollView>
      ) : (
      <FlatList
        data={songs}
        keyExtractor={(item, i) => `${item.source}-${item.songId}-${i}`}
        ListHeaderComponent={ListHeaderComponent}
        ListFooterComponent={ListFooterComponent}
        ListEmptyComponent={ListEmptyComponent}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        contentContainerStyle={{ paddingBottom: contentPaddingBottom }}
        style={styles.list}
        renderItem={({ item, index }) => renderRow(item, index)}
      />
      )}

      {/* 选择歌单弹层 */}
      <Modal
        visible={!!addTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setAddTarget(null)}
      >
        <View style={styles.modalMask}>
          <View style={styles.modalCard}>
            <ThemedText style={styles.modalTitle} numberOfLines={1}>
              加入歌单：{addTarget?.name}
            </ThemedText>
            {myLists.length === 0 ? (
              <ThemedText style={styles.modalEmpty}>
                还没有歌单——先到「我的 → 新建歌单」创建一个
              </ThemedText>
            ) : (
              myLists.map((pl, i) => (
                <Pressable key={pl.id || i} onPress={() => void doAdd(pl)} style={styles.plOption}>
                  <ThemedText numberOfLines={1} style={styles.plOptionText}>
                    {pl.name}
                  </ThemedText>
                  {adding ? null : null}
                </Pressable>
              ))
            )}
            <Pressable onPress={() => setAddTarget(null)} style={[styles.modalBtn, { alignSelf: "flex-end" }]}>
              <ThemedText style={styles.modalBtnText}>取消</ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    marginHorizontal: 12,
    marginBottom: 4,
    gap: 12,
  },
  rowTv: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  rowMobile: {
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  rowFocused: {
    backgroundColor: "rgba(29,185,84,0.14)",
    borderWidth: 1,
    borderColor: "rgba(29,185,84,0.65)",
  },
  rowCurrent: {
    backgroundColor: "rgba(29,185,84,0.08)",
  },
  index: {
    width: 30,
    textAlign: "center",
    opacity: 0.5,
    fontSize: 13,
  },
  indexActive: {
    color: "#1DB954",
    opacity: 1,
  },
  meta: {
    flex: 1,
  },
  name: {
    fontSize: 15,
    fontWeight: "600",
  },
  nameActive: {
    color: "#1DB954",
  },
  artist: {
    fontSize: 12,
    opacity: 0.55,
    marginTop: 2,
  },
  dur: {
    fontSize: 12,
    opacity: 0.45,
    marginRight: 6,
  },
  rowAction: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  modalMask: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#1B1C1F",
    borderRadius: 14,
    padding: 18,
    gap: 10,
    maxHeight: "70%",
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 4,
  },
  modalEmpty: {
    fontSize: 13,
    opacity: 0.55,
    paddingVertical: 10,
  },
  plOption: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "#26272B",
  },
  plOptionText: {
    fontSize: 15,
  },
  modalBtn: {
    minWidth: 84,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: "#33353B",
    marginTop: 4,
  },
  modalBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
