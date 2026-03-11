"use client";

import { useState, useMemo } from "react";
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

const PERIOD_OPTIONS = [
  { days: 30, label: "30일" },
  { days: 60, label: "60일" },
  { days: 90, label: "90일" },
];

interface Props {
  prices: PriceData[];
  signalDates: string[];
  signalMarkers?: SignalMarker[];
  initialPeriod?: number;
}

export default function StockChartSection({ prices, signalDates, signalMarkers, initialPeriod = 30 }: Props) {
  const [period, setPeriod] = useState(initialPeriod);

  const filteredPrices = useMemo(() => {
    const cutoff = new Date(Date.now() - period * 86400000).toISOString().slice(0, 10);
    return prices.filter((p) => p.date >= cutoff);
  }, [prices, period]);

  const signalSet = new Set(signalDates);

  return (
    <div className="card">
      <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
        <h2 className="font-semibold">일별 시세</h2>
        <div className="flex gap-1">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              onClick={() => setPeriod(opt.days)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                period === opt.days
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4">
        <CandleChart data={filteredPrices} signalDates={signalSet} signalMarkers={signalMarkers} height={300} />
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
