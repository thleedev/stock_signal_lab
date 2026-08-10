// web/src/hooks/use-global-price-refresh.ts
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { getSupabase } from '@/lib/supabase';

export type LivePriceMap = Record<
  string,
  {
    current_price: number;
    price_change: number;
    price_change_pct: number;
    volume: number;
    market_cap: number;
  }
>;

interface UseGlobalPriceRefreshOptions {
  staleMinutes?: number;
  /**
   * asOf 는 넘긴 가격이 "언제 기준" 값인지 나타내는 epoch(ms)입니다.
   * 이 훅은 stock_cache 를 읽으므로 행들의 updated_at 중 가장 최신 값을 씁니다.
   * 호출부가 네이버 실시간 시세 같은 다른 경로와 같은 심볼을 다룰 때
   * 더 오래된 값이 최신 값을 덮지 않도록 비교 기준으로 쓰라고 함께 넘깁니다.
   */
  onPricesRefreshed?: (prices: LivePriceMap, asOf: number) => void;
}

export function useGlobalPriceRefresh({
  staleMinutes = 15,
  onPricesRefreshed,
}: UseGlobalPriceRefreshOptions = {}) {
  const [updateTime, setUpdateTime] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const isStale = useMemo(() => {
    if (!updateTime) return true;
    return (Date.now() - new Date(updateTime).getTime()) / 60000 > staleMinutes;
  }, [updateTime, staleMinutes]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const supabase = getSupabase();
      const { data } = await supabase
        .from('stock_cache')
        .select('symbol, current_price, price_change, price_change_pct, volume, market_cap, updated_at')
        .not('current_price', 'is', null);

      if (!data || data.length === 0) return;

      const priceMap: LivePriceMap = {};
      for (const row of data) {
        priceMap[row.symbol as string] = {
          current_price: (row.current_price as number) ?? 0,
          price_change: (row.price_change as number) ?? 0,
          price_change_pct: (row.price_change_pct as number) ?? 0,
          volume: (row.volume as number) ?? 0,
          market_cap: (row.market_cap as number) ?? 0,
        };
      }

      const latestUpdate = data
        .map(r => r.updated_at as string)
        .sort()
        .pop() ?? new Date().toISOString();

      setUpdateTime(latestUpdate);
      const asOf = Date.parse(latestUpdate);
      onPricesRefreshed?.(priceMap, Number.isNaN(asOf) ? Date.now() : asOf);
    } finally {
      setRefreshing(false);
    }
  }, [onPricesRefreshed]);

  useEffect(() => {
    if (isStale) refresh();
  }, [isStale, refresh]);

  return { updateTime, refreshing, isStale, refresh };
}
