import { api } from '@/services/api';

interface CacheEntry {
  resolution: string | null;
  timestamp: number;
}

export interface StreamProbe {
  /** 清晰度，如 1080p；解析不到为 null */
  resolution: string | null;
  /** 首分片实测速度 KB/s（0 = 没测到） */
  speedKb: number;
  /** 播放列表首字节耗时 ms */
  ttfbMs: number;
}

const resolutionCache: { [url: string]: CacheEntry } = {};
const probeCache: { [url: string]: { probe: StreamProbe; timestamp: number } } = {};
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/** 把相对地址补成绝对地址（播放列表里的分片常是相对路径） */
const absolute = (base: string, rel: string): string => {
  if (/^https?:\/\//i.test(rel)) return rel;
  try {
    return new URL(rel, base).toString();
  } catch {
    return rel;
  }
};

/**
 * 探测一个源：播放列表首字节耗时 + 清晰度 + 首分片实测速度（range 128KB）。
 * 用「播放时会真正请求的地址」（含点播代理改写）来测，得到的速度更有参考价值。
 */
export const probeStream = async (url: string, signal?: AbortSignal): Promise<StreamProbe> => {
  const empty: StreamProbe = { resolution: null, speedKb: 0, ttfbMs: 0 };
  if (!url || !url.toLowerCase().includes(".m3u8")) return empty;
  const cached = probeCache[url];
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) return cached.probe;

  let probeUrl = url;
  try {
    probeUrl = api.getVodProxyUrl(url) || url;
  } catch {
    probeUrl = url;
  }

  const probe: StreamProbe = { ...empty };
  try {
    const t0 = Date.now();
    const res = await fetch(probeUrl, { signal });
    if (!res.ok) return (probeCache[url] = { probe, timestamp: Date.now() }).probe;
    probe.ttfbMs = Date.now() - t0;
    const playlist = await res.text();

    // 清晰度：master 里取最高
    let best: { h: number; uri: string } | null = null;
    const lines = playlist.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("#EXT-X-STREAM-INF")) {
        const m = line.match(/RESOLUTION=(\d+)x(\d+)/);
        const h = m ? parseInt(m[2], 10) : 0;
        let j = i + 1;
        while (j < lines.length && (lines[j].startsWith("#") || !lines[j].trim())) j++;
        if (j < lines.length && (!best || h > best.h)) best = { h, uri: lines[j].trim() };
      }
    }
    if (best) {
      probe.resolution = best.h ? `${best.h}p` : null;
      const variantUrl = absolute(probeUrl, best.uri);
      const vres = await fetch(variantUrl, { signal });
      if (vres.ok) {
        const media = await vres.text();
        const segs = media
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#"));
        if (segs.length) {
          const segUrl = absolute(variantUrl, segs[0]);
          probe.speedKb = await measureSpeed(segUrl, signal);
        }
      }
    } else {
      // 直接是媒体列表
      const segs = lines
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"));
      if (segs.length) {
        const segUrl = absolute(probeUrl, segs[0]);
        probe.speedKb = await measureSpeed(segUrl, signal);
      }
    }
  } catch {
    /* 探测失败按空值处理 */
  }
  probeCache[url] = { probe, timestamp: Date.now() };
  return probe;
};

/** range 取 128KB 估算下载速度（KB/s）；失败返回 0 */
const measureSpeed = async (segUrl: string, signal?: AbortSignal): Promise<number> => {
  try {
    const t0 = Date.now();
    const res = await fetch(segUrl, { headers: { Range: "bytes=0-131071" }, signal });
    if (!res.ok && res.status !== 206) return 0;
    const buf = await res.arrayBuffer();
    const sec = (Date.now() - t0) / 1000;
    if (buf.byteLength < 8192 || sec <= 0) return 0;
    return Math.round(buf.byteLength / 1024 / sec);
  } catch {
    return 0;
  }
};

export const getResolutionFromM3U8 = async (
  url: string,
  signal?: AbortSignal
): Promise<string | null> => {
  
  // 1. Check cache first
  const cachedEntry = resolutionCache[url];
  if (cachedEntry && Date.now() - cachedEntry.timestamp < CACHE_DURATION) {
    return cachedEntry.resolution;
  }

  if (!url.toLowerCase().endsWith(".m3u8")) {
    return null;
  }

  try {
    // 经点播代理探测（更快更稳；未配置代理时自动原样直连）
    let probeUrl = url;
    try {
      probeUrl = api.getVodProxyUrl(url) || url;
    } catch {
      probeUrl = url;
    }
    const response = await fetch(probeUrl, { signal });
    
    if (!response.ok) {
      return null;
    }
    
    const playlist = await response.text();
    const lines = playlist.split("\n");
    let highestResolution = 0;
    let resolutionString: string | null = null;

    for (const line of lines) {
      if (line.startsWith("#EXT-X-STREAM-INF")) {
        const resolutionMatch = line.match(/RESOLUTION=(\d+)x(\d+)/);
        if (resolutionMatch) {
          const height = parseInt(resolutionMatch[2], 10);
          if (height > highestResolution) {
            highestResolution = height;
            resolutionString = `${height}p`;
          }
        }
      }
    }

    // 2. Store result in cache
    resolutionCache[url] = {
      resolution: resolutionString,
      timestamp: Date.now(),
    };

    return resolutionString;
  } catch {
    return null;
  }
};
