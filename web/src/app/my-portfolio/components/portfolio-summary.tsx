"use client";

interface Props {
  totalReturnPct: number;
  holdingCount: number;
  completedTradeCount: number;
}

export function PortfolioSummary({ totalReturnPct, holdingCount, completedTradeCount }: Props) {
  const isPositive = totalReturnPct >= 0;
  return (
    <div className="grid grid-cols-3 gap-4 p-4">
      <div className="rounded-lg bg-[var(--card)] p-3">
        <div className="text-xs text-[var(--muted)] mb-1">총 수익률</div>
        <div className={`text-2xl font-bold tabular-nums ${isPositive ? "text-red-400" : "text-blue-400"}`}>
          {isPositive ? "+" : ""}{totalReturnPct.toFixed(1)}%
        </div>
      </div>
      <div className="rounded-lg bg-[var(--card)] p-3 text-center">
        <div className="text-xs text-[var(--muted)] mb-1">보유 종목</div>
        <div className="text-2xl font-bold">{holdingCount}</div>
      </div>
      <div className="rounded-lg bg-[var(--card)] p-3 text-right">
        <div className="text-xs text-[var(--muted)] mb-1">완료 거래</div>
        <div className="text-2xl font-bold">{completedTradeCount}</div>
      </div>
    </div>
  );
}
