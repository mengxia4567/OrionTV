/**
 * 照片墙网格分档与「定时放大」纯函数（无原生依赖 —— 与 PandaMask.ts 同样独立成文件的原因：
 * PhotoWallSplash 组件链依赖 async-storage / file-system，纯逻辑拆出来才可单测）。
 *
 * 背景：
 *  - v1.8.5：此前网格只看屏幕方向，手机横屏被套用电视的 16 列，单格被压到约 20pt → 「全是小框框」。
 *  - v1.8.9（B1）：手机/平板再降一档（格子更大更疏），且不再拼熊猫（屏幕小、拼不出可辨识图案），
 *    改为「网格 + 定时放大某张」。电视端维持原样。
 */

export type SplashDeviceType = 'tv' | 'tablet' | 'mobile';

/**
 * 按设备 + 朝向决定网格密度（格子数越少，单格越大、观感越清爽）。
 *  - 手机：4×6（竖）/ 6×4（横）
 *  - 平板：6×8（竖）/ 8×6（横）
 *  - 电视：16×9（横）/ 9×16（竖），沿用既有观感
 * cols×rows 均以「列×行」计，朝向跟随屏幕以保持格子近似方形。
 */
export function gridForDevice(
  deviceType: SplashDeviceType,
  portrait: boolean
): { cols: number; rows: number } {
  if (deviceType === 'mobile') return portrait ? { cols: 4, rows: 6 } : { cols: 6, rows: 4 };
  if (deviceType === 'tablet') return portrait ? { cols: 6, rows: 8 } : { cols: 8, rows: 6 };
  return portrait ? { cols: 9, rows: 16 } : { cols: 16, rows: 9 };
}

export interface ZoomRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 计算「放大」后的目标矩形：按图片真实宽高比，在屏幕可用区域内等比居中放到最大。
 *  - maxWRatio / maxHRatio：占屏幕宽/高的上限（留出边距，避免贴边）
 *  - 图片尺寸未知（<=0）时按方形处理
 */
export function computeZoomRect(
  screenW: number,
  screenH: number,
  imgW: number,
  imgH: number,
  maxWRatio = 0.9,
  maxHRatio = 0.72
): ZoomRect {
  const aspect = imgW > 0 && imgH > 0 ? imgW / imgH : 1;
  const maxW = screenW * maxWRatio;
  const maxH = screenH * maxHRatio;
  let w = maxW;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return { x: (screenW - w) / 2, y: (screenH - h) / 2, w, h };
}

/**
 * 选出要「放大」的格子下标：
 *  - 只在有大图的格子里选（没有大图就放大缩略图会糊，宁可不放大）
 *  - 尽量选不同的照片（photoOf[i] = 第 i 格对应的照片序号），避免连放同一张
 *  - count 张；候选不足时返回实际能选出的数量（可能为 0）
 *  - rand 可注入，便于单测
 */
export function pickZoomTargets(
  photoOf: number[],
  hasLarge: boolean[],
  count: number,
  rand: () => number = Math.random
): number[] {
  const cand: number[] = [];
  for (let i = 0; i < photoOf.length; i++) if (hasLarge[i]) cand.push(i);
  // Fisher–Yates 洗牌
  for (let i = cand.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [cand[i], cand[j]] = [cand[j], cand[i]];
  }
  const picked: number[] = [];
  const usedPhotos = new Set<number>();
  for (const i of cand) {
    if (picked.length >= count) break;
    if (usedPhotos.has(photoOf[i])) continue;
    usedPhotos.add(photoOf[i]);
    picked.push(i);
  }
  // 不同照片不够时，用剩余格子补足（保证数量）
  for (const i of cand) {
    if (picked.length >= count) break;
    if (!picked.includes(i)) picked.push(i);
  }
  return picked;
}
