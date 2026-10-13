/**
 * 音乐 — 主入口（发现 / 搜索 / 我的）
 *
 * - 迷你播放条 / 全屏播放器由 _layout 全局挂载（本页不含播放控件）
 * - 电视端：无外壳（自绘标题 + tab 行）；手机/平板：ResponsiveNavigation 包裹
 * - 子页：/music/playlist（歌单/榜单详情）
 */
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Music as MusicIcon } from "lucide-react-native";

import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import ResponsiveNavigation from "@/components/navigation/ResponsiveNavigation";
import ResponsiveHeader from "@/components/navigation/ResponsiveHeader";
import DiscoverPane, { OpenListArg } from "@/components/music/DiscoverPane";
import SearchPane from "@/components/music/SearchPane";
import MinePane from "@/components/music/MinePane";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { useBackToHome } from "@/hooks/useBackToHome";
import { useMusicStore } from "@/stores/musicStore";

type TabKey = "discover" | "search" | "mine";

const TABS: { key: TabKey; label: string }[] = [
  { key: "discover", label: "发现" },
  { key: "search", label: "搜索" },
  { key: "mine", label: "我的" },
];

export default function MusicScreen() {
  const { deviceType } = useResponsiveLayout();
  const isTV = deviceType === "tv";
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("discover");

  // 返回键：回首页，而不是直接退出应用（音乐页是顶层导航栈底）
  useBackToHome();

  // 跨组件搜索请求（如全屏播放器点歌手名）→ 自动切到「搜索」分区
  const searchRequest = useMusicStore((s) => s.searchRequest);
  useEffect(() => {
    if (searchRequest) setTab("search");
  }, [searchRequest]);

  const openList = (arg: OpenListArg) => {
    router.push({
      pathname: "/music/playlist",
      params: { kind: arg.kind, source: arg.source, id: arg.id, title: arg.title },
    });
  };

  const content = (
    <ThemedView style={styles.container}>
      {/* 头部：标题（仅 TV 自绘；手机端由 ResponsiveHeader 提供）+ 分区 tab */}
      <View style={[styles.header, isTV ? styles.headerTv : null]}>
        {isTV ? (
          <View style={styles.titleRow}>
            <MusicIcon size={isTV ? 26 : 20} color="#1DB954" />
            <ThemedText style={[styles.title, isTV ? styles.titleTv : null]}>音乐</ThemedText>
          </View>
        ) : null}
        <View style={[styles.tabRow, isTV ? null : { marginTop: 4 }]}>
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <Pressable key={t.key} onPress={() => setTab(t.key)} focusable hasTVPreferredFocus={t.key === "discover"}>
                {({ focused }) => (
                  <View
                    style={[
                      styles.tabItem,
                      active ? styles.tabItemActive : null,
                      focused && isTV ? styles.tabItemFocused : null,
                    ]}
                  >
                    <ThemedText style={[styles.tabText, active ? styles.tabTextActive : null]}>
                      {t.label}
                    </ThemedText>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* 内容区 */}
      <View style={styles.body}>
        {tab === "discover" ? <DiscoverPane onOpenList={openList} /> : null}
        {tab === "search" ? <SearchPane /> : null}
        {tab === "mine" ? <MinePane onOpenList={openList} /> : null}
      </View>
    </ThemedView>
  );

  if (isTV) {
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
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  headerTv: {
    paddingHorizontal: 24,
    paddingTop: 22,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
  },
  titleTv: {
    fontSize: 28,
  },
  tabRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  tabItem: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#1B1C1F",
    borderWidth: 1,
    borderColor: "#2A2C31",
  },
  tabItemActive: {
    backgroundColor: "rgba(29,185,84,0.16)",
    borderColor: "#1DB954",
  },
  tabItemFocused: {
    borderColor: "#1DB954",
  },
  tabText: {
    fontSize: 14,
    opacity: 0.75,
  },
  tabTextActive: {
    color: "#1DB954",
    fontWeight: "700",
    opacity: 1,
  },
  body: {
    flex: 1,
  },
});
