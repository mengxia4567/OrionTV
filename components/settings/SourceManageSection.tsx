import React from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { ThemedText } from "@/components/ThemedText";
import { StyledButton } from "@/components/StyledButton";

/**
 * 设置里的「源管理」入口：查看服务端巡检结论（每源健康/延迟/集数），
 * 并设置本机偏好（隐藏不想看的源、指定优先源）。
 */
interface Props {
  /** 与设置页其它分区保持一致的聚焦回调（这里在点击入口时触发） */
  onFocus?: () => void;
}

export const SourceManageSection = React.forwardRef<View, Props>(({ onFocus }, ref) => {
  const router = useRouter();

  return (
    <View ref={ref} style={styles.container}>
      <ThemedText style={styles.title}>源管理</ThemedText>
      <ThemedText style={styles.desc}>
        查看每个点播源的健康与延迟（服务端每 6 小时巡检，只启用最快的 10 个源）；
        可在这台设备上隐藏不想看的源、指定优先源。
      </ThemedText>
      <StyledButton
        onPress={() => {
          onFocus?.();
          router.push("/sources");
        }}
        style={styles.button}
      >
        <ThemedText style={styles.buttonText}>打开源管理</ThemedText>
      </StyledButton>
    </View>
  );
});
SourceManageSection.displayName = "SourceManageSection";

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  title: { fontSize: 16, fontWeight: "600", marginBottom: 6 },
  desc: { fontSize: 13, color: "#9aa0a6", lineHeight: 19, marginBottom: 10 },
  button: {
    alignSelf: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#2a2f36",
    borderRadius: 8,
  },
  buttonText: { fontSize: 14, color: "#e8eaed" },
});
