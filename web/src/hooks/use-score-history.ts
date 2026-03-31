'use client';

import { useState, useCallback } from 'react';

export interface ScoreHistoryPoint {
  date: string;
  score: number;
}

const historyCache = new Map<string, { data: ScoreHistoryPoint[]; ts: number }>();
const CACHE_TTL = 60_000; // 1분

export function useScoreHistory() {
  const [history, setHistory] = useState<ScoreHistoryPoint[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchHistory = useCallback(async (symbol: string) => {
    const cached = historyCache.get(symbol);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setHistory(cached.data);
      return;
    }

    setLoading(true);
    try {
      const res = await window.fetch(`/api/v1/stock-ranking/sessions?symbol=${symbol}&limit=7`);
      if (!res.ok) { setHistory([]); return; }
      const data: { date: string; score: number }[] = await res.json();
      historyCache.set(symbol, { data, ts: Date.now() });
      setHistory(data);
    } catch {
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return { history, loading, fetchHistory };
}
