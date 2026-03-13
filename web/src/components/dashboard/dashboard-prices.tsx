"use client";

import Link from "next/link";
import { usePriceRefresh } from "@/hooks/use-price-refresh";
import { useMemo } from "react";
import { useStockModal } from "@/contexts/stock-modal-context";

interface FavoriteStock {
  symbol: string;
  name: string;
  current_price: number | null;
  price_change_pct: number | null;
}

interface WatchlistItem {
  symbol: string;
  name: string;
  buy_price: number | null;
  memo: string | null;
}

interface Props {
  favorites: FavoriteStock[];
  watchlist: WatchlistItem[];
  watchlistStockData: Record<string, { current_price: number | null; price_change_pct: number | null }>;
  totalSignals: number;
}

export default function DashboardPrices({ favorites, watchlist, watchlistStockData, totalSignals }: Props) {
  const { openStockModal } = useStockModal();

  const allSymbols = useMemo(() => {
    const set = new Set<string>();
    for (const f of favorites) set.add(f.symbol);
    for (const w of watchlist) set.add(w.symbol);
    return Array.from(set);
  }, [favorites, watchlist]);

  const { prices } = usePriceRefresh(allSymbols);

  // 서버 초기값 + 클라이언트 갱신값 머지
  const getPrice = (symbol: string) => {
    if (prices[symbol]) return prices[symbol];
    return null;
  };

  // 포트 종목 수익률 계산
  let totalInvested = 0;
  let totalCurrent = 0;
  for (const w of watchlist) {
    const p = prices[w.symbol] ?? watchlistStockData[w.symbol];
    if (w.buy_price && p?.current_price) {
      totalInvested += w.buy_price;
      totalCurrent += p.current_price;
    }
  }
  const portfolioReturn = totalInvested > 0
    ? ((totalCurrent - totalInvested) / totalInvested) * 100
    : null;

  return (
    <>
      {/* 관심종목 */}
      {favorites.length > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-sm">관심종목</h2>
            <Link href="/stocks" className="text-xs text-[var(--accent-light)] hover:underline">전체 →</Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {favorites.map((f) => {
              const live = getPrice(f.symbol);
              const price = live?.current_price ?? f.current_price;
              const pct = live?.price_change_pct ?? f.price_change_pct;
              return (
                <button
                  key={f.symbol}
                  onClick={() => openStockModal(f.symbol, f.name)}
                  className="p-2 rounded-lg bg-[var(--background)] hover:bg-[var(--card-hover)] transition-colors text-left w-full"
                >
                  <div className="text-sm font-medium truncate">{f.name}</div>
                  <div className="text-lg font-bold mt-0.5">
                    {price?.toLocaleString() ?? "-"}
                  </div>
                  <div className={`text-xs font-medium ${
                    (pct ?? 0) > 0 ? "price-up" : (pct ?? 0) < 0 ? "price-down" : "price-flat"
                  }`}>
                    {(pct ?? 0) > 0 ? "+" : ""}{pct ?? 0}%
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 오늘 총 신호 + 포트 종목 요약 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link href="/signals" className="card p-4 hover:border-[var(--accent)] transition-colors">
          <div className="text-sm text-[var(--muted)]">오늘 총 신호</div>
          <div className="text-4xl font-bold mt-1">{totalSignals}건</div>
          <div className="text-xs text-[var(--muted)] mt-1">전체 보기 →</div>
        </Link>

        <Link href="/investment" className="card p-4 hover:border-[var(--accent)] transition-colors">
          <div className="text-sm text-[var(--muted)]">포트 종목</div>
          <div className="text-4xl font-bold mt-1">{watchlist.length}종목</div>
          {portfolioReturn !== null && (
            <div className={`text-sm font-medium mt-1 ${portfolioReturn >= 0 ? "price-up" : "price-down"}`}>
              평균 수익률 {portfolioReturn >= 0 ? "+" : ""}{portfolioReturn.toFixed(2)}%
            </div>
          )}
          {portfolioReturn === null && (
            <div className="text-xs text-[var(--muted)] mt-1">관리 →</div>
          )}
        </Link>
      </div>

      {/* 포트 종목 리스트 */}
      {watchlist.length > 0 && (
        <div className="card">
          <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
            <h2 className="font-semibold">포트 종목</h2>
            <Link href="/investment" className="text-xs text-[var(--accent-light)] hover:underline">관리 →</Link>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {watchlist.map((w) => {
              const live = getPrice(w.symbol);
              const serverData = watchlistStockData[w.symbol];
              const currentPrice = live?.current_price ?? serverData?.current_price;
              const changePct = live?.price_change_pct ?? serverData?.price_change_pct;
              const profitPct = w.buy_price && currentPrice
                ? ((currentPrice - w.buy_price) / w.buy_price) * 100
                : null;

              return (
                <button
                  key={w.symbol}
                  onClick={() => openStockModal(w.symbol, w.name)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--card-hover)] transition-colors text-left"
                >
                  <div>
                    <div className="text-sm font-medium">{w.name}</div>
                    <div className="text-xs text-[var(--muted)]">
                      {w.symbol}
                      {w.buy_price ? ` · 매수 ${w.buy_price.toLocaleString()}원` : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-bold ${
                      (changePct ?? 0) > 0 ? "text-red-400" : (changePct ?? 0) < 0 ? "text-blue-400" : ""
                    }`}>
                      {currentPrice?.toLocaleString() ?? "-"}원
                    </div>
                    {profitPct !== null && (
                      <div className={`text-xs font-medium ${profitPct >= 0 ? "text-red-400" : "text-blue-400"}`}>
                        {profitPct >= 0 ? "+" : ""}{profitPct.toFixed(2)}%
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
