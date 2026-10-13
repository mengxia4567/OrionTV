import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  View,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Modal,
  useTVEventHandler,
  HWEvent,
  Text,
  TextInput,
  AppState,
} from "react-native";
import LivePlayer, { LivePlayerHandle } from "@/components/LivePlayer";
import LiveTouchControls from "@/components/LiveTouchControls";
import { useMusicStore } from "@/stores/musicStore";
import { getPlayableUrl } from "@/services/m3u";
import { fetchAndParseM3u } from "@/services/m3uFetch";
import { groupLiveChannels, ChannelEntry } from "@/services/liveChannels";
import { ThemedView } from "@/components/ThemedView";
import { StyledButton } from "@/components/StyledButton";
import { useSettingsStore } from "@/stores/settingsStore";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { getCommonResponsiveStyles } from "@/utils/ResponsiveStyles";
import ResponsiveNavigation from "@/components/navigation/ResponsiveNavigation";
import ResponsiveHeader from "@/components/navigation/ResponsiveHeader";
import { DeviceUtils } from "@/utils/DeviceUtils";
import { ThemedText } from "@/components/ThemedText";
import { useBackToHome } from "@/hooks/useBackToHome";
import { useImmersiveFullscreen } from "@/hooks/useImmersiveFullscreen";
import { useVideoFit } from "@/hooks/useVideoFit";
import { useVideoSession } from "@/hooks/useVideoSession";
import { useRouter, useFocusEffect } from "expo-router";

