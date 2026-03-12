"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getLastNDays, formatDateLabel } from "@/lib/date-utils";

interface DateSelectorProps {
  basePath: string;
  selectedDate: string;
  days?: number;
}

export function DateSelector({ basePath, selectedDate, days = 7 }: DateSelectorProps) {
  const searchParams = useSearchParams();
  const lastNDays = getLastNDays(days);

  // 기존 쿼리 파라미터를 유지하면서 date만 변경
  function buildHref(date: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("date", date);
    return `${basePath}?${params.toString()}`;
  }

  return (
    <div className="flex gap-2 flex-wrap">
      {lastNDays.map((date) => (
        <Link
          key={date}
          href={buildHref(date)}
          className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
            selectedDate === date
              ? "bg-[var(--accent)] text-white border-[var(--accent)]"
              : "bg-[var(--card)] text-[var(--muted)] border-[var(--border)] hover:bg-[var(--card-hover)]"
          }`}
        >
          {formatDateLabel(date)}
        </Link>
      ))}
    </div>
  );
}
