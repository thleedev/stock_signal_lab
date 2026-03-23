"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface PriceData {
  current_price: number | null;
  price_change: number | null;
  price_change_pct: number | null;
  volume: number | null;
  market_cap: number | null;
}

const CHUNK_SIZE = 200;

/**
 * 페이지 진입(마운트) 시 네이버에서 실시간 가격을 조회하는 훅
 * 서버 60초 캐시로 반복 호출 시 빠르게 응답
 * 200개씩 청크 분할하여 대량 심볼도 처리
 * @param symbols 조회할 종목 코드 배열
 */
export function usePriceRefresh(symbols: string[]) {
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const symbolsRef = useRef(symbols);
  symbolsRef.current = symbols;

  const fetchPrices = useCallback(async () => {
    const syms = symbolsRef.current;
    if (syms.length === 0) return;

    setLoading(true);
    try {
      // 200개씩 청크로 분할하여 병렬 요청
      const chunks: string[][] = [];
      for (let i = 0; i < syms.length; i += CHUNK_SIZE) {
        chunks.push(syms.slice(i, i + CHUNK_SIZE));
      }

      const results = await Promise.all(
        chunks.map((chunk) =>
          fetch(`/api/v1/prices?symbols=${chunk.join(",")}&live=true`)
            .then((r) => (r.ok ? r.json() : { data: null }))
            .then(({ data }) => data as Record<string, PriceData> | null)
            .catch(() => null)
        )
      );

      const merged: Record<string, PriceData> = {};
      for (const result of results) {
        if (result) Object.assign(merged, result);
      }

      if (Object.keys(merged).length > 0) {
        setPrices(merged);
        setLastUpdated(new Date());
      }
    } catch (e) {
      console.error("[usePriceRefresh]", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (symbols.length === 0) return;
    fetchPrices();
  }, [symbols.length, fetchPrices]);

  // 5분 자동 폴링 (장중에만)
  useEffect(() => {
    if (symbols.length === 0) return;

    const interval = setInterval(() => {
      // 비활성 탭에서는 불필요한 네트워크 요청 방지
      if (document.hidden) return;
      const now = new Date();
      const kstHour = (now.getUTCHours() + 9) % 24;
      const day = now.getDay(); // 0=Sun, 6=Sat
      // 평일 9시~16시 사이만 자동 갱신
      if (day >= 1 && day <= 5 && kstHour >= 9 && kstHour < 16) {
        fetchPrices();
      }
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [symbols.length, fetchPrices]);

  return { prices, lastUpdated, loading, refresh: fetchPrices };
}
