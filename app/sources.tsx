import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { StyledButton } from "@/components/StyledButton";
import ResponsiveNavigation from "@/components/navigation/ResponsiveNavigation";
import ResponsiveHeader from "@/components/navigation/ResponsiveHeader";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { getCommonResponsiveStyles } from "@/utils/ResponsiveStyles";
import { fetchVodSourceMeta, type VodSourceMeta } from "@/services/vodSourceMeta";
import {
  getSourcePrefsSync,
  primeSourcePrefs,
  setPreferredSource,
  setSourceHidden,
  subscribeSourcePrefs,
} from "@/services/sourcePrefs";
import { DeviceUtils } from "@/utils/DeviceUtils";

/**
 * 源管理（本机偏好）
 *
 * 服务端每 6 小时巡检一次：43 视角体检 + 只启用最快的 10 个源。
 * 这里展示巡检结论，并允许本机「隐藏不看的源 / 指定优先源」——
 * 注意 `/api/search` 不支持按源过滤，所以隐藏是展示层选择，服务端仍会搜它们。
 */
export default function SourcesScreen() {
  const responsiveConfig = useResponsiveLayout();
  const commonStyles = getCommonResponsiveStyles(responsiveConfig);
  const { deviceType, spacing } = responsiveConfig;
  const isMobile = deviceType === "mobile";

  const [doc, setDoc] = useState<{
    updated_at: string;
    enabled: number;
    count: number;
    sources: VodSourceMeta[];
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [prefs, setPrefs] = useState(getSourcePrefsSync());

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const d = await fetchVodSourceMeta();
      if (!d) {
        setError("没配置直播源地址，无法推导源元数据地址（设置 → 直播源）");
      } else {
        setDoc(d);
      }
    } catch (e) {
      setError(`读取失败：${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    primeSourcePrefs().catch(() => undefined);
    load();
    return subscribeSourcePrefs(() => setPrefs(getSourcePrefsSync()));
  }, [load]);

  const rows = (doc?.sources || []).slice().sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return (a.rank || 999) - (b.rank || 999) || (a.latency_ms || 9999) - (b.latency_ms || 9999);
  });

  const styles = createStyles(deviceType, spacing, isMobile);

  const content = (
    <ThemedView style={[commonStyles.container, styles.container]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.title}>源管理</ThemedText>
            <ThemedText style={styles.sub}>
              {doc
                ? `巡检 ${doc.updated_at.replace("T", " ")} · 启用 ${doc.enabled} / ${doc.count}`
                : "服务端每 6 小时巡检，只启用最快的 10 个源"}
            </ThemedText>
          </View>
          <StyledButton onPress={load} style={styles.refresh}>
            <ThemedText style={styles.refreshText}>刷新</ThemedText>
          </StyledButton>
        </View>

        {!!error && <ThemedText style={styles.error}>{error}</ThemedText>}
        {loading && !doc && <ActivityIndicator style={{ marginTop: 24 }} />}

        {rows.map((s) => {
          const hidden = prefs.hidden.includes(s.key);
          const preferred = prefs.preferred === s.key;
          const status = s.ok === null ? "–" : s.ok ? "✓ 正常" : "✗ 不合格";
          return (
            <View key={s.key} style={[styles.row, !s.enabled && styles.rowOff]}>
              <View style={styles.rowMain}>
                <View style={styles.rowTitleLine}>
                  {s.enabled && !!s.rank && <ThemedText style={styles.rank}>#{s.rank}</ThemedText>}
                  <ThemedText style={styles.name} numberOfLines={1}>
                    {s.name}
                  </ThemedText>
                  {s.enabled ? (
                    <ThemedText style={styles.tagOn}>启用</ThemedText>
                  ) : (
                    <ThemedText style={styles.tagOff}>停用</ThemedText>
                  )}
                  {s.proxy_mode && <ThemedText style={styles.tagProxy}>代理</ThemedText>}
                  {hidden && <ThemedText style={styles.tagHide}>本机隐藏</ThemedText>}
                  {preferred && <ThemedText style={styles.tagPref}>优先</ThemedText>}
                </View>
                <ThemedText style={styles.meta}>
                  {status}
                  {s.latency_ms != null ? ` · ${s.latency_ms}ms` : ""}
                  {s.episodes != null ? ` · ${s.episodes} 集` : ""}
                  {s.resolution ? ` · ${s.resolution}` : ""}
                </ThemedText>
              </View>
              <View style={styles.rowActions}>
                <StyledButton
                  onPress={() => setSourceHidden(s.key, !hidden)}
                  style={styles.smallBtn}
                  text={hidden ? "取消隐藏" : "隐藏"}
                  textStyle={styles.smallBtnText}
                />
                <StyledButton
                  onPress={() => setPreferredSource(preferred ? null : s.key)}
                  style={styles.smallBtn}
                  text={preferred ? "取消优先" : "设为优先"}
                  textStyle={styles.smallBtnText}
                />
              </View>
            </View>
          );
        })}

        <ThemedText style={styles.hint}>
          说明：服务端只启用体检最快的 10 个源（搜索是并行聚合，慢源会把整次搜索拖到超时）；其余源保留在配置里，
          体检合格且排进前 10 会自动启用。「隐藏 / 优先」只影响本机显示与默认选中。
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );

  if (deviceType === "tv") return content;
  return (
    <ResponsiveNavigation>
      <ResponsiveHeader title="源管理" showBackButton />
      {content}
    </ResponsiveNavigation>
  );
}

const createStyles = (deviceType: string, spacing: number, isMobile: boolean) =>
  StyleSheet.create({
    container: { flex: 1 },
    scroll: { padding: spacing, paddingBottom: spacing * 3 },
    headerRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing / 2 },
    title: { fontSize: isMobile ? 18 : 22, fontWeight: "700" },
    sub: { fontSize: isMobile ? 12 : 13, color: "#9aa0a6", marginTop: 2 },
    refresh: { paddingHorizontal: 14, paddingVertical: 6, backgroundColor: "#2a2f36", borderRadius: 8 },
    refreshText: { fontSize: 13, color: "#e8eaed" },
    error: { color: "#f87171", marginTop: spacing / 2, fontSize: 13 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "#1c1f24",
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginTop: 8,
    },
    rowOff: { opacity: 0.55 },
    rowMain: { flex: 1, paddingRight: 8 },
    rowTitleLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
    rank: { fontSize: 12, color: "#4ade80", marginRight: 6, fontWeight: "600" },
    name: { fontSize: isMobile ? 14 : 15, fontWeight: "600", marginRight: 6 },
    tagOn: {
      fontSize: 11,
      color: "#4ade80",
      borderWidth: 1,
      borderColor: "#2f5f43",
      borderRadius: 5,
      paddingHorizontal: 5,
      marginRight: 4,
    },
    tagOff: {
      fontSize: 11,
      color: "#8b9096",
      borderWidth: 1,
      borderColor: "#3a3f46",
      borderRadius: 5,
      paddingHorizontal: 5,
      marginRight: 4,
    },
    tagProxy: {
      fontSize: 11,
      color: "#fbbf24",
      borderWidth: 1,
      borderColor: "#5b4a1a",
      borderRadius: 5,
      paddingHorizontal: 5,
      marginRight: 4,
    },
    tagHide: {
      fontSize: 11,
      color: "#c084fc",
      borderWidth: 1,
      borderColor: "#4c3575",
      borderRadius: 5,
      paddingHorizontal: 5,
      marginRight: 4,
    },
    tagPref: {
      fontSize: 11,
      color: "#60a5fa",
      borderWidth: 1,
      borderColor: "#2b4a7a",
      borderRadius: 5,
      paddingHorizontal: 5,
      marginRight: 4,
    },
    meta: { fontSize: isMobile ? 12 : 13, color: "#9aa0a6", marginTop: 3 },
    rowActions: { flexDirection: "row", alignItems: "center" },
    smallBtn: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 7,
      backgroundColor: "#2a2f36",
      marginLeft: 6,
      minHeight: DeviceUtils.getMinTouchTargetSize() * 0.6,
    },
    smallBtnText: { fontSize: 12, color: "#e8eaed" },
    hint: { fontSize: 12, color: "#7b8189", marginTop: spacing, lineHeight: 18 },
  });
