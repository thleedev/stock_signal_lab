"use client";

import Link from "next/link";

export interface Holding {
  trade_id: number;
  portfolio_id?: number;
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
  holding: { label: "보유중", className: "bg-red-900/30 text-red-400 border border-red-800/50" },
  near_target: { label: "익절 근접", className: "bg-green-900/30 text-green-400 border border-green-800/50" },
  near_stop: { label: "손절 근접", className: "bg-amber-900/30 text-amber-400 border border-amber-800/50" },
};

export function HoldingsTable({ holdings, onSell }: Props) {
  if (holdings.length === 0) {
    return (
      <div className="card p-12 text-center">
        <div className="text-[var(--muted)] text-lg mb-2">보유 종목이 없습니다</div>
        <p className="text-sm text-[var(--border)]">매수 버튼으로 종목을 추가해보세요</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-[var(--muted)] text-xs">
            <th className="px-3 py-3 text-left">종목</th>
            <th className="px-3 py-3 text-right">매수가</th>
            <th className="px-3 py-3 text-right">현재가</th>
            <th className="px-3 py-3 text-right">수익률</th>
            <th className="px-3 py-3 text-right w-20">상태</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {holdings.map((h) => {
            const badge = STATUS_BADGES[h.status] ?? STATUS_BADGES.holding;
            const isNearStop = h.status === "near_stop";
            const hasSellSignal =
              h.latest_signal &&
              (h.latest_signal.type === "SELL" || h.latest_signal.type === "SELL_COMPLETE");

            return (
              <tr
                key={h.trade_id}
                className={`hover:bg-[var(--card-hover)] transition-colors group ${
                  isNearStop ? "bg-blue-900/10" : ""
                }`}
              >
                <td className="px-3 py-2.5">
                  <Link href={`/stock/${h.symbol}`} className="font-medium hover:text-[var(--accent)]">
                    {h.name} {hasSellSignal && "⚠️"}
                  </Link>
                  <div className="text-[10px] text-[var(--muted)]">
                    {h.symbol}
                    {hasSellSignal && " · AI 매도신호"}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {h.buy_price.toLocaleString()}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {h.current_price.toLocaleString()}
                </td>
                <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${h.return_pct >= 0 ? "text-red-400" : "text-blue-400"}`}>
                  {h.return_pct >= 0 ? "+" : ""}{h.return_pct.toFixed(1)}%
                </td>
                <td className="px-3 py-2.5 text-right">
                  <button
                    onClick={() => onSell(h)}
                    className={`text-[10px] px-2 py-0.5 rounded ${badge.className}`}
                  >
                    {badge.label}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="text-center py-3 text-xs text-[var(--muted)]">
        총 {holdings.length}개 종목
      </div>
    </div>
  );
}
