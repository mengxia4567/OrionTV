/**
 * 点播源的展示文案：清晰度 + 集数。
 *
 * 不再展示「直连/代理速度」：那是单次采样，电视上经常出现「显示直连很快、播放却一直缓冲」
 * 的误判；线路改由播放页手动切换（见 services/vodPath.ts）。
 */

/** 单行摘要：清晰度 · N 集 */
export const sourceMetaText = (
  resolution: string | null | undefined,
  _item?: unknown,
  episodes?: number,
): string => {
  const parts = [resolution || "清晰度未知"];
  if (episodes && episodes > 1) parts.push(`${episodes} 集`);
  return parts.join(" · ");
};
