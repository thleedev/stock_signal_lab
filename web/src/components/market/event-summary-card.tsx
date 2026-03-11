import Link from "next/link";
import { Calendar, AlertTriangle } from "lucide-react";
import type { MarketEvent } from "@/types/market-event";
import { getImpactLabel } from "@/types/market-event";
import { getScoreInterpretation } from "@/types/market";

interface Props {
  events: MarketEvent[];
  eventRiskScore: number;
  combinedScore: number;
  marketScore: number;
}

function dDayLabel(dateStr: string): string {
  const today = new Date();
  const todayStr = new Date(today.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const eventDate = new Date(dateStr + "T00:00:00");
  const todayDate = new Date(todayStr + "T00:00:00");
  const diff = Math.round((eventDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return "오늘";
  if (diff === 1) return "내일";
  return `D-${diff}`;
}

export function EventSummaryCard({ events, eventRiskScore, combinedScore, marketScore }: Props) {
  const topEvents = events.slice(0, 3);
  const combinedInterp = getScoreInterpretation(combinedScore);
  const marketInterp = getScoreInterpretation(marketScore);
  const eventInterp = getScoreInterpretation(eventRiskScore);

  return (
    <div className="space-y-4">
      {/* 3-스코어 요약 */}
      <div className="grid grid-cols-3 gap-3">
        <Link href="/market" className="card p-3 text-center hover:border-[var(--accent)] transition-colors">
          <div className="text-xs text-[var(--muted)]">통합</div>
          <div className="text-2xl font-bold mt-1" style={{ color: combinedInterp.color }}>
            {Math.round(combinedScore)}
          </div>
          <div className="text-xs mt-0.5" style={{ color: combinedInterp.color }}>
            {combinedInterp.label}
          </div>
        </Link>
        <Link href="/market" className="card p-3 text-center hover:border-[var(--accent)] transition-colors">
          <div className="text-xs text-[var(--muted)]">마켓</div>
          <div className="text-2xl font-bold mt-1" style={{ color: marketInterp.color }}>
            {Math.round(marketScore)}
          </div>
          <div className="text-xs mt-0.5" style={{ color: marketInterp.color }}>
            {marketInterp.label}
          </div>
        </Link>
        <Link href="/market" className="card p-3 text-center hover:border-[var(--accent)] transition-colors">
          <div className="text-xs text-[var(--muted)]">이벤트</div>
          <div className="text-2xl font-bold mt-1" style={{ color: eventInterp.color }}>
            {Math.round(eventRiskScore)}
          </div>
          <div className="text-xs mt-0.5" style={{ color: eventInterp.color }}>
            {eventInterp.label}
          </div>
        </Link>
      </div>

      {/* 이벤트 목록 */}
      {topEvents.length > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-sm flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              주요 이벤트
            </h2>
            <Link href="/market" className="text-xs text-[var(--accent-light)] hover:underline">
              전체 →
            </Link>
          </div>
          <div className="space-y-2">
            {topEvents.map((evt) => {
              const impact = getImpactLabel(evt.impact_level);
              return (
                <div key={evt.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {evt.impact_level >= 4 ? (
                      <AlertTriangle className="w-3.5 h-3.5" style={{ color: impact.color }} />
                    ) : (
                      <Calendar className="w-3.5 h-3.5 text-[var(--muted)]" />
                    )}
                    <span className="text-sm">{evt.title}</span>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{
                    background: impact.color + "22",
                    color: impact.color,
                  }}>
                    {dDayLabel(evt.event_date)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
