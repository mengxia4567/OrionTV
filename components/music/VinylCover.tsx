import React, { useEffect, useRef } from "react";
import { Animated, Easing, Image, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import { Music as MusicIcon } from "lucide-react-native";

interface Props {
  /** 组件占用的宽度（高度 = 封面边长） */
  size: number;
  /** 封面图（可空） */
  uri?: string;
  /** 播放：唱片从封面后滑出并旋转；暂停：停在当前角度并滑回封面后 */
  playing: boolean;
}

/** 转一圈的时长（毫秒）：约 33 转/分，慢而稳，不晕 */
const ROTATE_MS = 20000;
const SLIDE_MS = 520;

/** 以圆心为原点，半径 r、起止角（度）的扇形路径（用来画唱片高光） */
function wedge(r: number, a0: number, a1: number) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const x0 = 50 + r * Math.cos(rad(a0));
  const y0 = 50 + r * Math.sin(rad(a0));
  const x1 = 50 + r * Math.cos(rad(a1));
  const y1 = 50 + r * Math.sin(rad(a1));
  return `M50 50 L${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
}

/**
 * 唱片机风格封面：圆角方形专辑封面（带阴影）+ 身后的黑胶唱片。
 * 播放时唱片从封面右后方滑出并匀速旋转，封面略向左让位；暂停时唱片停在原角度，
 * 并滑回封面背后。旋转/滑动都用 native driver，不占 JS 线程。
 */
export default function VinylCover({ size, uri, playing }: Props) {
  const cover = Math.round(size * 0.7); // 封面边长
  const disc = Math.round(cover * 0.94); // 唱片直径
  const label = Math.round(disc * 0.4); // 唱片中心标签直径
  const hole = Math.max(6, Math.round(disc * 0.035));

  const rot = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(0)).current;
  /** 当前角度（以「圈」为单位，0..1 循环），暂停时记录以便无缝续转 */
  const turns = useRef(0);

  // 滑出 / 滑回
  useEffect(() => {
    Animated.timing(slide, {
      toValue: playing ? 1 : 0,
      duration: SLIDE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [playing, slide]);

  // 旋转（仅播放时）
  useEffect(() => {
    if (!playing) return;
    const start = turns.current % 1;
    rot.setValue(start);
    const anim = Animated.loop(
      Animated.timing(rot, {
        toValue: start + 1,
        duration: ROTATE_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    anim.start();
    return () => {
      anim.stop();
      rot.stopAnimation((v) => {
        turns.current = v % 1;
      });
    };
  }, [playing, rot]);

  const spin = rot.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const coverShift = slide.interpolate({ inputRange: [0, 1], outputRange: [0, -cover * 0.2] });
  const discShift = slide.interpolate({ inputRange: [0, 1], outputRange: [0, cover * 0.3] });

  const left = (size - cover) / 2;
  const discLeft = left + (cover - disc) / 2;
  const discTop = (cover - disc) / 2;
  const radius = Math.round(cover * 0.07);

  return (
    <View style={{ width: size, height: cover }}>
      {/* 唱片（在封面下层） */}
      <Animated.View
        style={[
          styles.abs,
          { left: discLeft, top: discTop, width: disc, height: disc, transform: [{ translateX: discShift }] },
        ]}
      >
        <Animated.View style={{ width: disc, height: disc, transform: [{ rotate: spin }] }}>
          <Svg width={disc} height={disc} viewBox="0 0 100 100">
            <Defs>
              <RadialGradient id="disc" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor="#202127" />
                <Stop offset="0.7" stopColor="#0E0F12" />
                <Stop offset="1" stopColor="#050506" />
              </RadialGradient>
            </Defs>
            <Circle cx="50" cy="50" r="49.5" fill="url(#disc)" />
            {/* 唱片沟纹 */}
            {[46, 43, 40, 37, 34, 31, 28].map((r) => (
              <Circle key={r} cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.055)" strokeWidth="0.35" />
            ))}
            {/* 两道对称高光（随唱片旋转，才有「转起来」的质感） */}
            <Path d={wedge(48.5, -62, -38)} fill="rgba(255,255,255,0.09)" />
            <Path d={wedge(48.5, 118, 142)} fill="rgba(255,255,255,0.09)" />
            <Circle cx="50" cy="50" r="49.3" fill="none" stroke="#2B2C32" strokeWidth="0.6" />
          </Svg>
          {/* 中心标签：封面圆形裁切 + 内圈 + 中心孔 */}
          <View
            style={[
              styles.label,
              {
                width: label,
                height: label,
                borderRadius: label / 2,
                left: (disc - label) / 2,
                top: (disc - label) / 2,
              },
            ]}
          >
            {uri ? (
              <Image source={{ uri }} style={styles.fill} resizeMode="cover" />
            ) : (
              <View style={[styles.fill, styles.center, { backgroundColor: "#1E7A4C" }]}>
                <MusicIcon size={label * 0.45} color="#C8F2DB" />
              </View>
            )}
          </View>
          <View
            style={[
              styles.hole,
              {
                width: hole,
                height: hole,
                borderRadius: hole / 2,
                left: (disc - hole) / 2,
                top: (disc - hole) / 2,
              },
            ]}
          />
        </Animated.View>
      </Animated.View>

      {/* 封面（圆角方形 + 阴影） */}
      <Animated.View
        style={[
          styles.abs,
          styles.coverShadow,
          { left, top: 0, width: cover, height: cover, borderRadius: radius, transform: [{ translateX: coverShift }] },
        ]}
      >
        <View style={[styles.fill, { borderRadius: radius, overflow: "hidden" }]}>
          {uri ? (
            <Image source={{ uri }} style={styles.fill} resizeMode="cover" />
          ) : (
            <LinearGradient colors={["#2E9E66", "#134E34"]} style={[styles.fill, styles.center]}>
              <MusicIcon size={cover * 0.3} color="#E6FFF1" />
            </LinearGradient>
          )}
          {/* 玻璃感高光：左上到右下一层极淡的白 */}
          <LinearGradient
            colors={["rgba(255,255,255,0.14)", "rgba(255,255,255,0)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.7, y: 0.7 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: "absolute" },
  fill: { width: "100%", height: "100%" },
  center: { alignItems: "center", justifyContent: "center" },
  coverShadow: {
    backgroundColor: "#16171B",
    elevation: 14,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  label: {
    position: "absolute",
    overflow: "hidden",
    borderWidth: 3,
    borderColor: "#0A0A0C",
    backgroundColor: "#17181C",
  },
  hole: {
    position: "absolute",
    backgroundColor: "#0A0A0C",
    borderWidth: 1,
    borderColor: "#34353B",
  },
});
