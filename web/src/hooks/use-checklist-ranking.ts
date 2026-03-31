'use client';

import { useState, useCallback } from 'react';
import type { ChecklistItem } from '@/lib/checklist-recommendation/types';

export interface ChecklistResponse {
  items: ChecklistItem[];
  total_candidates: number;
}

const cache = new Map<string, { data: ChecklistResponse; ts: number }>();
const inflight = new Map<string, Promise<ChecklistResponse | null>>();
const CACHE_TTL = 15_000; // 15초

export function useChecklistRanking() {
  const [data, setData] = useState<ChecklistResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const doFetch = useCallback(async (ids: string[], date: string, market: string) => {
    const key = `${ids.join(',')}:${date}:${market}`;

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
          const res = await window.fetch(`/api/v1/stock-ranking?mode=checklist&conditions=${ids.join(',')}&date=${date}&market=${market}`);
          if (!res.ok) return null;
          const result: ChecklistResponse = await res.json();
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
