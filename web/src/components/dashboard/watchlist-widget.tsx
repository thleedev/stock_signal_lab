"use client";

import React, { useMemo, useCallback } from "react";
import Link from "next/link";
import { usePriceRefresh } from "@/hooks/use-price-refresh";
import { useStockModal } from "@/contexts/stock-modal-context";

interface FavoriteStock {
  symbol: string;
  name: string;
  current_price: number | null;
  price_change_pct: number | null;
}

interface PriceData {
  current_price: number | null;
  price_change_pct: number | null;
}

interface Props {
  favorites: FavoriteStock[];
}

// 개별 관심종목 아이템 (React.memo로 불필요한 리렌더링 방지)
const WatchlistItem = React.memo(function WatchlistItem({
  stock,
  livePrice,
  onSelect,
}: {
  stock: FavoriteStock;
  livePrice: PriceData | undefined;
  onSelect: (symbol: string, name: string) => void;
}) {
  const price = livePrice?.current_price ?? stock.current_price;
  const pct = livePrice?.price_change_pct ?? stock.price_change_pct ?? 0;

  return (
    <button
      onClick={() => onSelect(stock.symbol, stock.name)}
      className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-[var(--card-hover)] transition-colors text-left"
    >
      <span className="text-sm font-medium truncate flex-1">{stock.name}</span>
      <div className="text-right shrink-0 ml-2">
        <div className="text-sm font-bold">{price?.toLocaleString() ?? "-"}</div>
        <div className={`text-xs font-medium ${pct > 0 ? "price-up" : pct < 0 ? "price-down" : "price-flat"}`}>
          {pct > 0 ? "+" : ""}{pct.toFixed(2)}%
        </div>
      </div>
    </button>
  );
});

export function WatchlistWidget({ favorites }: Props) {
  const { openStockModal } = useStockModal();
  const symbols = useMemo(() => favorites.map((f) => f.symbol), [favorites]);
  const { prices } = usePriceRefresh(symbols);

  if (favorites.length === 0) {
    return (
      <div className="card p-4 flex flex-col items-center justify-center text-center min-h-[120px]">
        <p className="text-sm text-[var(--muted)]">즐겨찾기된 종목이 없습니다</p>
        <Link href="/stocks" className="text-xs text-[var(--accent-light)] hover:underline mt-1">
          종목 추가 →
        </Link>
      </div>
    );
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-sm">관심종목</h2>
        <Link href="/stocks" className="text-xs text-[var(--accent-light)] hover:underline">
          전체 →
        </Link>
      </div>
      <div className="space-y-2">
        {favorites.map((f) => (
          <WatchlistItem
            key={f.symbol}
            stock={f}
            livePrice={prices[f.symbol]}
            onSelect={openStockModal}
          />
        ))}
      </div>
    </div>
  );
}
