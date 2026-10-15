import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";

/** 微光色块（骨架屏基础单元）：明暗呼吸，代替单一转圈 */
const Shimmer = ({
  width,
  height,
  radius = 8,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: any;
}) => {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.6] });

  return (
    <Animated.View
      style={[{ width: width ?? "100%", height, borderRadius: radius, backgroundColor: "#3a3d42", opacity }, style]}
    />
  );
};

/** 搜索 / 列表加载：海报卡片骨架网格（按设备给列数） */
export const PosterGridSkeleton = ({ count = 12 }: { count?: number }) => {
  const { deviceType, spacing } = useResponsiveLayout();
  const cols = deviceType === "tv" ? 6 : deviceType === "tablet" ? 5 : 3;
  const rows = Math.ceil(count / cols);

  return (
    <View style={[styles.grid, { paddingHorizontal: spacing }]}>
      {Array.from({ length: rows }).map((_, r) => (
        <View key={r} style={styles.row}>
          {Array.from({ length: cols }).map((__, c) => {
            const idx = r * cols + c;
            if (idx >= count) return <View key={c} style={styles.cell} />;
            return (
              <View key={c} style={styles.cell}>
                <Shimmer style={{ aspectRatio: 2 / 3, width: "100%" }} radius={10} />
                <Shimmer height={12} width="82%" style={{ marginTop: 8 }} radius={4} />
                <Shimmer height={10} width="55%" style={{ marginTop: 6 }} radius={4} />
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
};

/** 详情页加载：大图 + 标题 + 简介 + 一排「剧集 / 源」占位 */
export const DetailSkeleton = () => {
  const { deviceType, spacing } = useResponsiveLayout();
  const isMobile = deviceType === "mobile";

  return (
    <View style={[styles.detail, { padding: spacing }]}>
      <View style={isMobile ? styles.detailMobileTop : styles.detailWideTop}>
        <Shimmer
          style={{
            width: isMobile ? 110 : 180,
            height: isMobile ? 165 : 270,
            flexGrow: 0,
          }}
          radius={12}
        />
        <View style={styles.detailInfo}>
          <Shimmer height={22} width="70%" radius={6} />
          <Shimmer height={13} width="40%" style={{ marginTop: 10 }} radius={4} />
          <Shimmer height={11} width="100%" style={{ marginTop: 16 }} radius={4} />
          <Shimmer height={11} width="92%" style={{ marginTop: 8 }} radius={4} />
          <Shimmer height={11} width="60%" style={{ marginTop: 8 }} radius={4} />
        </View>
      </View>

      <Shimmer height={16} width={120} style={{ marginTop: spacing, marginBottom: spacing / 2 }} radius={5} />
      <Shimmer height={64} radius={10} />

      <Shimmer height={16} width={120} style={{ marginTop: spacing, marginBottom: spacing / 2 }} radius={5} />
      <View style={styles.chips}>
        {Array.from({ length: 10 }).map((_, i) => (
          <Shimmer key={i} height={isMobile ? 32 : 36} width={isMobile ? 62 : 74} radius={8} style={{ margin: 3 }} />
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  grid: { paddingTop: 8 },
  row: { flexDirection: "row" },
  cell: { flex: 1, margin: 6 },
  detail: { flex: 1 },
  detailMobileTop: { flexDirection: "row" },
  detailWideTop: { flexDirection: "row" },
  detailInfo: { flex: 1, marginLeft: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap" },
});
