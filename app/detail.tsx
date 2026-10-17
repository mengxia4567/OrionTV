import React, { useEffect, useState } from "react";
import { View, StyleSheet, Image, ScrollView, ActivityIndicator, Modal, FlatList } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { StyledButton } from "@/components/StyledButton";
import { DetailSkeleton } from "@/components/LoadingSkeleton";
import useDetailStore from "@/stores/detailStore";
import { primeVodPathPrefs } from "@/services/vodPath";
import { sourceMetaText } from "@/utils/vodSpeed";
import { FontAwesome } from "@expo/vector-icons";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { api } from "@/services/api";
import { getCommonResponsiveStyles } from "@/utils/ResponsiveStyles";
import ResponsiveNavigation from "@/components/navigation/ResponsiveNavigation";
import ResponsiveHeader from "@/components/navigation/ResponsiveHeader";

export default function DetailScreen() {
  const { q, source, id } = useLocalSearchParams<{ q: string; source?: string; id?: string }>();
  const router = useRouter();

  /** 播放源选择弹窗（原来把每个源平铺成长列表，现在收成一行 + 弹窗选择） */
  const [isSourceModalVisible, setIsSourceModalVisible] = useState(false);

  // 响应式布局配置
  const responsiveConfig = useResponsiveLayout();
  const commonStyles = getCommonResponsiveStyles(responsiveConfig);
  const { deviceType, spacing } = responsiveConfig;

  const {
    detail,
    searchResults,
    loading,
    error,
    allSourcesLoaded,
    init,
    setDetail,
    abort,
    isFavorited,
    toggleFavorite,
  } = useDetailStore();

  useEffect(() => {
    if (q) {
      init(q, source, id);
    }
    return () => {
      abort();
    };
  }, [abort, init, q, source, id]);

  /** 速度与链路文案统一在 utils/vodSpeed.ts（播放页换源弹窗也用同一套） */

  const handlePlay = (episodeIndex: number) => {
    if (!detail) return;
    abort(); // Cancel any ongoing fetches
    router.push({
      pathname: "/play",
      params: {
        // Pass necessary identifiers, the rest will be in the store
        q: detail.title,
        source: detail.source,
        id: detail.id.toString(),
        episodeIndex: episodeIndex.toString(),
      },
    });
  };

  useEffect(() => {
    primeVodPathPrefs().catch(() => undefined);
  }, []);

  if (loading) {
    return <DetailSkeleton />;
  }

  if (error) {
    const content = (
      <ThemedView style={[commonStyles.safeContainer, commonStyles.center]}>
        <ThemedText type="subtitle" style={commonStyles.textMedium}>
          {error}
        </ThemedText>
      </ThemedView>
    );

    if (deviceType === "tv") {
      return content;
    }

    return (
      <ResponsiveNavigation>
        <ResponsiveHeader title="详情" showBackButton />
        {content}
      </ResponsiveNavigation>
    );
  }

  if (!detail) {
    const content = (
      <ThemedView style={[commonStyles.safeContainer, commonStyles.center]}>
        <ThemedText type="subtitle">未找到详情信息</ThemedText>
      </ThemedView>
    );

    if (deviceType === "tv") {
      return content;
    }

    return (
      <ResponsiveNavigation>
        <ResponsiveHeader title="详情" showBackButton />
        {content}
      </ResponsiveNavigation>
    );
  }

  // 动态样式
  const dynamicStyles = createResponsiveStyles(deviceType, spacing);

  /** 源选择弹窗（排序由 store 保证：清晰度 → 实测速度） */
  const sourceModal = (
    <Modal
      animationType="fade"
      transparent
      visible={isSourceModalVisible}
      onRequestClose={() => setIsSourceModalVisible(false)}
    >
      <View style={dynamicStyles.modalBackdrop}>
        <View style={dynamicStyles.modalCard}>
          <ThemedText style={dynamicStyles.modalTitle}>选择播放源（按清晰度排序）</ThemedText>
          <FlatList
            data={searchResults}
            keyExtractor={(item) => `${item.source}-${item.id}`}
            renderItem={({ item, index }) => {
              const selected = detail?.source === item.source;
              return (
                <StyledButton
                  onPress={() => {
                    setDetail(item);
                    setIsSourceModalVisible(false);
                  }}
                  hasTVPreferredFocus={selected || index === 0}
                  isSelected={selected}
                  style={dynamicStyles.srcRow}
                >
                  <View style={dynamicStyles.srcRowInner}>
                    <ThemedText style={dynamicStyles.srcName} numberOfLines={1}>
                      {item.source_name}
                    </ThemedText>
                    <ThemedText style={dynamicStyles.srcMeta}>
                      {sourceMetaText(item.resolution, item, item.episodes.length)}
                    </ThemedText>
                  </View>
                </StyledButton>
              );
            }}
          />
          <StyledButton onPress={() => setIsSourceModalVisible(false)} style={dynamicStyles.modalClose} text="关闭" />
        </View>
      </View>
    </Modal>
  );

  const renderDetailContent = () => {
    if (deviceType === "mobile") {
      // 移动端垂直布局
      return (
        <ScrollView style={dynamicStyles.scrollContainer}>
          {/* 海报和基本信息 */}
          <View style={dynamicStyles.mobileTopContainer}>
            <Image source={api.getImageSource(detail.poster)} style={dynamicStyles.mobilePoster} />
            <View style={dynamicStyles.mobileInfoContainer}>
              <View style={dynamicStyles.titleContainer}>
                <ThemedText style={dynamicStyles.title} numberOfLines={2}>
                  {detail.title}
                </ThemedText>
                <StyledButton onPress={toggleFavorite} variant="ghost" style={dynamicStyles.favoriteButton}>
                  <FontAwesome
                    name={isFavorited ? "heart" : "heart-o"}
                    size={20}
                    color={isFavorited ? "#feff5f" : "#ccc"}
                  />
                </StyledButton>
              </View>
              <View style={dynamicStyles.metaContainer}>
                <ThemedText style={dynamicStyles.metaText}>{detail.year}</ThemedText>
                <ThemedText style={dynamicStyles.metaText}>{detail.type_name}</ThemedText>
              </View>
            </View>
          </View>

          {/* 描述 */}
          <View style={dynamicStyles.descriptionContainer}>
            <ThemedText style={dynamicStyles.description}>{detail.desc}</ThemedText>
          </View>

          {/* 播放源 */}
          <View style={dynamicStyles.sourcesContainer}>
            <View style={dynamicStyles.sourcesTitleContainer}>
              <ThemedText style={dynamicStyles.sourcesTitle}>播放源 ({searchResults.length})</ThemedText>
              {!allSourcesLoaded && <ActivityIndicator style={{ marginLeft: 10 }} />}
            </View>
            <StyledButton
              onPress={() => setIsSourceModalVisible(true)}
              hasTVPreferredFocus
              style={dynamicStyles.sourcePicker}
            >
              <View style={dynamicStyles.sourcePickerInner}>
                <ThemedText style={dynamicStyles.sourcePickerName} numberOfLines={1}>
                  {detail.source_name}
                </ThemedText>
                <ThemedText style={dynamicStyles.sourcePickerMeta}>
                  {sourceMetaText(detail.resolution, detail, detail.episodes.length)}
                </ThemedText>
                <ThemedText style={dynamicStyles.sourcePickerAction}>更换（{searchResults.length} 个源）▾</ThemedText>
              </View>
            </StyledButton>
          </View>

          {/* 剧集列表 */}
          <View style={dynamicStyles.episodesContainer}>
            <ThemedText style={dynamicStyles.episodesTitle}>播放列表</ThemedText>
            <View style={dynamicStyles.episodeList}>
              {detail.episodes.map((episode, index) => (
                <StyledButton
                  key={index}
                  style={dynamicStyles.episodeButton}
                  onPress={() => handlePlay(index)}
                  text={`第 ${index + 1} 集`}
                  textStyle={dynamicStyles.episodeButtonText}
                />
              ))}
            </View>
          </View>
          {sourceModal}
        </ScrollView>
      );
    } else {
      // 平板和TV端水平布局
      return (
        <ScrollView style={dynamicStyles.scrollContainer}>
          <View style={dynamicStyles.topContainer}>
            <Image source={api.getImageSource(detail.poster)} style={dynamicStyles.poster} />
            <View style={dynamicStyles.infoContainer}>
              <View style={dynamicStyles.titleContainer}>
                <ThemedText style={dynamicStyles.title} numberOfLines={1} ellipsizeMode="tail">
                  {detail.title}
                </ThemedText>
                <StyledButton onPress={toggleFavorite} variant="ghost" style={dynamicStyles.favoriteButton}>
                  <FontAwesome
                    name={isFavorited ? "heart" : "heart-o"}
                    size={24}
                    color={isFavorited ? "#feff5f" : "#ccc"}
                  />
                </StyledButton>
              </View>
              <View style={dynamicStyles.metaContainer}>
                <ThemedText style={dynamicStyles.metaText}>{detail.year}</ThemedText>
                <ThemedText style={dynamicStyles.metaText}>{detail.type_name}</ThemedText>
              </View>

              <ScrollView style={dynamicStyles.descriptionScrollView}>
                <ThemedText style={dynamicStyles.description}>{detail.desc}</ThemedText>
              </ScrollView>
            </View>
          </View>

          <View style={dynamicStyles.bottomContainer}>
            <View style={dynamicStyles.sourcesContainer}>
              <View style={dynamicStyles.sourcesTitleContainer}>
                <ThemedText style={dynamicStyles.sourcesTitle}>选择播放源 共 {searchResults.length} 个</ThemedText>
                {!allSourcesLoaded && <ActivityIndicator style={{ marginLeft: 10 }} />}
              </View>
              <StyledButton
                onPress={() => setIsSourceModalVisible(true)}
                hasTVPreferredFocus
                style={dynamicStyles.sourcePicker}
              >
                <View style={dynamicStyles.sourcePickerInner}>
                  <ThemedText style={dynamicStyles.sourcePickerName} numberOfLines={1}>
                    {detail.source_name}
                  </ThemedText>
                  <ThemedText style={dynamicStyles.sourcePickerMeta}>
                    {sourceMetaText(detail.resolution, detail, detail.episodes.length)}
                  </ThemedText>
                  <ThemedText style={dynamicStyles.sourcePickerAction}>更换（{searchResults.length} 个源）▾</ThemedText>
                </View>
              </StyledButton>
            </View>
            <View style={dynamicStyles.episodesContainer}>
              <ThemedText style={dynamicStyles.episodesTitle}>播放列表</ThemedText>
              <ScrollView contentContainerStyle={dynamicStyles.episodeList}>
                {detail.episodes.map((episode, index) => (
                  <StyledButton
                    key={index}
                    style={dynamicStyles.episodeButton}
                    onPress={() => handlePlay(index)}
                    text={`第 ${index + 1} 集`}
                    textStyle={dynamicStyles.episodeButtonText}
                  />
                ))}
              </ScrollView>
            </View>
          </View>
          {sourceModal}
        </ScrollView>
      );
    }
  };

  const content = (
    <ThemedView style={[commonStyles.container, { paddingTop: deviceType === "tv" ? 40 : 0 }]}>
      {renderDetailContent()}
    </ThemedView>
  );

  // 根据设备类型决定是否包装在响应式导航中
  if (deviceType === "tv") {
    return content;
  }

  return (
    <ResponsiveNavigation>
      <ResponsiveHeader title={detail?.title || "详情"} showBackButton />
      {content}
    </ResponsiveNavigation>
  );
}

