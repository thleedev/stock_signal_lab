"use client";

import { RefreshCw } from "lucide-react";

interface PriceUpdateBadgeProps {
  priceUpdateLabel: string | null;
  isStale: boolean;
  refreshing: boolean;
  batchRunning?: boolean;
  onRefresh: () => void;
}

// timeZone 을 KST 로 고정합니다. 기기 시간대에 맡기면 서버 렌더 결과와 어긋나
// 하이드레이션 경고가 납니다. ko-KR + hour12:false 는 자정을 24:00 으로 내는
// 구현이 있어 en-GB 를 씁니다.
const TIME_KST = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const FULL_KST = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * 배지에 찍을 짧은 시각 문자열. 날짜는 넣지 않습니다.
 * 390px 에서 ISO 원문(2026-08-20T09:06:29.796+00:00)은 196px 를 차지해
 * 페이지 제목·부제를 밀어냅니다. 날짜는 title 속성으로 남깁니다.
 */
function formatUpdateTime(iso: string): { short: string; full: string } | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return { short: `${TIME_KST.format(d)} 기준`, full: `${FULL_KST.format(d)} KST` };
}

export function PriceUpdateBadge({
  priceUpdateLabel,
  isStale,
  refreshing,
  batchRunning = false,
  onRefresh,
}: PriceUpdateBadgeProps) {
  const busy = refreshing || batchRunning;
  const time = priceUpdateLabel ? formatUpdateTime(priceUpdateLabel) : null;

  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      {batchRunning && (
        <span className="text-xs text-blue-400 animate-pulse">데이터 갱신 중...</span>
      )}
      {!batchRunning && time && (
        <span
          title={time.full}
          className={`text-xs whitespace-nowrap ${
            isStale ? "text-yellow-400" : "text-[var(--muted)]"
          }`}
        >
          {time.short}
        </span>
      )}
      <button
        onClick={onRefresh}
        disabled={busy}
        className="flex items-center gap-1 h-11 sm:h-auto px-3 sm:px-2.5 sm:py-1 rounded-lg text-xs font-medium bg-[var(--card)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
      >
        <RefreshCw
          className={`w-3 h-3 ${busy ? "animate-spin" : ""}`}
        />
        {batchRunning ? "갱신중" : "갱신"}
      </button>
    </div>
  );
}
