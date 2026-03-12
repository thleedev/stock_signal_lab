"use client";

interface Holding {
  trade_id: number;
  symbol: string;
  name: string;
  buy_price: number;
  current_price: number;
  return_pct: number;
  target_price: number | null;
  stop_price: number | null;
  status: string;
  note: string | null;
  bought_at: string;
  latest_signal: { type: string; source: string; date: string } | null;
}

interface Props {
  holdings: Holding[];
  onSell: (holding: Holding) => void;
}

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  holding: { label: "보유중", className: "bg-red-50 text-red-500" },
  near_target: { label: "익절 근접", className: "bg-green-50 text-green-600" },
  near_stop: { label: "손절 근접", className: "bg-amber-50 text-amber-600" },
};

export function HoldingsTable({ holdings, onSell }: Props) {
  if (holdings.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400 text-sm">
        보유 종목이 없습니다
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* 헤더 */}
      <div className="grid grid-cols-[2fr_1fr_1fr_1fr_80px] px-3 py-2 bg-gray-50 text-xs text-gray-400 border-b border-gray-200">
        <div>종목</div>
        <div className="text-right">매수가</div>
        <div className="text-right">현재가</div>
        <div className="text-right">수익률</div>
        <div className="text-right">상태</div>
      </div>

      {/* 종목 행 */}
      {holdings.map((h) => {
        const badge = STATUS_BADGES[h.status] ?? STATUS_BADGES.holding;
        const isNearStop = h.status === "near_stop";
        const hasSellSignal =
          h.latest_signal &&
          (h.latest_signal.type === "SELL" || h.latest_signal.type === "SELL_COMPLETE");

        return (
          <div
            key={h.trade_id}
            className={`grid grid-cols-[2fr_1fr_1fr_1fr_80px] px-3 py-2.5 text-sm border-b border-gray-100 items-center ${
              isNearStop ? "bg-amber-50" : ""
            }`}
          >
            <div>
              <div className="font-semibold">
                {h.name} {hasSellSignal && "⚠️"}
              </div>
              <div className="text-[10px] text-gray-400">
                {h.symbol}
                {hasSellSignal && " · AI 매도신호"}
              </div>
            </div>
            <div className="text-right">{h.buy_price.toLocaleString()}</div>
            <div className="text-right">{h.current_price.toLocaleString()}</div>
            <div className={`text-right font-semibold ${h.return_pct >= 0 ? "text-red-500" : "text-blue-500"}`}>
              {h.return_pct >= 0 ? "+" : ""}{h.return_pct.toFixed(1)}%
            </div>
            <div className="text-right">
              <button
                onClick={() => onSell(h)}
                className={`text-[10px] px-2 py-0.5 rounded ${badge.className}`}
              >
                {badge.label}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
