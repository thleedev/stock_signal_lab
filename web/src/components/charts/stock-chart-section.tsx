"use client";

import dynamic from "next/dynamic";

const CandleChart = dynamic(() => import("./candle-chart"), { ssr: false });

interface PriceData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Props {
  prices: PriceData[];
  signalDates: string[];
}

export default function StockChartSection({ prices, signalDates }: Props) {
  const signalSet = new Set(signalDates);

  return (
    <div className="card">
      <div className="p-4 border-b border-[var(--border)]">
        <h2 className="font-semibold">일별 시세</h2>
      </div>
      <div className="p-4">
        <CandleChart data={prices} signalDates={signalSet} height={300} />
        <div className="flex gap-4 mt-3 text-xs text-[var(--muted)]">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-red-600" /> 상승
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-blue-600" /> 하락
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-500" />{" "}
            신호 발생일
          </span>
        </div>
      </div>
    </div>
  );
}
