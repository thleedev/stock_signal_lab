"use client";

import type { StockRankItem } from "@/app/api/v1/stock-ranking/route";

interface Props {
  data: StockRankItem;
}

function Cell({ value, unit = "주", colorize = true }: { value: number | null; unit?: string; colorize?: boolean }) {
  if (value == null) return <td className="px-2 py-1.5 text-center text-[var(--muted)]">—</td>;
  const color = colorize ? (value >= 0 ? "text-[var(--buy)]" : "text-[var(--sell)]") : "";
  return (
    <td className={`px-2 py-1.5 text-center tabular-nums text-sm ${color}`}>
      {value >= 0 ? "+" : ""}{value.toLocaleString()}{unit}
    </td>
  );
}

function formatBillion(value: number | null): string {
  if (value == null) return "—";
  const billions = value / 1e8;
  if (billions >= 10000) return `${(billions / 10000).toFixed(1)}조`;
  return `${billions.toFixed(0)}억`;
}

export function SupplyDemandSection({ data }: Props) {
  return (
    <div className="p-4 space-y-3">
      <h3 className="text-lg font-semibold">수급 동향</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[var(--muted)] border-b border-[var(--border)]">
              <th className="pb-1 text-left font-normal" />
              <th className="pb-1 text-center font-normal">당일</th>
              <th className="pb-1 text-center font-normal">5일 누적</th>
              <th className="pb-1 text-center font-normal">연속</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[var(--border)]/50">
              <td className="py-1.5 text-sm font-medium">외국인</td>
              <Cell value={data.foreign_net_qty} />
              <Cell value={data.foreign_net_5d} />
              <td className="px-2 py-1.5 text-center text-sm tabular-nums">
                {data.foreign_streak != null ? `${data.foreign_streak}일` : "—"}
              </td>
            </tr>
            <tr>
              <td className="py-1.5 text-sm font-medium">기관</td>
              <Cell value={data.institution_net_qty} />
              <Cell value={data.institution_net_5d} />
              <td className="px-2 py-1.5 text-center text-sm tabular-nums">
                {data.institution_streak != null ? `${data.institution_streak}일` : "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <div>
          <span className="text-[var(--muted)]">공매도 </span>
          <span className="font-medium tabular-nums">
            {data.short_sell_ratio != null ? `${data.short_sell_ratio.toFixed(2)}%` : "—"}
          </span>
        </div>
        {data.volume != null && (
          <div>
            <span className="text-[var(--muted)]">거래량 </span>
            <span className="font-medium tabular-nums">{data.volume.toLocaleString()}주</span>
          </div>
        )}
      </div>
    </div>
  );
}
