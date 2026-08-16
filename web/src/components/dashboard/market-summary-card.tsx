import Link from "next/link";
import { TrendingUp, Calendar } from "lucide-react";
import { getScoreInterpretation } from "@/types/market";

interface MarketEvent {
  id: number;
  title: string;
  event_date: string;
}

interface Props {
  marketScore: number;
  /** null 이면 이벤트 점수 산출 불가(page.tsx 참고) — 결손을 낙관값으로 대체하지 않는다 */
  eventRiskScore: number | null;
  nextEvent: MarketEvent | null;
}

function dDayLabel(dateStr: string): string {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStr = kstNow.toISOString().slice(0, 10);
  const diff = Math.round(
    (new Date(dateStr).getTime() - new Date(todayStr).getTime()) /
      (1000 * 60 * 60 * 24)
  );
  if (diff === 0) return "오늘";
  if (diff === 1) return "내일";
  return `D-${diff}`;
}

export function MarketSummaryCard({ marketScore, eventRiskScore, nextEvent }: Props) {
  const mInterp = getScoreInterpretation(marketScore);
  const eInterp = eventRiskScore != null ? getScoreInterpretation(eventRiskScore) : null;

  return (
    <Link
      href="/market"
      className="card p-4 hover:border-[var(--accent)] transition-colors cursor-pointer"
    >
      <div className="flex items-center gap-1.5 mb-3">
        <TrendingUp className="w-4 h-4 text-[var(--muted)]" />
        <span className="text-sm font-semibold">투자 시황</span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--muted)]">마켓</span>
          <span className="text-sm font-bold" style={{ color: mInterp.color }}>
            {Math.round(marketScore)} · {mInterp.label}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--muted)]">이벤트</span>
          {eventRiskScore != null && eInterp ? (
            <span className="text-sm font-bold" style={{ color: eInterp.color }}>
              {Math.round(eventRiskScore)} · {eInterp.label}
            </span>
          ) : (
            <span className="text-sm font-bold text-[var(--muted)]">산출 불가</span>
          )}
        </div>
      </div>

      {nextEvent && (
        <div className="mt-3 pt-3 border-t border-[var(--border)]">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-[var(--muted)]" />
            <span className="text-xs text-[var(--muted)] truncate flex-1">
              {nextEvent.title}
            </span>
            <span className="text-xs text-[var(--accent-light)] shrink-0">
              {dDayLabel(nextEvent.event_date)}
            </span>
          </div>
        </div>
      )}

      <div className="text-xs text-[var(--muted)] mt-3">상세 보기 →</div>
    </Link>
  );
}
