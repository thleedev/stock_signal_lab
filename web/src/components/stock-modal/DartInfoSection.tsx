"use client";

import type { StockRankItem } from "@/app/api/v1/stock-ranking/route";

interface Props {
  data: StockRankItem;
}

interface FlagItem {
  label: string;
  type: "danger" | "success" | "neutral";
}

export function DartInfoSection({ data }: Props) {
  const flags: FlagItem[] = [];
  if (data.is_managed) flags.push({ label: "관리종목", type: "danger" });
  if (data.has_recent_cbw) flags.push({ label: "CB/BW 최근 발행", type: "danger" });
  if (data.audit_opinion && data.audit_opinion !== "적정") {
    flags.push({ label: `감사의견: ${data.audit_opinion}`, type: "danger" });
  }
  if (data.has_treasury_buyback) flags.push({ label: "자사주 매입", type: "success" });

  const hasNumericData =
    data.major_shareholder_pct != null || data.major_shareholder_delta != null ||
    data.revenue_growth_yoy != null || data.operating_profit_growth_yoy != null;

  if (flags.length === 0 && !hasNumericData) return null;

  const flagColors: Record<string, string> = {
    danger: "bg-[var(--danger)]/20 text-[var(--danger)]",
    success: "bg-[var(--success)]/20 text-[var(--success)]",
    neutral: "bg-[var(--muted)]/20 text-[var(--muted)]",
  };

  return (
    <div className="p-4 space-y-3">
      <h3 className="text-lg font-semibold">DART 공시</h3>
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {flags.map((f) => (
            <span key={f.label} className={`px-2 py-0.5 text-xs rounded-full ${flagColors[f.type]}`}>
              {f.label}
            </span>
          ))}
        </div>
      )}
      {hasNumericData && (
        <div className="grid grid-cols-2 gap-2 text-sm">
          {data.major_shareholder_pct != null && (
            <div>
              <span className="text-[var(--muted)]">대주주 지분 </span>
              <span className="font-medium tabular-nums">{data.major_shareholder_pct.toFixed(1)}%</span>
              {data.major_shareholder_delta != null && data.major_shareholder_delta !== 0 && (
                <span className={`ml-1 text-xs ${data.major_shareholder_delta > 0 ? "text-[var(--buy)]" : "text-[var(--sell)]"}`}>
                  ({data.major_shareholder_delta > 0 ? "+" : ""}{data.major_shareholder_delta.toFixed(1)}%p)
                </span>
              )}
            </div>
          )}
          {data.revenue_growth_yoy != null && (
            <div>
              <span className="text-[var(--muted)]">매출 YoY </span>
              <span className={`font-medium tabular-nums ${data.revenue_growth_yoy >= 0 ? "text-[var(--buy)]" : "text-[var(--sell)]"}`}>
                {data.revenue_growth_yoy >= 0 ? "+" : ""}{data.revenue_growth_yoy.toFixed(1)}%
              </span>
            </div>
          )}
          {data.operating_profit_growth_yoy != null && (
            <div>
              <span className="text-[var(--muted)]">영업이익 YoY </span>
              <span className={`font-medium tabular-nums ${data.operating_profit_growth_yoy >= 0 ? "text-[var(--buy)]" : "text-[var(--sell)]"}`}>
                {data.operating_profit_growth_yoy >= 0 ? "+" : ""}{data.operating_profit_growth_yoy.toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
