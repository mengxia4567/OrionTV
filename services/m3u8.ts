import { api } from '@/services/api';

interface CacheEntry {
  resolution: string | null;
  timestamp: number;
}

const resolutionCache: { [url: string]: CacheEntry } = {};
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

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
