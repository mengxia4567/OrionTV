/**
 * 点播源的展示文案：清晰度 + 两条链路实测速度（直连 / 代理）
 *
 * 速度是 App 自己在设备网络上实测的（services/m3u8.ts measureVodPaths），
 * 服务器测不出来 —— 所以同一部剧在不同源、不同网络下结论会不一样。
 */

export const formatSpeed = (kb?: number): string => {
  if (!kb || kb <= 0) return "速度未知";
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB/s` : `${Math.round(kb)} KB/s`;
};

export interface PathSpeedInfo {
  speedDirect?: number;
  speedProxy?: number;
  path?: "direct" | "proxy";
}

/** 例：直连 1.2 MB/s · 代理 800 KB/s · 用直连 */
export const pathText = (item: PathSpeedInfo): string => {
  const parts: string[] = [];
  if (item.speedDirect) parts.push(`直连 ${formatSpeed(item.speedDirect)}`);
  if (item.speedProxy) parts.push(`代理 ${formatSpeed(item.speedProxy)}`);
  if (!parts.length) return "速度未知";
  const used = item.path === "direct" ? "直连" : item.path === "proxy" ? "代理" : "";
  return parts.join(" · ") + (used ? ` · 用${used}` : "");
};

/** 单行摘要：清晰度 · 链路 · N 集 */
export const sourceMetaText = (
  resolution: string | null | undefined,
  item: PathSpeedInfo,
  episodes?: number,
): string => {
  const parts = [resolution || "清晰度未知", pathText(item)];
  if (episodes && episodes > 1) parts.push(`${episodes} 集`);
  return parts.join(" · ");
};
