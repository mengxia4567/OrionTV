/**
 * 歌词工具 — LRC 解析与定位（纯函数，供 LyricsView 与单测共用）
 *
 * 输入：服务端 lyric 字段（LRC 文本，含 [mm:ss.xx] 时间轴，可能有翻译行/多时间标签）
 * 输出：按时间升序的行数组 + 二分查找当前行
 */

export interface LyricLine {
  timeMs: number;
  text: string;
}

const TIME_TAG = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** 解析 LRC 文本 → 时间行数组（升序，去掉空行） */
export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  if (!lrc) return out;
  for (const raw of lrc.split("\n")) {
    const line = raw.replace(/\r/g, "");
    if (!line.trim()) continue;
    TIME_TAG.lastIndex = 0;
    const times: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = TIME_TAG.exec(line))) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const frac = m[3] ? parseInt(m[3].padEnd(3, "0").slice(0, 3), 10) : 0;
      times.push(min * 60000 + sec * 1000 + frac);
    }
    if (!times.length) continue; // 无时间轴的行（如标题/元数据）跳过
    const text = line.replace(TIME_TAG, "").trim();
    for (const t of times) out.push({ timeMs: t, text });
  }
  out.sort((a, b) => a.timeMs - b.timeMs);
  return out;
}

/** 二分查找：返回 posMs 对应的行索引（无则为 -1） */
export function findLineIndex(lines: LyricLine[], posMs: number): number {
  if (!lines.length) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].timeMs <= posMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** 简单冒烟用例（开发期自查；正式单测可另行补充） */
export function __smokeTestLrc(): boolean {
  const lines = parseLrc("[00:01.50]你好\n[00:03.00][00:05.00]重复行\n[ar:artist]\n");
  if (lines.length !== 3) return false;
  if (lines[0].timeMs !== 1500 || lines[0].text !== "你好") return false;
  if (findLineIndex(lines, 1600) !== 0) return false;
  if (findLineIndex(lines, 5000) !== 2) return false;
  return true;
}
