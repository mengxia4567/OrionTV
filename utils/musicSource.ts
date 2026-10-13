/**
 * 音乐「同款匹配 / 音源标签」纯函数（无原生依赖，可单测）
 *
 * 背景：失败自动换源、手动切源都需要在另一平台（wy ⇄ kw）搜到「同一首歌」。
 * 旧实现是 `list.find(name 相等) || list[0]`——名字对不上时直接取第一条，可能把
 * 「Live 版 / 翻唱 / 完全不同的歌」悄悄塞给用户。这里改为：名字 + 歌手都要对得上，
 * 否则返回 null（宁可明说「没找到同款」，也不乱切）。
 */
export interface SongLike {
  name?: string;
  artist?: string;
  durationText?: string;
}

/** 规范化：小写、去括号内容（版本说明）、去标点空白 */
export function normalizeText(s?: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[(（\[【][^)）\]】]*[)）\]】]/g, "") // (Live) （伴奏） [Remix] 等
    .replace(/[\s\-_–—·.,，。、:：;；'"“”‘’!！?？&＆/\\|]+/g, "");
}

/** 版本标记：这些词出现在歌名里，说明不是「标准录音室版」，换源时必须两边一致 */
const VERSION_KEYWORDS = [
  "live", "现场", "remix", "混音", "dj", "伴奏", "instrumental", "纯音乐", "cover", "翻唱",
  "加速", "降调", "钢琴", "吉他", "acoustic", "demo", "铃声", "粤语", "国语", "日语", "英文版",
  "女声", "男声", "8d", "车载",
];

/** 取歌名里出现的版本标记（排序后拼成稳定字符串；没有则空串） */
export function versionTags(name?: string): string {
  const raw = (name || "").toLowerCase();
  return VERSION_KEYWORDS.filter((k) => raw.includes(k)).sort().join("|");
}

/** 歌手拆分：以 、 / & , 等分隔，返回规范化后的非空片段 */
export function artistTokens(artist?: string): string[] {
  return (artist || "")
    .split(/[、,，/&＆;；\s]+|feat\.?|ft\.?|vs\.?/i)
    .map((x) => normalizeText(x))
    .filter(Boolean);
}

/** "04:56" / "1:02:03" → 秒；无法解析返回 0 */
export function durationSeconds(t?: string): number {
  if (!t) return 0;
  const parts = t.split(":").map((x) => parseInt(x, 10));
  if (parts.some((x) => Number.isNaN(x))) return 0;
  return parts.reduce((acc, x) => acc * 60 + x, 0);
}

/**
 * 在候选里挑「同款」：
 *   - 名字：规范化后相等，或一方包含另一方（且较短者 ≥ 2 字，防止单字误配）
 *   - 歌手：至少有一个歌手片段互相包含
 *   - 版本标记：歌名里的 Live / Remix / 伴奏 / 翻唱 等标记两边必须一致
 *   - 时长：两边都有时，差距 > 25 秒视为不同版本（Live/加长版）→ 淘汰
 * 多个候选通过时，优先「名字完全相等」且「时长更接近」者。
 */
export function pickBestMatch<T extends SongLike>(target: SongLike, candidates: T[]): T | null {
  const tn = normalizeText(target.name);
  const ta = artistTokens(target.artist);
  const td = durationSeconds(target.durationText);
  if (!tn) return null;

  let best: { item: T; score: number } | null = null;
  for (const c of candidates || []) {
    const cn = normalizeText(c?.name);
    if (!cn) continue;
    // 版本标记（Live/Remix/伴奏/翻唱…）必须一致：听的是 remix 就不能换成原版，反之亦然
    if (versionTags(c?.name) !== versionTags(target.name)) continue;
    const exact = cn === tn;
    const shorter = Math.min(cn.length, tn.length);
    const loose = !exact && shorter >= 2 && (cn.includes(tn) || tn.includes(cn));
    if (!exact && !loose) continue;

    const ca = artistTokens(c?.artist);
    const artistOk =
      ta.length === 0 || ca.length === 0
        ? false
        : ta.some((x) => ca.some((y) => x === y || x.includes(y) || y.includes(x)));
    if (!artistOk) continue;

    const cd = durationSeconds(c?.durationText);
    let durScore = 0;
    if (td > 0 && cd > 0) {
      const diff = Math.abs(td - cd);
      if (diff > 25) continue;
      durScore = 25 - diff; // 越接近越高
    }
    const score = (exact ? 100 : 40) + durScore;
    if (!best || score > best.score) best = { item: c, score };
  }
  return best ? best.item : null;
}

/** 平台显示名 */
export function sourceLabel(src?: string): string {
  switch (src) {
    case "wy":
      return "网易云";
    case "kw":
      return "酷我";
    default:
      return src || "未知";
  }
}

/** 双源互切（目前仅 wy ⇄ kw） */
export function otherSource(src?: string): "wy" | "kw" {
  return src === "wy" ? "kw" : "wy";
}
