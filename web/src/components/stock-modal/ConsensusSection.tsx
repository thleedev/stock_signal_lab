"use client";

import type { StockRankItem } from "@/app/api/v1/stock-ranking/route";

interface Props {
  data: StockRankItem;
  currentPrice: number;
}

const OPINION_LABELS: Record<number, string> = {
  1: "적극매도", 2: "매도", 3: "중립", 4: "매수", 5: "적극매수",
};

function getOpinionLabel(value: number | null): string {
  if (value == null) return "—";
  const rounded = Math.round(value);
  return OPINION_LABELS[rounded] ?? `${value.toFixed(1)}`;
}

export function ConsensusSection({ data, currentPrice }: Props) {
  const { target_price, invest_opinion, forward_per } = data;
  const upsidePct = target_price != null && currentPrice > 0
    ? ((target_price - currentPrice) / currentPrice) * 100 : null;
  const hasData = target_price != null || invest_opinion != null || forward_per != null;
  if (!hasData) return null;

  return (
    <div className="p-3 sm:p-4 space-y-3">
      <h3 className="text-base sm:text-lg font-semibold">컨센서스</h3>
      <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
        {target_price != null && (
          <div className="bg-[var(--background)] rounded-xl p-1.5 sm:p-2 text-center">
            <p className="text-[var(--muted)] text-[11px] sm:text-xs">목표주가</p>
            <p className="font-medium mt-0.5 text-xs sm:text-sm tabular-nums">{target_price.toLocaleString()}원</p>
            {upsidePct != null && (
              <p className={`text-xs mt-0.5 ${upsidePct >= 0 ? "text-[var(--buy)]" : "text-[var(--sell)]"}`}>
                {upsidePct >= 0 ? "+" : ""}{upsidePct.toFixed(1)}%
              </p>
            )}
          </div>
        )}
        {invest_opinion != null && (
          <div className="bg-[var(--background)] rounded-xl p-1.5 sm:p-2 text-center">
            <p className="text-[var(--muted)] text-[11px] sm:text-xs">투자의견</p>
            <p className="font-medium mt-0.5 text-xs sm:text-sm">{getOpinionLabel(invest_opinion)}</p>
            <p className="text-[11px] sm:text-xs text-[var(--muted)] mt-0.5">{invest_opinion.toFixed(1)} / 5.0</p>
          </div>
        )}
        {forward_per != null && (
          <div className="bg-[var(--background)] rounded-xl p-1.5 sm:p-2 text-center">
            <p className="text-[var(--muted)] text-[11px] sm:text-xs">추정PER</p>
            <p className="font-medium mt-0.5 text-xs sm:text-sm tabular-nums">{forward_per.toFixed(1)}배</p>
          </div>
        )}
      </div>
    </div>
  );
}
