import { useWindowDimensions } from "react-native";
import { ResizeMode } from "expo-av";
import { useAspectStore } from "@/stores/aspectStore";
import { resolveVideoFit, Size, VideoFit } from "@/utils/aspectMode";

const RESIZE_MODE: Record<VideoFit, ResizeMode> = {
  contain: ResizeMode.CONTAIN,
  cover: ResizeMode.COVER,
  stretch: ResizeMode.STRETCH,
};

/** 当前应使用的画面缩放方式（全屏时按用户选择的比例，非全屏始终适应） */
export function useVideoFit(natural: Size | null, fullscreen: boolean): ResizeMode {
  const mode = useAspectStore((s) => s.mode);
  const { width, height } = useWindowDimensions();
  return RESIZE_MODE[resolveVideoFit(mode, natural, { width, height }, fullscreen)];
}
