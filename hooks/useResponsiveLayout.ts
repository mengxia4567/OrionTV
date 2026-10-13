import { useState, useEffect } from "react";
import { Dimensions, Platform } from "react-native";

export type DeviceType = "mobile" | "tablet" | "tv";

export interface ResponsiveConfig {
  deviceType: DeviceType;
  columns: number;
  cardWidth: number;
  cardHeight: number;
  spacing: number;
  isPortrait: boolean;
  screenWidth: number;
  screenHeight: number;
}

/** 短边 ≥ 600dp 视为平板（Android 的 sw600dp 惯例）；电视只认系统 TV 标志 */
const TABLET_MIN_SHORT_SIDE = 600;

export const resolveDeviceType = (width: number, height: number): DeviceType => {
  if (Platform.isTV) return "tv";
  return Math.min(width, height) >= TABLET_MIN_SHORT_SIDE ? "tablet" : "mobile";
};

const getLayoutConfig = (
  deviceType: DeviceType,
  width: number,
  height: number,
  isPortrait: boolean
): ResponsiveConfig => {
  const spacing = deviceType === "mobile" ? 8 : deviceType === "tablet" ? 12 : 16;

  let columns: number;
  let cardWidth: number;
  let cardHeight: number;

  switch (deviceType) {
    case "mobile":
      columns = isPortrait ? 3 : 4;
      // 使用flex布局，卡片可以更大一些来填充空间
      cardWidth = ((width - spacing) / columns) * 0.85; // 增大到85%
      cardHeight = cardWidth * 1.2; // 5:6 aspect ratio (reduced from 2:3)
      break;

    case "tablet":
      columns = isPortrait ? 3 : 4;
      cardWidth = ((width - spacing) / columns) * 0.85; // 增大到85%
      cardHeight = cardWidth * 1.4; // slightly less tall ratio
      break;

    case "tv":
    default:
      columns = 5;
      cardWidth = 160; // Fixed width for TV
      cardHeight = 240; // Fixed height for TV
      break;
  }

  return {
    deviceType,
    columns,
    cardWidth,
    cardHeight,
    spacing,
    isPortrait,
    screenWidth: width,
    screenHeight: height,
  };
};

export const useResponsiveLayout = (): ResponsiveConfig => {
  const [dimensions, setDimensions] = useState(() => {
    const { width, height } = Dimensions.get("window");
    return { width, height };
  });

  useEffect(() => {
    const subscription = Dimensions.addEventListener("change", ({ window }) => {
      setDimensions({ width: window.width, height: window.height });
    });

    return () => subscription?.remove();
  }, []);

  const { width, height } = dimensions;
  const isPortrait = height > width;
  const deviceType = resolveDeviceType(width, height);

  return getLayoutConfig(deviceType, width, height, isPortrait);
};

// Utility hook for responsive values
export const useResponsiveValue = <T>(values: { mobile: T; tablet: T; tv: T }): T => {
  const { deviceType } = useResponsiveLayout();
  return values[deviceType];
};

// Utility hook for responsive styles
export const useResponsiveStyles = () => {
  const config = useResponsiveLayout();

  return {
    // Common responsive styles
    container: {
      paddingHorizontal: config.spacing,
    },

    // Card styles
    cardContainer: {
      width: config.cardWidth,
      height: config.cardHeight,
      marginBottom: config.spacing,
    },

    // Grid styles
    gridContainer: {
      paddingHorizontal: config.spacing / 2,
    },

    // Typography
    titleFontSize: config.deviceType === "mobile" ? 18 : config.deviceType === "tablet" ? 22 : 28,
    bodyFontSize: config.deviceType === "mobile" ? 14 : config.deviceType === "tablet" ? 16 : 18,

    // Spacing
    sectionSpacing: config.deviceType === "mobile" ? 16 : config.deviceType === "tablet" ? 20 : 24,
    itemSpacing: config.spacing,
  };
};
