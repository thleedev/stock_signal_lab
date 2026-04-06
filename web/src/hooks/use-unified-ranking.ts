'use client';

import { useState, useCallback } from 'react';
import type { StockRankItem } from '@/app/api/v1/stock-ranking/route';
import type { StyleWeights } from '@/lib/unified-scoring/types';

export interface UnifiedRankingResponse {
  items: StockRankItem[];
  total: number;
  snapshot_time?: string | null;
  updating?: boolean;
}

const cache = new Map<string, { data: UnifiedRankingResponse; ts: number }>();
const inflight = new Map<string, Promise<UnifiedRankingResponse | null>>();
const CACHE_TTL = 15_000;

export function useUnifiedRanking() {
  const [data, setData] = useState<UnifiedRankingResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const doFetch = useCallback(async (style: string, date: string, market: string, weights?: StyleWeights, disabledConditionIds?: string[]) => {
    const weightsKey = weights ? `|${weights.signalTech},${weights.supply},${weights.valueGrowth},${weights.momentum},${weights.risk}` : '';
    const disabledKey = disabledConditionIds?.length ? `|dc:${disabledConditionIds.join(',')}` : '';
    const key = `${style}:${date}:${market}${weightsKey}${disabledKey}`;

    const cached = cache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setData(cached.data);
      return;
    }

    setLoading(true);
    try {
      let promise = inflight.get(key);
      if (!promise) {
        promise = (async () => {
          const params = new URLSearchParams({ style, date, limit: '500' });
          if (market !== 'all') params.set('market', market);
          if (weights) {
            params.set('w_st', String(weights.signalTech));
            params.set('w_su', String(weights.supply));
            params.set('w_vg', String(weights.valueGrowth));
            params.set('w_mo', String(weights.momentum));
            params.set('w_ri', String(weights.risk));
          }
          if (disabledConditionIds?.length) {
            params.set('disabled_conds', disabledConditionIds.join(','));
          }
          const res = await window.fetch(`/api/v1/stock-ranking?${params}`);
          if (!res.ok) return null;
          const result: UnifiedRankingResponse = await res.json();
          cache.set(key, { data: result, ts: Date.now() });
          return result;
        })();
        inflight.set(key, promise);
      }

      const result = await promise;
      if (result) setData(result);
    } finally {
      inflight.delete(key);
      setLoading(false);
    }
  }, []);

  /** 캐시 무효화 (스타일 변경 시) */
  const invalidate = useCallback(() => {
    cache.clear();
  }, []);

  return { data, loading, doFetch, invalidate };
}
