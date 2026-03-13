"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getLastNDays, getLastNWeekdays, formatDateLabel } from "@/lib/date-utils";

interface DateSelectorProps {
  basePath: string;
  selectedDate: string;
  days?: number;
  weekdaysOnly?: boolean;
  includeAll?: boolean;
}

export function DateSelector({
  basePath,
  selectedDate,
  days = 7,
  weekdaysOnly = false,
  includeAll = false,
}: DateSelectorProps) {
  const searchParams = useSearchParams();
  const lastNDays = weekdaysOnly ? getLastNWeekdays(days) : getLastNDays(days);

  function buildHref(date: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (date === "all") {
      params.delete("date");
    } else {
      params.set("date", date);
    }
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const btnCls = (active: boolean) =>
    `px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
      active
        ? "bg-[var(--accent)] text-white border-[var(--accent)]"
        : "bg-[var(--card)] text-[var(--muted)] border-[var(--border)] hover:bg-[var(--card-hover)]"
    }`;

  return (
    <div className="flex gap-2 flex-wrap">
      {lastNDays.map((date) => (
        <Link key={date} href={buildHref(date)} className={btnCls(selectedDate === date)}>
          {formatDateLabel(date)}
        </Link>
      ))}
      {includeAll && (
        <Link href={buildHref("all")} className={btnCls(selectedDate === "all")}>
          전체
        </Link>
      )}
    </div>
  );
}
