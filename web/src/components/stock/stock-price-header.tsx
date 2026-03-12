"use client";

import { usePriceRefresh } from "@/hooks/use-price-refresh";
import { useMemo } from "react";

interface Props {
  symbol: string;
  initialPrice: number | null;
  initialChange: number;
  initialChangePct: string;
  priceDate: string;
  onBuyClick?: () => void;
}

export default function StockPriceHeader({
  symbol,
  initialPrice,
  initialChange,
  initialChangePct,
  priceDate,
  onBuyClick,
}: Props) {
  const symbols = useMemo(() => [symbol], [symbol]);
  const { prices } = usePriceRefresh(symbols);

  const live = prices[symbol];
  const currentPrice = live?.current_price ?? initialPrice;
  const priceChange = live?.price_change ?? initialChange;
  const priceChangePct = live?.price_change_pct != null
    ? live.price_change_pct.toFixed(2)
    : initialChangePct;

  if (!currentPrice) return null;

  return (
    <div className="flex items-baseline gap-3 mt-1">
      <span className="text-xl font-bold">
        {Number(currentPrice).toLocaleString()}원
      </span>
      <span
        className={`text-sm font-medium ${
          priceChange >= 0 ? "price-up" : "price-down"
        }`}
      >
        {priceChange >= 0 ? "+" : ""}
        {priceChange.toLocaleString()}원 ({priceChange >= 0 ? "+" : ""}
        {priceChangePct}%)
      </span>
      {priceDate && (
        <span className="text-xs text-[var(--muted)]">
          {priceDate === "stock_cache" ? "최근 시세" : `${priceDate} 기준`}
        </span>
      )}
      {onBuyClick && (
        <button
          onClick={onBuyClick}
          className="ml-3 px-3 py-1 bg-red-500 text-white text-xs rounded-lg hover:bg-red-600"
        >
          매수
        </button>
      )}
    </div>
  );
}
