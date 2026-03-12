"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, ColorType } from "lightweight-charts";

const PORTFOLIO_COLORS = ["#ef4444", "#8b5cf6", "#f59e0b", "#10b981", "#0ea5e9", "#ec4899"];
const BENCHMARK_COLOR = "#94a3b8";

interface SnapshotPoint {
  date: string;
  cumulative_return_pct: number;
}

interface Props {
  portfolioId?: number;
  days?: number;
}

export function PerformanceChart({ portfolioId, days = 30 }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [period, setPeriod] = useState(days);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!chartRef.current) return;

    const container = chartRef.current;

    const fetchAndRender = async () => {
      setLoading(true);
      const params = new URLSearchParams({ days: String(period) });
      if (portfolioId) params.set("portfolio_id", String(portfolioId));

      const res = await fetch(`/api/v1/user-portfolio/performance?${params}`);
      const data = await res.json();

      const chart = createChart(container, {
        width: container.clientWidth,
        height: 250,
        layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#94a3b8" },
        grid: { vertLines: { color: "rgba(30, 41, 59, 0.5)" }, horzLines: { color: "rgba(30, 41, 59, 0.5)" } },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false },
      });

      // 포트별 라인
      const portfolioIds = Object.keys(data.portfolios ?? {});
      portfolioIds.forEach((pid, i) => {
        const snapshots: SnapshotPoint[] = data.portfolios[pid];
        if (!snapshots || snapshots.length === 0) return;

        const lineSeries = chart.addLineSeries({
          color: PORTFOLIO_COLORS[i % PORTFOLIO_COLORS.length],
          lineWidth: 2,
        });

        lineSeries.setData(
          snapshots.map((s: SnapshotPoint) => ({
            time: s.date,
            value: Number(s.cumulative_return_pct) ?? 0,
          }))
        );
      });

      // 벤치마크 라인
      if (data.benchmark && data.benchmark.length > 0) {
        const benchLine = chart.addLineSeries({
          color: BENCHMARK_COLOR,
          lineWidth: 1,
          lineStyle: 2,
        });
        benchLine.setData(
          data.benchmark.map((b: { date: string; return_pct: number }) => ({
            time: b.date,
            value: b.return_pct,
          }))
        );
      }

      chart.timeScale().fitContent();
      setLoading(false);

      return () => chart.remove();
    };

    let cleanup: (() => void) | undefined;
    fetchAndRender().then((c) => { cleanup = c; });

    return () => { cleanup?.(); };
  }, [portfolioId, period]);

  return (
    <div id="performance" className="p-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold text-sm">포트 성과 비교</h3>
        <div className="flex gap-1">
          {[30, 60, 90].map((d) => (
            <button
              key={d}
              onClick={() => setPeriod(d)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                period === d
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {d}일
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-[250px] text-[var(--muted)] text-sm">
          로딩 중...
        </div>
      )}

      <div ref={chartRef} className={loading ? "hidden" : ""} />

      <div className="flex gap-4 mt-3 text-xs text-[var(--muted)]">
        <span>━━ 포트 수익률</span>
        <span style={{ color: BENCHMARK_COLOR }}>╌╌ 코스피</span>
      </div>
    </div>
  );
}
