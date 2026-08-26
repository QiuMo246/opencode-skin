import { useEffect, useState } from "react";
import { api } from "../api";

/**
 * 官方主题色板：服务端在 /curated 请求后后台提取，这里轮询缓存直到非空
 * （替代旧的 2.5s/9s 固定延时，避免与服务端提取进度脆弱耦合）。
 */
export function useOfficialColors(maxAttempts = 20, intervalMs = 1500): Record<string, string[]> {
  const [colors, setColors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const tick = async () => {
      attempts++;
      try {
        const r = await api.marketOfficialColors();
        if (Object.keys(r).length > 0) {
          if (!cancelled) setColors(r);
          return;
        }
      } catch {
        /* 服务端可能尚未生成缓存，继续等待 */
      }
      if (!cancelled && attempts < maxAttempts) timer = setTimeout(tick, intervalMs);
    };

    timer = setTimeout(tick, 1000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [maxAttempts, intervalMs]);

  return colors;
}