export default function LiveScreen() {
  const { m3uUrl } = useSettingsStore();
  const router = useRouter();

  // 响应式布局配置
  const responsiveConfig = useResponsiveLayout();
  const commonStyles = getCommonResponsiveStyles(responsiveConfig);
  const { deviceType, spacing } = responsiveConfig;

  // 频道按「主源 + 备源」归并后的结构（一个频道一条，默认主源）
  const [groupedChannels, setGroupedChannels] = useState<Record<string, ChannelEntry[]>>({});
  const [channelGroups, setChannelGroups] = useState<string[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>("");

  /** 当前频道（组内下标）与当前使用的源下标（0 = 主源） */
  const [currentChannelIndex, setCurrentChannelIndex] = useState(0);
  const [currentSourceIndex, setCurrentSourceIndex] = useState(0);
  /** 「源」选择面板（仅展示当前频道的所有源：主源 + 备源） */
  const [isSourcePanelVisible, setIsSourcePanelVisible] = useState(false);
  /** 频道筛选词（手机/平板可直接输入；TV 不弹键盘） */
  const [channelFilter, setChannelFilter] = useState("");
  /** 当前分组下标（TV 列表内左右键切分组用） */
  const currentGroupIndex = Math.max(0, channelGroups.indexOf(selectedGroup));
  const [isLoading, setIsLoading] = useState(false);
  const [isChannelListVisible, setIsChannelListVisible] = useState(false);
  const [channelTitle, setChannelTitle] = useState<string | null>(null);
  const titleTimer = useRef<NodeJS.Timeout | null>(null);
  const playerRef = useRef<LivePlayerHandle>(null);
  // 手机/平板：应用内沉浸式全屏（锁方向 + 隐藏系统栏 + 隐藏页头/底栏）；TV 沿用原生全屏
  const fullscreen = useImmersiveFullscreen();
  const resizeMode = useVideoFit(fullscreen.naturalSize, fullscreen.isFullscreen);

  // 返回键：先关掉频道列表/源选择面板；都关着才回首页（不直接退出应用）
  useBackToHome(
    useCallback(() => {
      if (fullscreen.isFullscreen) {
        void fullscreen.exit();
        return true;
      }
      if (isSourcePanelVisible) {
        setIsSourcePanelVisible(false);
        return true;
      }
      if (isChannelListVisible) {
        setIsChannelListVisible(false);
        return true;
      }
      return false;
    }, [isSourcePanelVisible, isChannelListVisible, fullscreen]),
  );

  /** 当前组的频道列表（换台在同一组内进行）；useMemo 保持引用稳定，避免 useCallback 依赖抖动 */
  const currentGroupChannels = useMemo(() => groupedChannels[selectedGroup] || [], [groupedChannels, selectedGroup]);
  /** 筛选后的频道列表；筛选词为空时等同当前分组全量 */
  const visibleChannels = useMemo(() => {
    const kw = channelFilter.trim().toLowerCase();
    if (!kw) return currentGroupChannels;
    return currentGroupChannels.filter((e) => e.name.toLowerCase().includes(kw));
  }, [currentGroupChannels, channelFilter]);
  const currentEntry = currentGroupChannels[currentChannelIndex] || null;
  const currentSources = currentEntry?.sources || [];
  const currentSource = currentSources[currentSourceIndex] || null;
  const selectedChannelUrl = currentSource ? getPlayableUrl(currentSource.url) : null;

  // 直播与音乐互斥：只在本页聚焦、且音乐未在播放时才允许直播出声；
  // 进入本页时若音乐正在播则主动暂停音乐（刚点的直播优先出声，避免两个音源叠加）
  const musicIsPlaying = useMusicStore((s) => s.isPlaying);
  const [isFocused, setIsFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      if (useMusicStore.getState().isPlaying) {
        void useMusicStore.getState().toggle();
      }
      return () => setIsFocused(false);
    }, []),
  );
  const liveShouldPlay = isFocused && !musicIsPlaying;

  // 通知栏 / 锁屏媒体卡片（手机、平板）：直播没有进度，上一台/下一台对应切台
  const [livePlaying, setLivePlaying] = useState(false);
  const [liveFailed, setLiveFailed] = useState(false);
  useVideoSession({
    enabled: isFocused && !!selectedChannelUrl,
    title: currentEntry?.name ?? "",
    subtitle: [selectedGroup, currentSourceIndex === 0 ? "" : `备源 ${currentSourceIndex}`].filter(Boolean).join(" · "),
    canSkip: currentGroupChannels.length > 1,
    isLive: true,
    playing: livePlaying,
    positionMs: 0,
    durationMs: 0,
    rate: 1,
    onPlay: () => playerRef.current?.play(),
    onPause: () => playerRef.current?.pause(),
    onNext: () => changeChannelRef.current("next"),
    onPrev: () => changeChannelRef.current("prev"),
  });

  // 离开 App（回桌面 / 息屏）时暂停直播；可在通知栏点播放继续（保持与点播一致）
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => {
      if (st !== "active") playerRef.current?.pause();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const loadChannels = async () => {
      if (!m3uUrl) return;
      setIsLoading(true);
      const parsedChannels = await fetchAndParseM3u(m3uUrl);
      // 主/备源归并：一个频道一条，sources[0] 为主源
      const grouped = groupLiveChannels(parsedChannels);
      setGroupedChannels(grouped.groups);
      setChannelGroups(grouped.groupNames);
      setSelectedGroup(grouped.groupNames[0] || "");
      setCurrentChannelIndex(0);
      setCurrentSourceIndex(0);

      const first = (grouped.groups[grouped.groupNames[0] || ""] || [])[0];
      if (first) showChannelTitle(first.name);
      setIsLoading(false);
    };
    loadChannels();
  }, [m3uUrl]);

  const showChannelTitle = (title: string) => {
    setChannelTitle(title);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => setChannelTitle(null), 3000);
  };

  /** 切频道：新频道一律回到主源（避免带着上一个频道的备源下标串台） */
  const handleSelectChannel = (entry: ChannelEntry, index: number) => {
    setCurrentChannelIndex(index);
    setCurrentSourceIndex(0);
    showChannelTitle(entry.name);
    setIsChannelListVisible(false);
  };

  /** 切换当前频道的播放源（0 = 主源，>0 = 备源） */
  const handleSelectSource = (index: number) => {
    setCurrentSourceIndex(index);
    const src = currentSources[index];
    if (src) {
      showChannelTitle(`${currentEntry?.name ?? ""}${index === 0 ? "" : " · 备源" + index}`);
    }
    setIsSourcePanelVisible(false);
  };

  const changeChannel = useCallback(
    (direction: "next" | "prev") => {
      const list = currentGroupChannels;
      if (list.length === 0) return;
      const newIndex =
        direction === "next"
          ? (currentChannelIndex + 1) % list.length
          : (currentChannelIndex - 1 + list.length) % list.length;
      setCurrentChannelIndex(newIndex);
      setCurrentSourceIndex(0);
      showChannelTitle(list[newIndex].name);
    },
    [currentGroupChannels, currentChannelIndex],
  );

  const changeChannelRef = useRef(changeChannel);
  changeChannelRef.current = changeChannel;

  /** 遥控器「上」键：打开当前频道的源选择（手动切备源） */
  const openSourcePanel = useCallback(() => {
    if (currentSources.length > 0) setIsSourcePanelVisible(true);
  }, [currentSources.length]);

  /** 列表内切分组（左右键）：换组后回到该组第一个频道 */
  const changeGroup = useCallback(
    (direction: "next" | "prev") => {
      if (channelGroups.length === 0) return;
      const cur = Math.max(0, channelGroups.indexOf(selectedGroup));
      const next =
        direction === "next"
          ? (cur + 1) % channelGroups.length
          : (cur - 1 + channelGroups.length) % channelGroups.length;
      setSelectedGroup(channelGroups[next]);
      setCurrentChannelIndex(0);
      setCurrentSourceIndex(0);
      setChannelFilter("");
      showChannelTitle(channelGroups[next]);
    },
    [channelGroups, selectedGroup],
  );

  const handleTVEvent = useCallback(
    (event: HWEvent) => {
      if (deviceType !== "tv") return;
      if (isChannelListVisible) return;
      if (event.eventType === "down") setIsChannelListVisible(true);
      else if (event.eventType === "up") openSourcePanel();
      // 列表打开时：左右键切分组（列表内导航）；否则：左右键直接换台
      else if (event.eventType === "left") {
        if (isChannelListVisible) changeGroup("prev");
        else changeChannel("prev");
      } else if (event.eventType === "right") {
        if (isChannelListVisible) changeGroup("next");
        else changeChannel("next");
      }
    },
    [changeChannel, changeGroup, isChannelListVisible, deviceType, openSourcePanel],
  );

  // 只在本页聚焦时响应遥控器：从「去设置」压栈到设置页后，底下的直播页不能再抢按键
  useTVEventHandler(deviceType === "tv" && isFocused ? handleTVEvent : () => {});

  // 动态样式
  const dynamicStyles = createResponsiveStyles(deviceType, spacing);

  const renderLiveContent = () => (
    <>
      <LivePlayer
        ref={playerRef}
        hideFullscreenButton={deviceType !== "tv"}
        onNaturalSize={fullscreen.setNaturalSize}
        resizeMode={resizeMode}
        onFailedChange={setLiveFailed}
        key={selectedChannelUrl || "live-empty"}
        streamUrl={selectedChannelUrl}
        channelTitle={channelTitle}
        onPlaybackStatusUpdate={(st) => setLivePlaying(st.isLoaded && st.isPlaying)}
        shouldPlay={liveShouldPlay}
      />
      <Modal
        animationType="slide"
        transparent={true}
        visible={isChannelListVisible}
        onRequestClose={() => setIsChannelListVisible(false)}
      >
        <View style={dynamicStyles.modalContainer}>
          <View style={dynamicStyles.modalContent}>
            <Text style={dynamicStyles.modalTitle}>选择频道</Text>
            <View style={dynamicStyles.listContainer}>
              <View style={dynamicStyles.groupColumn}>
                <FlatList
                  data={channelGroups}
                  keyExtractor={(item, index) => `group-${item}-${index}`}
                  renderItem={({ item, index }) => (
                    <StyledButton
                      text={item}
                      onPress={() => {
                        setSelectedGroup(item);
                        setCurrentChannelIndex(0);
                        setCurrentSourceIndex(0);
                        setChannelFilter("");
                      }}
                      isSelected={selectedGroup === item}
                      hasTVPreferredFocus={index === currentGroupIndex}
                      style={dynamicStyles.groupButton}
                      textStyle={dynamicStyles.groupButtonText}
                    />
                  )}
                />
              </View>
              <View style={dynamicStyles.channelColumn}>
                {/* 频道筛选：手机/平板可直接输入；TV 不弹软键盘（提示用遥控左右切分组） */}
                {!isLoading && currentGroupChannels.length > 8 ? (
                  <TextInput
                    style={dynamicStyles.filterInput}
                    placeholder={`筛选 ${selectedGroup} 频道`}
                    placeholderTextColor="#7A7C82"
                    value={channelFilter}
                    onChangeText={setChannelFilter}
                    editable={deviceType !== "tv"}
                    showSoftInputOnFocus={deviceType !== "tv"}
                    returnKeyType="search"
                  />
                ) : null}
                {isLoading ? (
                  <ActivityIndicator size="large" />
                ) : (
                  <FlatList
                    data={visibleChannels}
                    keyExtractor={(item, index) => `${item.group}-${item.name}-${index}`}
                    ListEmptyComponent={<Text style={dynamicStyles.emptyText}>没有匹配的频道</Text>}
                    renderItem={({ item, index }) => (
                      <StyledButton
                        text={
                          item.sources.length > 1
                            ? `${item.name}（${item.sources.length} 源）`
                            : item.name || "Unknown Channel"
                        }
                        onPress={() =>
                          handleSelectChannel(
                            item,
                            currentGroupChannels.findIndex((c) => c.name === item.name),
                          )
                        }
                        isSelected={index === currentChannelIndex}
                        hasTVPreferredFocus={index === currentChannelIndex}
                        style={dynamicStyles.channelItem}
                        textStyle={dynamicStyles.channelItemText}
                      />
                    )}
                  />
                )}
              </View>
            </View>
          </View>
        </View>
      </Modal>
      {/* 当前频道的源选择（默认主源，可手动切备源） */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={isSourcePanelVisible}
        onRequestClose={() => setIsSourcePanelVisible(false)}
      >
        <View style={dynamicStyles.modalContainer}>
          <View style={dynamicStyles.modalContent}>
            <Text style={dynamicStyles.modalTitle}>{currentEntry?.name ?? ""} · 选择源</Text>
            <FlatList
              data={currentSources}
              keyExtractor={(item, index) => `src-${index}-${item.id}`}
              renderItem={({ item, index }) => (
                <StyledButton
                  text={index === 0 ? "主源" : `备源 ${index}`}
                  onPress={() => handleSelectSource(index)}
                  isSelected={index === currentSourceIndex}
                  hasTVPreferredFocus={index === currentSourceIndex}
                  style={dynamicStyles.channelItem}
                  textStyle={dynamicStyles.channelItemText}
                />
              )}
              ListEmptyComponent={<Text style={dynamicStyles.modalTitle}>该频道暂无可用源</Text>}
            />
          </View>
        </View>
      </Modal>
      {/* 当前频道常驻角标：换台后不再"3 秒后无从确认"，始终可看 */}
      {currentEntry && !isChannelListVisible ? (
        <View style={liveStyles.nowPlaying} pointerEvents="none">
          <ThemedText style={liveStyles.nowPlayingText}>
            {currentEntry.name}
            {currentSourceIndex === 0 ? "" : ` · 备源 ${currentSourceIndex}`}
            {currentSources.length > 1 ? `（共 ${currentSources.length} 源）` : ""}
          </ThemedText>
        </View>
      ) : null}
      {deviceType !== "tv" && currentGroupChannels.length > 0 ? (
        <LiveTouchControls
          groupName={selectedGroup}
          channelName={currentEntry?.name ?? null}
          sourceLabel={currentSourceIndex === 0 ? "主源" : `备源 ${currentSourceIndex}`}
          canSwitchSource={currentSources.length > 1}
          onPrevChannel={() => changeChannel("prev")}
          onNextChannel={() => changeChannel("next")}
          onPrevGroup={() => changeGroup("prev")}
          onNextGroup={() => changeGroup("next")}
          onOpenList={() => setIsChannelListVisible(true)}
          onOpenSource={openSourcePanel}
          isFullscreen={fullscreen.isFullscreen}
          onToggleFullscreen={fullscreen.toggle}
          failed={liveFailed}
          onRetry={() => playerRef.current?.retry()}
        />
      ) : null}
    </>
  );

  const content = (
    <ThemedView style={[commonStyles.container, dynamicStyles.container]}>
      {m3uUrl ? (
        renderLiveContent()
      ) : (
        <View style={liveStyles.emptyWrap}>
          <ThemedText style={liveStyles.emptyTitle}>未配置直播源</ThemedText>
          <ThemedText style={liveStyles.emptyDesc}>
            请到「设置 → 直播源」填写订阅地址{"\n"}例如：https://你的服务器/live/tv.m3u
          </ThemedText>
          <StyledButton text="去设置" variant="primary" onPress={() => router.push("/settings")} />
        </View>
      )}
    </ThemedView>
  );

  // 根据设备类型决定是否包装在响应式导航中
  if (deviceType === "tv") {
    return content;
  }

  return (
    <ResponsiveNavigation hideChrome={fullscreen.isFullscreen}>
      <ResponsiveHeader title="直播" showBackButton hidden={fullscreen.isFullscreen} />
      {content}
    </ResponsiveNavigation>
  );
}

