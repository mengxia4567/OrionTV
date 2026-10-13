/**
 * MinePane — 我的（我的歌单 + 播放历史）
 * 歌单点击 → 详情页；历史直接列表播放（点击行 = 从该曲起播）
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { ListMusic, ChevronRight, Plus, Trash2, Pencil } from "lucide-react-native";
import Toast from "react-native-toast-message";

import { ThemedText } from "@/components/ThemedText";
import SongList from "@/components/music/SongList";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { useFocusEffect } from "expo-router";
import { api } from "@/services/api";
import { MusicSong } from "@/stores/musicStore";
import { OpenListArg } from "@/components/music/DiscoverPane";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("MusicMine");

export default function MinePane({ onOpenList }: { onOpenList: (arg: OpenListArg) => void }) {
  const { deviceType } = useResponsiveLayout();
  const isTV = deviceType === "tv";
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [history, setHistory] = useState<MusicSong[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editTarget, setEditTarget] = useState<any | null>(null);

  const openCreate = () => {
    setModalMode("create");
    setEditTarget(null);
    setNewName("");
    setCreateOpen(true);
  };

  const openEdit = (pl: any) => {
    setModalMode("edit");
    setEditTarget(pl);
    setNewName(pl?.name || "");
    setCreateOpen(true);
  };

  const submitModal = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const res =
        modalMode === "edit" && editTarget
          ? await api.musicPlaylistUpdate(String(editTarget.id), { name })
          : await api.musicPlaylistCreate(name);
      if (res?.success === false) throw new Error(res?.error?.message || "failed");
      Toast.show({ type: "success", text1: modalMode === "edit" ? "已保存" : "歌单已创建" });
      setCreateOpen(false);
      setNewName("");
      setEditTarget(null);
      await load();
    } catch {
      Toast.show({ type: "error", text1: modalMode === "edit" ? "保存失败，请重试" : "创建失败，请重试" });
    } finally {
      setCreating(false);
    }
  };

  /** 删除歌单 */
  const handleDelete = async (pl: any) => {
    try {
      const r = await api.musicPlaylistDelete(String(pl.id));
      if (r?.success === false) throw new Error(r?.error?.message || "failed");
      Toast.show({ type: "success", text1: `已删除「${pl.name}」` });
      await load();
    } catch {
      Toast.show({ type: "error", text1: "删除失败，请重试" });
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, h] = await Promise.all([
        api.musicPlaylists().catch(() => null),
        api.musicHistory().catch(() => null),
      ]);
      setPlaylists(p?.data?.playlists || []);
      const recs: any[] = h?.data?.records || [];
      const songs: MusicSong[] = recs
        .map((r: any) => {
          const base = r?.song ? r.song : r;
          if (!base || !base.songId || !base.name) return null;
          const sec = Number(r?.playProgressSec ?? r?.song?.playProgressSec ?? 0);
          const resumeMs = sec * 1000;
          // 仅 >5 秒的进度视为可续播点
          return resumeMs > 5000 ? { ...base, resumeMs } : base;
        })
        .filter((s: any) => !!s)
        .slice(0, 100);
      setHistory(songs);
    } catch (e) {
      logger.error("mine load failed", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1DB954" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.wrap}>
      <View style={styles.sectionRow}>
        <ThemedText style={[styles.sectionTitle, isTV ? styles.sectionTitleTv : null]}>我的歌单</ThemedText>
        <Pressable onPress={openCreate} focusable>
          {({ focused }) => (
            <View style={[styles.newBtn, focused && isTV ? styles.newBtnFocused : null]}>
              <Plus size={15} color="#1DB954" />
              <ThemedText style={styles.newBtnText}>新建歌单</ThemedText>
            </View>
          )}
        </Pressable>
      </View>
      {playlists.length === 0 ? (
        <ThemedText style={styles.empty}>还没有歌单——点击右上角「新建歌单」创建</ThemedText>
      ) : (
        playlists.map((pl, i) => (
          <Pressable
            key={pl.id || i}
            focusable
            onPress={() =>
              onOpenList({
                kind: "songlist",
                source: "my",
                id: String(pl.id),
                title: pl.name || "歌单",
              })
            }
          >
            {({ focused }) => (
              <View style={[styles.plRow, focused && isTV ? styles.plRowFocused : null]}>
                <ListMusic size={isTV ? 22 : 18} color="#1DB954" />
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.plName} numberOfLines={1}>
                    {pl.name}
                  </ThemedText>
                  {pl.description ? (
                    <ThemedText style={styles.plDesc} numberOfLines={1}>
                      {pl.description}
                    </ThemedText>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => openEdit(pl)}
                  hitSlop={8}
                  style={styles.plDelete}
                  accessibilityLabel="编辑歌单"
                >
                  <Pencil size={15} color="#8A8A93" />
                </Pressable>
                <Pressable
                  onPress={() => void handleDelete(pl)}
                  hitSlop={8}
                  style={styles.plDelete}
                  accessibilityLabel="删除歌单"
                >
                  <Trash2 size={16} color="#8A8A93" />
                </Pressable>
                <ChevronRight size={isTV ? 22 : 18} color="#666" />
              </View>
            )}
          </Pressable>
        ))
      )}

      <ThemedText style={[styles.sectionTitle, isTV ? styles.sectionTitleTv : null, { marginTop: 22 }]}>
        播放历史
      </ThemedText>
      <SongList
        songs={history}
        contentPaddingBottom={40}
        ListEmptyComponent={
          <ThemedText style={styles.empty}>暂无播放记录</ThemedText>
        }
      />

      {/* 新建歌单弹窗 */}
      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.modalMask}>
          <View style={styles.modalCard}>
            <ThemedText style={styles.modalTitle}>{modalMode === "edit" ? "编辑歌单" : "新建歌单"}</ThemedText>
            <TextInput
              style={styles.modalInput}
              value={newName}
              onChangeText={setNewName}
              placeholder="歌单名称"
              placeholderTextColor="#888"
              autoFocus
              onSubmitEditing={() => void submitModal()}
            />
            <View style={styles.modalBtns}>
              <Pressable onPress={() => setCreateOpen(false)} style={styles.modalBtn}>
                <ThemedText style={styles.modalBtnText}>取消</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => void submitModal()}
                style={[styles.modalBtn, styles.modalBtnPrimary]}
              >
                {creating ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <ThemedText style={[styles.modalBtnText, { color: "#fff" }]}>
                    {modalMode === "edit" ? "保存" : "创建"}
                  </ThemedText>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  wrap: {
    paddingBottom: 160,
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
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: 16,
  },
  newBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#2A2C31",
  },
  newBtnFocused: {
    borderColor: "#1DB954",
    backgroundColor: "rgba(29,185,84,0.12)",
  },
  newBtnText: {
    fontSize: 13,
    color: "#1DB954",
    fontWeight: "600",
  },
  /* 弹窗 */
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
    padding: 20,
    gap: 14,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "700",
  },
  modalInput: {
    height: 44,
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 10,
    paddingHorizontal: 14,
    color: "#eee",
    backgroundColor: "#141518",
    fontSize: 15,
  },
  modalBtns: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  modalBtn: {
    minWidth: 84,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#26272B",
  },
  modalBtnPrimary: {
    backgroundColor: "#1DB954",
  },
  modalBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
  plRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
  },
  plRowFocused: {
    backgroundColor: "rgba(29,185,84,0.14)",
    borderWidth: 1,
    borderColor: "rgba(29,185,84,0.65)",
  },
  plName: {
    fontSize: 15,
    fontWeight: "600",
  },
  plDesc: {
    fontSize: 12,
    opacity: 0.5,
    marginTop: 2,
  },
  plDelete: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    opacity: 0.45,
    fontSize: 13,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
});
