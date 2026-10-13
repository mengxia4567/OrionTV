import { useCallback } from "react";
import { BackHandler, Platform } from "react-native";
import { useFocusEffect, useRouter, usePathname } from "expo-router";
import { navigateTopLevel } from "@/utils/topLevelNav";

/**
 * 非首页的顶层页面（设置 / 直播 / 音乐 / 搜索 / 收藏）统一的返回键行为：
 * 回首页，而不是直接退出应用。
 *
 * 背景：顶层导航改成 navigateTopLevel()（router.replace）之后，这些页面
 * 都成了导航栈的栈底——按返回键时栈里没有上一页可弹，Android 会把整个
 * 应用退出。首页自己有「双击返回退出」的逻辑（app/index.tsx），不复用
 * 这个 hook；这里统一让「非首页」的返回键语义是「回首页」。
 *
 * @param onIntercept 可选：页面内部还有子状态（弹层/列表/全屏播放等）
 *   需要返回键先关它而不是直接离开页面时传入；返回 true 表示「已经消费
 *   了这次返回」，不再导航到首页，返回 false/undefined 则放行。
 */
export function useBackToHome(onIntercept?: () => boolean) {
  const router = useRouter();
  const pathname = usePathname();

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return;

      const handler = () => {
        if (onIntercept && onIntercept()) return true;
        navigateTopLevel(router, "/", pathname);
        return true;
      };

      const sub = BackHandler.addEventListener("hardwareBackPress", handler);
      return () => sub.remove();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router, pathname, onIntercept])
  );
}
