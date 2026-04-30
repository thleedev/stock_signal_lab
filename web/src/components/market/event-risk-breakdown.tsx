"use client";

import { useState, useMemo } from "react";
import { ChevronDown, ChevronUp, AlertTriangle, Calendar } from "lucide-react";
import { calculateEventRiskBreakdown } from "@/lib/market-score";
import type { MarketEvent } from "@/types/market-event";
import { EVENT_CATEGORY_LABELS, getImpactLabel } from "@/types/market-event";

interface Props {
  events: MarketEvent[];
}

function dDayLabel(daysUntil: number): string {
  if (daysUntil === 0) return "오늘";
  if (daysUntil === 1) return "내일";
  return `D-${daysUntil}`;
}

export function EventRiskBreakdown({ events }: Props) {
  const [open, setOpen] = useState(false);
  const breakdown = useMemo(() => calculateEventRiskBreakdown(events), [events]);
  const { score, rawPenalty, cappedPenalty, capped, contributions } = breakdown;

  const summaryColor = score >= 80 ? "#10b981" : score >= 60 ? "#eab308" : score >= 40 ? "#f97316" : "#ef4444";

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="card w-full p-3 sm:p-4 flex items-center justify-between hover:bg-[var(--card-hover)] transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: summaryColor }} />
          <div className="min-w-0">
            <div className="text-sm font-semibold">이벤트 리스크 상세</div>
            <div className="text-[11px] sm:text-xs text-[var(--muted)] mt-0.5">
              100점 − {cappedPenalty.toFixed(1)} ={" "}
              <span className="font-semibold tabular-nums" style={{ color: summaryColor }}>
                {score.toFixed(0)}점
              </span>
              {" · "}
              7일 내 {contributions.length}건 기여
              {capped && <span className="ml-2 text-orange-400">캡(−80) 도달</span>}
            </div>
          </div>
        </div>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="card mt-2 divide-y divide-[var(--border)]">
          {contributions.length === 0 && (
            <div className="p-6 text-center text-sm text-[var(--muted)]">
              7일 이내 차감 대상 이벤트가 없습니다 (점수 100)
            </div>
          )}

          {contributions.map((c) => {
            const impact = getImpactLabel(c.event.impact_level);
            return (
              <div key={c.event.id} className="p-3 sm:p-4 flex items-center gap-3 flex-wrap">
                <div className="w-12 sm:w-14 shrink-0 flex flex-col items-center">
                  <span
                    className="text-[11px] sm:text-xs px-2 py-0.5 rounded-full font-semibold"
                    style={{ background: impact.color + "22", color: impact.color }}
                  >
                    {dDayLabel(c.daysUntil)}
                  </span>
                </div>

                <div className="flex-1 min-w-[10rem]">
                  <div className="text-sm font-medium flex items-center gap-2">
                    {c.event.impact_level >= 4 ? (
                      <AlertTriangle className="w-3.5 h-3.5" style={{ color: impact.color }} />
                    ) : (
                      <Calendar className="w-3.5 h-3.5 text-[var(--muted)]" />
                    )}
                    {c.event.title}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[11px] sm:text-xs text-[var(--muted)]">
                    <span>{c.event.event_date}</span>
                    <span className="px-1.5 py-0.5 rounded bg-[var(--card-hover)]">
                      {EVENT_CATEGORY_LABELS[c.event.event_category] ?? c.event.event_category}
                    </span>
                    {c.event.country !== "KR" && <span>{c.event.country}</span>}
                  </div>
                </div>

                {/* 계산 식 */}
                <div className="text-[11px] sm:text-xs text-[var(--muted)] tabular-nums whitespace-nowrap text-right">
                  <div>
                    |{c.event.risk_score}| × {c.decay.toFixed(1)}
                  </div>
                  <div className="font-semibold text-red-400">
                    −{c.contribution.toFixed(2)}
                  </div>
                </div>
              </div>
            );
          })}

          {contributions.length > 0 && (
            <div className="p-3 sm:p-4 bg-[var(--card-hover)]/40 text-xs sm:text-sm flex items-center justify-between">
              <span className="text-[var(--muted)]">
                합계 차감 (raw)
                {capped && <span className="ml-2 text-orange-400">→ 80 캡 적용</span>}
              </span>
              <span className="tabular-nums font-semibold text-red-400">
                −{rawPenalty.toFixed(2)}
                {capped && (
                  <span className="ml-1 text-[var(--muted)] font-normal">
                    (실제 −{cappedPenalty.toFixed(2)})
                  </span>
                )}
              </span>
            </div>
          )}

          <div className="p-3 sm:p-4 text-[11px] sm:text-xs text-[var(--muted)] leading-relaxed">
            계산식: 100 − Σ(|이벤트 risk_score| × 시간감쇠)
            <br />
            시간감쇠: 오늘 1.0 · D+1 0.8 · ≤D+3 0.5 · ≤D+7 0.2 · D+8 이상 0
            <br />총 차감은 80점이 한도입니다.
          </div>
        </div>
      )}
    </section>
  );
}
