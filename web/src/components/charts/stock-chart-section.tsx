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

export interface SignalMarker {
  date: string;
  type: "BUY" | "BUY_FORECAST" | "SELL" | "SELL_COMPLETE";
  source: string;
}

interface Props {
  prices: PriceData[];
  signalDates: string[];
  signalMarkers?: SignalMarker[];
}

export default function StockChartSection({ prices, signalDates, signalMarkers }: Props) {
  const signalSet = new Set(signalDates);

  return (
    <div className="card">
      <div className="p-4 border-b border-[var(--border)]">
        <h2 className="font-semibold">일별 시세</h2>
      </div>
      <div className="p-4">
        <CandleChart data={prices} signalDates={signalSet} signalMarkers={signalMarkers} height={300} />
        <div className="flex gap-4 mt-3 text-xs text-[var(--muted)]">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-red-600" /> 상승
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-blue-600" /> 하락
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm bg-red-500" style={{ transform: "rotate(45deg)" }} /> 매수
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm bg-blue-500" style={{ transform: "rotate(45deg)" }} /> 매도
          </span>
        </div>
      </div>
    </div>
  );
}
