"use client";

interface MetricsData {
  per: number | null;
  pbr: number | null;
  roe: number | null;
  eps: number | null;
  bps: number | null;
  dividend_yield: number | null;
  market_cap: number | null;
  volume: number | null;
  high_52w: number | null;
  low_52w: number | null;
}

interface Props {
  data: MetricsData;
}

function formatMarketCap(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}조`;
  if (n >= 1e8) return `${(n / 1e8).toFixed(0)}억`;
  return `${n.toLocaleString()}원`;
}

function MetricCell({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="bg-[var(--background)] rounded-xl p-1.5 sm:p-2 text-center">
      <p className="text-[var(--muted)] text-[11px] sm:text-xs">{label}</p>
      <p className={`font-medium mt-0.5 text-xs sm:text-sm tabular-nums ${className}`}>{value}</p>
    </div>
  );
}

export function MetricsGrid({ data }: Props) {
  return (
    <div className="p-3 sm:p-4 space-y-2">
      <h3 className="text-base sm:text-lg font-semibold">투자지표</h3>
      <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
        <MetricCell label="PER" value={data.per != null ? `${data.per.toFixed(2)}배` : "—"} />
        <MetricCell label="PBR" value={data.pbr != null ? `${data.pbr.toFixed(2)}배` : "—"} />
        <MetricCell label="ROE" value={data.roe != null ? `${data.roe.toFixed(1)}%` : "—"} />
      </div>
      <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
        <MetricCell label="EPS" value={data.eps != null ? `${data.eps.toLocaleString()}원` : "—"} />
        <MetricCell label="BPS" value={data.bps != null ? `${data.bps.toLocaleString()}원` : "—"} />
        <MetricCell label="배당수익률" value={data.dividend_yield != null ? `${data.dividend_yield.toFixed(2)}%` : "—"} />
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
        <MetricCell label="시가총액" value={formatMarketCap(data.market_cap)} />
        <MetricCell label="거래량" value={data.volume != null ? `${data.volume.toLocaleString()}주` : "—"} />
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
        <MetricCell label="52주 최고가" value={data.high_52w != null ? `${data.high_52w.toLocaleString()}원` : "—"} className="text-[var(--buy)]" />
        <MetricCell label="52주 최저가" value={data.low_52w != null ? `${data.low_52w.toLocaleString()}원` : "—"} className="text-[var(--sell)]" />
      </div>
    </div>
  );
}