const createResponsiveStyles = (deviceType: string, spacing: number) => {
  const isTV = deviceType === "tv";
  const isTablet = deviceType === "tablet";
  const isMobile = deviceType === "mobile";

  return StyleSheet.create({
    scrollContainer: {
      flex: 1,
    },

    // 移动端专用样式
    mobileTopContainer: {
      paddingHorizontal: spacing,
      paddingTop: spacing,
      paddingBottom: spacing / 2,
    },
    mobilePoster: {
      width: "100%",
      height: 280,
      borderRadius: 8,
      alignSelf: "center",
      marginBottom: spacing,
    },
    mobileInfoContainer: {
      flex: 1,
    },
    descriptionContainer: {
      paddingHorizontal: spacing,
      paddingBottom: spacing,
    },

    // 平板和TV端样式
    topContainer: {
      flexDirection: "row",
      padding: spacing,
    },
    poster: {
      width: isTV ? 200 : 160,
      height: isTV ? 300 : 240,
      borderRadius: 8,
    },
    infoContainer: {
      flex: 1,
      marginLeft: spacing,
      justifyContent: "flex-start",
    },
    descriptionScrollView: {
      height: 150,
    },

    // 通用样式
    titleContainer: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: spacing / 2,
    },
    title: {
      paddingTop: 16,
      fontSize: isMobile ? 20 : isTablet ? 24 : 28,
      fontWeight: "bold",
      flexShrink: 1,
      color: "white",
    },
    favoriteButton: {
      padding: 10,
      marginLeft: 10,
      backgroundColor: "transparent",
    },
    metaContainer: {
      flexDirection: "row",
      marginBottom: spacing / 2,
    },
    metaText: {
      color: "#aaa",
      marginRight: spacing / 2,
      fontSize: isMobile ? 12 : 14,
    },
    description: {
      fontSize: isMobile ? 13 : 14,
      color: "#ccc",
      lineHeight: isMobile ? 18 : 22,
    },

    // 播放源和剧集样式
    bottomContainer: {
      paddingHorizontal: spacing,
    },
    sourcesContainer: {
      marginTop: spacing,
    },
    sourcesTitleContainer: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: spacing / 2,
    },
    sourcesTitle: {
      fontSize: isMobile ? 16 : isTablet ? 18 : 20,
      fontWeight: "bold",
      color: "white",
    },
    /** 播放源选择器（一行） */
    sourcePicker: {
      marginTop: spacing / 2,
      borderRadius: 10,
    },
    sourcePickerInner: {
      flexDirection: "column",
      alignItems: "flex-start",
    },
    sourcePickerName: {
      fontSize: isMobile ? 14 : 15,
      fontWeight: "600",
      color: "white",
    },
    sourcePickerMeta: {
      fontSize: isMobile ? 12 : 13,
      color: "#bbb",
      marginTop: 2,
    },
    sourcePickerAction: {
      fontSize: isMobile ? 12 : 13,
      color: "#7cc4ff",
      marginTop: 4,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.7)",
      justifyContent: "center",
      alignItems: "center",
      padding: spacing,
    },
    modalCard: {
      width: isMobile ? "92%" : isTablet ? 520 : 620,
      maxHeight: "80%",
      backgroundColor: "#1c1d21",
      borderRadius: 12,
      padding: spacing,
    },
    modalTitle: {
      fontSize: isMobile ? 15 : 17,
      fontWeight: "bold",
      color: "white",
      marginBottom: spacing / 2,
    },
    srcRow: {
      marginVertical: 3,
      borderRadius: 8,
    },
    srcRowInner: {
      flexDirection: "column",
      alignItems: "flex-start",
    },
    srcName: {
      fontSize: isMobile ? 14 : 15,
      color: "white",
      fontWeight: "500",
    },
    srcMeta: {
      fontSize: isMobile ? 12 : 13,
      color: "#aaa",
      marginTop: 2,
    },
    modalClose: {
      marginTop: spacing / 2,
      alignSelf: "flex-end",
    },
    sourceList: {
      flexDirection: "row",
      flexWrap: "wrap",
    },
    sourceButton: {
      margin: isMobile ? 4 : 8,
      minHeight: isMobile ? 36 : 44,
    },
    sourceButtonText: {
      color: "white",
      fontSize: isMobile ? 14 : 16,
    },
    badge: {
      backgroundColor: "#666",
      borderRadius: 10,
      paddingHorizontal: 6,
      paddingVertical: 2,
      marginLeft: 8,
    },
    badgeText: {
      color: "#fff",
      fontSize: isMobile ? 10 : 12,
      fontWeight: "bold",
      paddingBottom: 2.5,
    },
    selectedBadge: {
      backgroundColor: "#4c4c4c",
    },

    episodesContainer: {
      marginTop: spacing,
      paddingBottom: spacing * 2,
    },
    episodesTitle: {
      fontSize: isMobile ? 16 : isTablet ? 18 : 20,
      fontWeight: "bold",
      marginBottom: spacing / 2,
      color: "white",
    },
    episodeList: {
      flexDirection: "row",
      flexWrap: "wrap",
    },
    episodeButton: {
      margin: isMobile ? 3 : 5,
      minHeight: isMobile ? 32 : 36,
    },
    episodeButtonText: {
      color: "white",
      fontSize: isMobile ? 12 : 14,
    },
  });
};
