"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

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
  initialUpdateTime?: string | null;
  staleMinutes?: number;
  onPricesRefreshed?: (prices: LivePriceMap) => void;
}

/**
 * 전종목 가격 갱신 훅.
 * - 마운트 시 stale(기본 5분)이면 자동으로 POST /api/v1/prices 호출
 * - "N분 전 업데이트" 라벨과 stale 상태를 반환
 * - onPricesRefreshed 콜백으로 갱신된 가격 맵 전달
 */
export function useGlobalPriceRefresh({
  initialUpdateTime,
  staleMinutes = 5,
  onPricesRefreshed,
}: UseGlobalPriceRefreshOptions = {}) {
  const [updateTime, setUpdateTime] = useState<string | null>(
    initialUpdateTime ?? null
  );
  const [refreshing, setRefreshing] = useState(false);

  const isStale = useMemo(() => {
    if (!updateTime) return true;
    const diffMin = (Date.now() - new Date(updateTime).getTime()) / 60000;
    return diffMin >= staleMinutes;
  }, [updateTime, staleMinutes]);

  const priceUpdateLabel = useMemo(() => {
    if (!updateTime) return null;
    const d = new Date(updateTime);
    const now = new Date();
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (diffMin < 1) return "방금 업데이트";
    if (diffMin < 60) return `${diffMin}분 전 업데이트`;
    return `${d.toLocaleDateString("ko-KR")} ${d.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
    })} 업데이트`;
  }, [updateTime]);

  const refreshPrices = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch("/api/v1/prices", { method: "POST" });
      if (!res.ok) return;
      const json = await res.json();
      const allPrices: LivePriceMap = json.data ?? {};
      setUpdateTime(new Date().toISOString());
      onPricesRefreshed?.(allPrices);
    } finally {
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshing]);

  useEffect(() => {
    if (isStale) {
      refreshPrices();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    updateTime,
    refreshing,
    isStale,
    priceUpdateLabel,
    refreshPrices,
  };
}
