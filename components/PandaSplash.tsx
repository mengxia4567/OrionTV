/**
 * PandaSplash — 熊猫入场动画（回退版）
 *
 * 使用场景（PhotoWallSplash 决策层）：
 *   - 未配置服务器地址 / 未登录
 *   - 已登录但首次启动且照片拉取失败（无任何可用照片）
 *
 * 原生 splash 之后接管全屏：图标缩放入场 → 文字上浮 → 停留 → 淡出。
 * 按任意键（TV 确认键）/点击可跳过；无论是否跳过都会回调 onDone。
 */
import React, { useCallback, useEffect, useMemo } from "react";
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
} from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

const LOGO = require("../assets/images/splash-logo.png");
const HOLD_MS = 950;
const OUT_MS = 320;
const BG = "#0B0B0C";
const CREAM = "#F4EFE6";
const CORAL = "#FF6B4A";

interface Props {
  onDone: () => void;
  /** 可选：照片墙回退原因（底部小字，便于定位问题） */
  debugText?: string;
}

export default function PandaSplash({ onDone, debugText }: Props) {
  const { width, height } = useWindowDimensions();
  const logoSize = useMemo(
    () => Math.min(width * 0.34, height * 0.42, 400),
    [width, height]
  );
  const wordSize = useMemo(() => Math.min(width * 0.045, 56), [width]);

  const overlayOpacity = useSharedValue(1);
  const logoOpacity = useSharedValue(0);
  const logoScale = useSharedValue(0.85);
  const textOpacity = useSharedValue(0);
  const textShift = useSharedValue(26);
  const hintOpacity = useSharedValue(0);

  useEffect(() => {
    const ease = Easing.out(Easing.cubic);
    logoOpacity.value = withTiming(1, { duration: 300, easing: ease });
    logoScale.value = withTiming(1, { duration: 300, easing: ease });
    textOpacity.value = withDelay(150, withTiming(1, { duration: 350, easing: ease }));
    textShift.value = withDelay(150, withTiming(0, { duration: 350, easing: ease }));
    hintOpacity.value = withDelay(700, withTiming(0.45, { duration: 300 }));
    overlayOpacity.value = withDelay(
      HOLD_MS,
      withTiming(0, { duration: OUT_MS, easing: Easing.in(Easing.quad) }, (finished) => {
        if (finished) {
          runOnJS(onDone)();
        }
      })
    );
    // 挂载时启动一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const skip = useCallback(() => {
    overlayOpacity.value = withTiming(0, { duration: 120 }, (finished) => {
      if (finished) {
        runOnJS(onDone)();
      }
    });
  }, [onDone, overlayOpacity]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));
  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));
  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textShift.value }],
  }));
  const hintStyle = useAnimatedStyle(() => ({
    opacity: hintOpacity.value,
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, overlayStyle]}>
      <Pressable
        style={styles.press}
        focusable
        {...(Platform.isTV ? { hasTVPreferredFocus: true } : {})}
        onPress={skip}
      >
        <Animated.View style={logoStyle}>
          <Image
            source={LOGO}
            style={{ width: logoSize, height: logoSize }}
            resizeMode="contain"
          />
        </Animated.View>
        <Animated.View style={textStyle}>
          <Text style={[styles.wordmark, { fontSize: wordSize }]}>
            福宝观影
            <Text style={styles.dot}> ·</Text>
          </Text>
        </Animated.View>
        <Animated.Text style={[styles.hint, hintStyle]}>按确认键跳过</Animated.Text>
        {debugText ? <Text style={styles.debug}>{debugText}</Text> : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: BG,
    alignItems: "center",
    justifyContent: "center",
  },
  press: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  wordmark: {
    color: CREAM,
    fontWeight: "600",
    letterSpacing: 8,
    marginTop: 30,
  },
  dot: {
    color: CORAL,
  },
  hint: {
    position: "absolute",
    bottom: 46,
    color: CREAM,
    fontSize: 14,
    letterSpacing: 3,
  },
  debug: {
    position: "absolute",
    bottom: 16,
    left: 0,
    right: 0,
    textAlign: "center",
    color: "#8A8A93",
    fontSize: 12,
    letterSpacing: 1,
  },
});
