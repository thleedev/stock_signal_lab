"use client";

import type { StockRankItem } from "@/app/api/v1/stock-ranking/route";

interface Props {
  data: StockRankItem;
}

export function DartInfoSection({ data }: Props) {
  // is_managed만 StockRankItem에 포함됨
  if (!data.is_managed) return null;

  return (
    <div className="p-4 space-y-3">
      <h3 className="text-lg font-semibold">DART 공시</h3>
      <div className="flex flex-wrap gap-1">
        {data.is_managed && (
          <span className="px-2 py-0.5 text-xs rounded-full bg-[var(--danger)]/20 text-[var(--danger)]">
            관리종목
          </span>
        )}
      </div>
    </div>
  );
}
