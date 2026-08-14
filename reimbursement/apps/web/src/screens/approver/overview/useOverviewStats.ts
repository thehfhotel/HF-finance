import { useEffect, useState } from 'react';
import type { OverviewPropertyKey, OverviewStats, OverviewWindowKey } from '../../../lib/api';
import { api } from '../../../lib/api';

/**
 * The page's one request: `GET /api/bundles/stats?window=&property=`.
 *
 * Refetching keeps the previous payload on screen, so switching a period or a
 * branch repaints rather than blanking — and the ladder's three amounts ship on
 * every response, which is why the tiles themselves can update instantly while
 * the breakdowns below are still in flight.
 */

export interface OverviewStatsResult {
  stats: OverviewStats | null;
  loading: boolean;
  error: string | null;
}

export function useOverviewStats(
  windowKey: OverviewWindowKey,
  property: OverviewPropertyKey,
): OverviewStatsResult {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.bundles
      .stats({ window: windowKey, property })
      .then((response) => {
        if (cancelled) return;
        if (response.overview) {
          setStats(response.overview);
          setError(null);
        } else {
          setError('ยังไม่มีข้อมูลภาพรวมจากเซิร์ฟเวอร์');
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'โหลดข้อมูลภาพรวมไม่สำเร็จ');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [windowKey, property]);

  return { stats, loading, error };
}
