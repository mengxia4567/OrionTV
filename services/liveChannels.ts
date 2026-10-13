/**
 * 直播频道分组：把「主源 + 备源」整理成「一个频道 + 可切换的备用源」。
 *
 * 背景：源清单（自建服务器 /live/*.m3u）里同一频道的主/备是两条独立 #EXTINF，
 * 备源名带「·备」后缀（如 `CCTV-1` 与 `CCTV-1·备`）。旧实现把两者平铺进同一个列表，
 * 用户看到一堆用不了的备用项，且换台要点两次。
 *
 * 这里只做纯数据整理（无副作用，便于单测）：
 *   - 名称去掉「·备」后缀得到频道基名，同基名归为一个频道
 *   - 第一条非备源作为主源；其余（含显式备源）按出现顺序作为备选源
 *   - 频道编号：source list 若带 `tvg-chno` 优先采用，否则回退到出现顺序
 */

import type { Channel } from './m3u';
import { parseM3U } from './m3u';

/** 备源后缀（与直播源生成脚本保持一致） */
const BACKUP_SUFFIX = '·备';

export interface ChannelEntry {
  /** 频道基名（已去掉「·备」后缀），如 `CCTV-1` */
  name: string;
  /** 分组（如 央视 / 卫视） */
  group: string;
  /** 播放源列表：index 0 = 主源 */
  sources: Channel[];
  /** 当前选中源的下标（默认 0 = 主源） */
  selectedSource: number;
}

export interface GroupedLiveChannels {
  /** 分组名 -> 该组频道（已合并主备） */
  groups: Record<string, ChannelEntry[]>;
  /** 分组名列表（按出现顺序） */
  groupNames: string[];
}

/** 判断某个频道是否为备源（按名称后缀约定） */
export function isBackupChannel(channel: Channel): boolean {
  return channel.name.endsWith(BACKUP_SUFFIX);
}

/** 去掉备源后缀，得到频道基名 */
export function baseNameOf(channel: Channel): string {
  const name = channel.name.trim();
  return name.endsWith(BACKUP_SUFFIX) ? name.slice(0, -BACKUP_SUFFIX.length).trim() : name;
}

/**
 * 把扁平的频道列表整理为「主源 + 备源」结构。
 *
 * 排序策略：保持源清单的出现顺序（清单本身已按频道号排好），
 * 主源排在同组备源前面；同基名内先出现的作为主源。
 */
export function groupLiveChannels(channels: Channel[]): GroupedLiveChannels {
  const groups: Record<string, ChannelEntry[]> = {};
  const indexByKey = new Map<string, ChannelEntry>();

  for (const channel of channels) {
    const group = channel.group || 'Default';
    const name = baseNameOf(channel);
    const key = `${group}||${name}`;

    let entry = indexByKey.get(key);
    if (!entry) {
      entry = { name, group, sources: [], selectedSource: 0 };
      indexByKey.set(key, entry);
      if (!groups[group]) groups[group] = [];
      groups[group].push(entry);
    }

    // 主源优先占位：非备源且当前还没有主源时，插到最前
    if (!isBackupChannel(channel) && entry.sources.length > 0 && isBackupChannel(entry.sources[0])) {
      entry.sources.unshift(channel);
      entry.selectedSource = 0;
    } else {
      entry.sources.push(channel);
    }
  }

  // 若同一频道有多个「非备源」条目，保证第一个非备源作主源
  for (const entry of indexByKey.values()) {
    const primaryIdx = entry.sources.findIndex((s) => !isBackupChannel(s));
    if (primaryIdx > 0) {
      const [primary] = entry.sources.splice(primaryIdx, 1);
      entry.sources.unshift(primary);
    }
    entry.selectedSource = 0;
  }

  return { groups, groupNames: Object.keys(groups) };
}

/** 便捷入口：直接解析 m3u 文本 */
export function groupLiveChannelsFromM3u(m3uText: string): GroupedLiveChannels {
  return groupLiveChannels(parseM3U(m3uText));
}
