import Logger from '@/utils/Logger';

const logger = Logger.withTag('TopLevelNav');

/** 顶层导航目的地（首页 / 直播 / 音乐 / 搜索 / 收藏 / 设置） */
export type TopLevelRoute = '/' | '/live' | '/music' | '/search' | '/favorites' | '/settings';

interface RouterLike {
  replace: (href: any) => void;
  push: (href: any) => void;
  back?: () => void;
  canGoBack?: () => boolean;
}

/**
 * 顶层导航统一入口。
 *
 * 为什么不是 router.push：顶层入口是「平级切换」，不是「逐层下钻」。用 push 会不断压栈，
 * 返回键需要一层层弹回去（用户报告的「导航套娃」）。这里用 replace 保证栈深恒定，
 * 并且已经在该路由时不重复导航（避免无谓重挂载）。
 *
 * 下钻类跳转（详情 / 播放页）仍应使用 router.push。
 */
export function navigateTopLevel(router: RouterLike, route: TopLevelRoute, pathname?: string) {
  if (pathname === route) return;
  // 当前在该板块的二级页（如 /music/playlist）时再点同一个板块：回到板块首页（弹出二级页，
  // 保留首页的分区/滚动位置），而不是 replace 出一个全新的首页实例
  if (route !== '/' && pathname?.startsWith(route + '/') && router.canGoBack?.()) {
    router.back?.();
    return;
  }
  try {
    router.replace(route as any);
  } catch (error) {
    // 极端情况下 replace 不可用则退回 push，至少保证功能可用
    logger.warn('replace failed, fallback to push:', error);
    router.push(route as any);
  }
}
