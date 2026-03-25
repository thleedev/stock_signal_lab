'use client';

import { useState, useCallback } from 'react';
import type { StockRankItem } from '@/app/api/v1/stock-ranking/route';

export interface RankingResponse {
  items: StockRankItem[];
  total: number;
  page: number;
  limit: number;
}

// ── 모듈 레벨 캐시 — 같은 페이지의 여러 컴포넌트가 공유 ──
const cache = new Map<string, { data: RankingResponse; ts: number }>();
const inflight = new Map<string, Promise<RankingResponse | null>>();
const CACHE_TTL = 60_000; // 60초

/**
 * stock-ranking API 응답을 모듈 레벨 캐시로 공유하는 훅.
 * 종목추천/단기추천 탭 전환 시 동일 데이터를 재사용하여 중복 fetch 제거.
 */
export function useStockRanking() {
  const [data, setData] = useState<RankingResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const doFetch = useCallback(async (date: string, market: string) => {
    const key = `${date}:${market}`;

    // 캐시 히트 → 즉시 반환
    const cached = cache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setData(cached.data);
      return;
    }

    setLoading(true);
    try {
      // 동일 요청 진행 중이면 재사용 (deduplicate)
      let promise = inflight.get(key);
      if (!promise) {
        promise = (async () => {
          const params = new URLSearchParams({ date });
          if (market !== 'all') params.set('market', market);
          const res = await window.fetch(`/api/v1/stock-ranking?${params}`);
          if (!res.ok) return null;
          const result: RankingResponse = await res.json();
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

  return { data, loading, doFetch };
}
