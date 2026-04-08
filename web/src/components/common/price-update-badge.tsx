"use client";

import { RefreshCw } from "lucide-react";

interface PriceUpdateBadgeProps {
  priceUpdateLabel: string | null;
  isStale: boolean;
  refreshing: boolean;
  batchRunning?: boolean;
  onRefresh: () => void;
}

export function PriceUpdateBadge({
  priceUpdateLabel,
  isStale,
  refreshing,
  batchRunning = false,
  onRefresh,
}: PriceUpdateBadgeProps) {
  const busy = refreshing || batchRunning;
  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      {batchRunning && (
        <span className="text-xs text-blue-400 animate-pulse">데이터 갱신 중...</span>
      )}
      {!batchRunning && priceUpdateLabel && (
        <span
          className={`text-xs ${
            isStale ? "text-yellow-400" : "text-[var(--muted)]"
          }`}
        >
          {priceUpdateLabel}
        </span>
      )}
      <button
        onClick={onRefresh}
        disabled={busy}
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--card)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
      >
        <RefreshCw
          className={`w-3 h-3 ${busy ? "animate-spin" : ""}`}
        />
        {batchRunning ? "갱신중" : "갱신"}
      </button>
    </div>
  );
}