const createResponsiveStyles = (deviceType: string, spacing: number) => {
  const isMobile = deviceType === "mobile";
  const isTablet = deviceType === "tablet";
  const minTouchTarget = DeviceUtils.getMinTouchTargetSize();

  return StyleSheet.create({
    container: {
      flex: 1,
    },
    modalContainer: {
      flex: 1,
      flexDirection: "row",
      justifyContent: isMobile ? "center" : "flex-end",
      backgroundColor: "transparent",
    },
    modalContent: {
      width: isMobile ? "90%" : isTablet ? 400 : 450,
      height: "100%",
      backgroundColor: "rgba(0, 0, 0, 0.85)",
      padding: spacing,
    },
    modalTitle: {
      color: "white",
      marginBottom: spacing / 2,
      textAlign: "center",
      fontSize: isMobile ? 18 : 16,
      fontWeight: "bold",
    },
    listContainer: {
      flex: 1,
      flexDirection: isMobile ? "column" : "row",
    },
    groupColumn: {
      flex: isMobile ? 0 : 1,
      marginRight: isMobile ? 0 : spacing / 2,
      marginBottom: isMobile ? spacing : 0,
      maxHeight: isMobile ? 120 : undefined,
    },
    channelColumn: {
      flex: isMobile ? 1 : 2,
    },
    groupButton: {
      paddingVertical: isMobile ? minTouchTarget / 4 : 8,
      paddingHorizontal: spacing / 2,
      marginVertical: isMobile ? 2 : 4,
      minHeight: isMobile ? minTouchTarget * 0.7 : undefined,
    },
    groupButtonText: {
      fontSize: isMobile ? 14 : 13,
    },
    channelItem: {
      paddingVertical: isMobile ? minTouchTarget / 5 : 6,
      paddingHorizontal: spacing,
      marginVertical: isMobile ? 2 : 3,
      minHeight: isMobile ? minTouchTarget * 0.8 : undefined,
    },
    channelItemText: {
      fontSize: isMobile ? 14 : 12,
    },
    filterInput: {
      marginBottom: isMobile ? 6 : 8,
      paddingHorizontal: 12,
      paddingVertical: isMobile ? 8 : 6,
      borderRadius: 8,
      backgroundColor: "#1B1C1F",
      color: "#fff",
      fontSize: isMobile ? 14 : 13,
    },
    emptyText: {
      color: "#8A8C92",
      textAlign: "center",
      paddingVertical: 20,
      fontSize: 13,
    },
  });
};

/** 手机端直播补充样式（2026-10-11） */
const liveStyles = StyleSheet.create({
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  emptyDesc: {
    fontSize: 13,
    opacity: 0.6,
    textAlign: "center",
    lineHeight: 20,
  },
  channelBtn: {
    position: "absolute",
    right: 16,
    top: 12,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "rgba(29,185,84,0.92)",
  },
  channelBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
  /** 当前频道常驻角标（左上角，避免换台后无从确认） */
  nowPlaying: {
    position: "absolute",
    left: 12,
    top: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  nowPlayingText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  /** 手机端「源」按钮：位于频道按钮下方，显示当前用的是主源还是备源 */
  sourceBtn: {
    position: "absolute",
    right: 16,
    top: 60,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
});
