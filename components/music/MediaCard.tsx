/**
 * MediaCard — 封面卡（歌单 / 榜单通用；电视端焦点放大 + 高亮描边，手机端轻触）
 */
import React from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { Music as MusicIcon } from "lucide-react-native";

import { ThemedText } from "@/components/ThemedText";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";

interface Props {
  title: string;
  cover?: string;
  subtitle?: string;
  size: number;
  onPress: () => void;
  hasTVPreferredFocus?: boolean;
}

export default function MediaCard({ title, cover, subtitle, size, onPress, hasTVPreferredFocus }: Props) {
  const { deviceType } = useResponsiveLayout();
  const isTV = deviceType === "tv";
  return (
    <Pressable onPress={onPress} focusable hasTVPreferredFocus={hasTVPreferredFocus}>
      {({ focused }) => (
        <View
          style={[
            styles.card,
            { width: size },
            focused && isTV ? styles.cardFocused : null,
          ]}
        >
          <View style={[styles.coverBox, { width: size, height: size }]}>
            {cover ? (
              <Image source={{ uri: cover }} style={styles.img} resizeMode="cover" />
            ) : (
              <MusicIcon size={Math.round(size * 0.3)} color="#2E7D53" />
            )}
          </View>
          <ThemedText numberOfLines={2} style={[styles.title, { fontSize: isTV ? 15 : 13 }]}>
            {title}
          </ThemedText>
          {subtitle ? (
            <ThemedText numberOfLines={1} style={styles.sub}>
              {subtitle}
            </ThemedText>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 6,
    padding: 6,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "transparent",
  },
  cardFocused: {
    borderColor: "#1DB954",
    backgroundColor: "rgba(29,185,84,0.10)",
    transform: [{ scale: 1.045 }],
  },
  coverBox: {
    borderRadius: 10,
    backgroundColor: "#1B1C1F",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  img: {
    width: "100%",
    height: "100%",
  },
  title: {
    fontWeight: "600",
    lineHeight: 18,
  },
  sub: {
    fontSize: 11,
    opacity: 0.5,
  },
});
