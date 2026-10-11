import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { Platform, StyleSheet, TextInput, View } from "react-native";
import { useTVEventHandler } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { SettingsSection } from "./SettingsSection";
import { useSettingsStore } from "@/stores/settingsStore";

interface VodProxySectionProps {
  onChanged: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

export interface VodProxySectionRef {
  /** 远程输入：写入当前聚焦的输入框（未聚焦时写入地址框） */
  applyRemoteText: (text: string) => void;
}

export const VodProxySection = forwardRef<VodProxySectionRef, VodProxySectionProps>(
  ({ onChanged, onFocus, onBlur }, ref) => {
    const { vodProxyUrl, vodProxyToken, setVodProxyUrl, setVodProxyToken } = useSettingsStore();
    const [isSectionFocused, setIsSectionFocused] = useState(false);
    const [focusedField, setFocusedField] = useState<"url" | "token" | null>(null);
    const urlRef = useRef<TextInput>(null);
    const tokenRef = useRef<TextInput>(null);

    useImperativeHandle(ref, () => ({
      applyRemoteText: (text: string) => {
        if (focusedField === "token") {
          setVodProxyToken(text);
        } else {
          setVodProxyUrl(text);
        }
        onChanged();
      },
    }));

    // TV 遥控器：聚焦本段后按 OK 进入输入框
    const handleTVEvent = useCallback(
      (event: any) => {
        if (isSectionFocused && event.eventType === "select") {
          (focusedField === "token" ? tokenRef : urlRef).current?.focus();
        }
      },
      [isSectionFocused, focusedField]
    );
    useTVEventHandler(handleTVEvent);

    return (
      <SettingsSection
        focusable
        onFocus={() => {
          setIsSectionFocused(true);
          onFocus?.();
        }}
        onBlur={() => {
          setIsSectionFocused(false);
          setFocusedField(null);
          onBlur?.();
        }}
      >
        <View style={styles.container}>
          <ThemedText style={styles.sectionTitle}>播放代理（可选）</ThemedText>
          <ThemedText style={styles.subtitle}>
            留空 = 走服务器自带代理；填写后点播流直接经该地址代理（填你自己的加速入口地址）
          </ThemedText>
          <TextInput
            ref={urlRef}
            style={[styles.input, focusedField === "url" && styles.inputFocused]}
            value={vodProxyUrl}
            onChangeText={(v) => {
              setVodProxyUrl(v);
              onChanged();
            }}
            placeholder="代理地址，如 https://proxy.example.com"
            placeholderTextColor="#888"
            autoCapitalize="none"
            autoCorrect={false}
            onFocus={() => setFocusedField("url")}
            onBlur={() => setFocusedField((f) => (f === "url" ? null : f))}
          />
          <TextInput
            ref={tokenRef}
            style={[styles.input, styles.input2, focusedField === "token" && styles.inputFocused]}
            value={vodProxyToken}
            onChangeText={(v) => {
              setVodProxyToken(v);
              onChanged();
            }}
            placeholder="代理访问令牌（配合代理地址使用，可留空）"
            placeholderTextColor="#888"
            autoCapitalize="none"
            autoCorrect={false}
            onFocus={() => setFocusedField("token")}
            onBlur={() => setFocusedField((f) => (f === "token" ? null : f))}
          />
        </View>
      </SettingsSection>
    );
  }
);

VodProxySection.displayName = "VodProxySection";

const styles = StyleSheet.create({
  container: {
    padding: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 12,
    opacity: 0.6,
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.isTV ? 10 : 8,
    color: "#eee",
    backgroundColor: "#1b1c1f",
    fontSize: 14,
  },
  input2: {
    marginTop: 8,
  },
  inputFocused: {
    borderColor: "#3b82f6",
  },
});
