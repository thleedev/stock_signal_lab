"use client";

import { RefreshCw } from "lucide-react";

interface PriceUpdateBadgeProps {
  priceUpdateLabel: string | null;
  isStale: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}

export function PriceUpdateBadge({
  priceUpdateLabel,
  isStale,
  refreshing,
  onRefresh,
}: PriceUpdateBadgeProps) {
  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      {priceUpdateLabel && (
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
        disabled={refreshing}
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--card)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
      >
        <RefreshCw
          className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`}
        />
        갱신
      </button>
    </div>
  );
}
