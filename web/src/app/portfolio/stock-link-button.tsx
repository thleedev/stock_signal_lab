"use client";

import { useStockModal } from "@/contexts/stock-modal-context";

interface Props {
  symbol: string;
  name: string;
  quantity: number;
  price: number;
}

export function StockLinkButton({ symbol, name, quantity, price }: Props) {
  const { openStockModal } = useStockModal();

  return (
    <button
      onClick={() => openStockModal(symbol, name)}
      className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--card-hover)] transition-colors text-left"
    >
      <div>
        <div className="text-sm font-medium">{name}</div>
        <div className="text-xs text-[var(--muted)]">
          {symbol} · {quantity}주
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-medium">
          {price.toLocaleString()}원
        </div>
        <div className="text-xs text-[var(--muted)]">
          매수가
        </div>
      </div>
    </button>
  );
}
