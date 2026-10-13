import { useCallback, useEffect, useRef, useState } from "react";
import { enterImmersive, exitImmersive } from "@/utils/immersiveFullscreen";
import type { NaturalSize } from "@/utils/fullscreenPolicy";

/**
 * 应用内沉浸式全屏状态（手机 / 平板）。
 * - naturalSize：播放器拿到视频真实尺寸后写入；进入全屏时据此决定横/竖，也用于画面比例判断
 * - 页面卸载时若仍在全屏，自动恢复方向与系统栏（防止离开页面后卡在横屏）
 */
export function useImmersiveFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [naturalSize, setNaturalSizeState] = useState<NaturalSize | null>(null);
  const fsRef = useRef(false);
  const naturalSizeRef = useRef<NaturalSize | null>(null);

  const enter = useCallback(async () => {
    if (fsRef.current) return;
    fsRef.current = true;
    setIsFullscreen(true);
    await enterImmersive(naturalSizeRef.current);
  }, []);

  const exit = useCallback(async () => {
    if (!fsRef.current) return;
    fsRef.current = false;
    setIsFullscreen(false);
    await exitImmersive();
  }, []);

  const toggle = useCallback(() => {
    void (fsRef.current ? exit() : enter());
  }, [enter, exit]);

  const setNaturalSize = useCallback((size: NaturalSize) => {
    if (size && size.width > 0 && size.height > 0) {
      naturalSizeRef.current = size;
      setNaturalSizeState((prev) => (prev && prev.width === size.width && prev.height === size.height ? prev : size));
    }
  }, []);

  useEffect(() => {
    return () => {
      if (fsRef.current) {
        fsRef.current = false;
        void exitImmersive();
      }
    };
  }, []);

  return { isFullscreen, enter, exit, toggle, setNaturalSize, naturalSize };
}
