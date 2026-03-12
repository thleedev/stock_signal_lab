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
      <div>
        <div className="text-xs text-gray-400">총 수익률</div>
        <div className={`text-2xl font-bold ${isPositive ? "text-red-500" : "text-blue-500"}`}>
          {isPositive ? "+" : ""}{totalReturnPct.toFixed(1)}%
        </div>
      </div>
      <div className="text-center">
        <div className="text-xs text-gray-400">보유 종목</div>
        <div className="text-2xl font-bold">{holdingCount}</div>
      </div>
      <div className="text-right">
        <div className="text-xs text-gray-400">완료 거래</div>
        <div className="text-2xl font-bold">{completedTradeCount}</div>
      </div>
    </div>
  );
}
