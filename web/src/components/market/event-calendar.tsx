"use client";

import { useState, useMemo } from "react";
import { Calendar, AlertTriangle, Clock } from "lucide-react";
import type { MarketEvent } from "@/types/market-event";
import { EVENT_CATEGORY_LABELS, getImpactLabel } from "@/types/market-event";

interface Props {
  events: MarketEvent[];
}

type TabKey = "week" | "next_week" | "month";

function getWeekRange(offset: number): { from: Date; to: Date } {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + offset * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: monday, to: sunday };
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}/${d.getDate()} (${days[d.getDay()]})`;
}

function dDayLabel(dateStr: string): string {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const eventDate = new Date(dateStr + "T00:00:00");
  const todayDate = new Date(todayStr + "T00:00:00");
  const diff = Math.round((eventDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return "오늘";
  if (diff === 1) return "내일";
  if (diff > 0) return `D-${diff}`;
  return `D+${Math.abs(diff)}`;
}

export function EventCalendar({ events }: Props) {
  const [tab, setTab] = useState<TabKey>("week");

  const filteredEvents = useMemo(() => {
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    let from: string, to: string;

    if (tab === "week") {
      const range = getWeekRange(0);
      from = fmt(range.from);
      to = fmt(range.to);
    } else if (tab === "next_week") {
      const range = getWeekRange(1);
      from = fmt(range.from);
      to = fmt(range.to);
    } else {
      const now = new Date();
      from = fmt(new Date(now.getFullYear(), now.getMonth(), 1));
      to = fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    }

    return events.filter((e) => e.event_date >= from && e.event_date <= to);
  }, [events, tab]);

  const grouped = useMemo(() => {
    const map = new Map<string, MarketEvent[]>();
    for (const e of filteredEvents) {
      const list = map.get(e.event_date) || [];
      list.push(e);
      map.set(e.event_date, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredEvents]);

  const TABS: { key: TabKey; label: string }[] = [
    { key: "week", label: "이번 주" },
    { key: "next_week", label: "다음 주" },
    { key: "month", label: "이번 달" },
  ];

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Calendar className="w-5 h-5" />
          시장 이벤트 캘린더
        </h2>
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                tab === t.key
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--muted)] hover:bg-[var(--card-hover)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card divide-y divide-[var(--border)]">
        {grouped.length === 0 && (
          <div className="p-8 text-center text-[var(--muted)] text-sm">
            해당 기간에 예정된 이벤트가 없습니다
          </div>
        )}

        {grouped.map(([date, dayEvents]) => (
          <div key={date} className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-semibold">{formatDate(date)}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--accent)]/20 text-[var(--accent-light)]">
                {dDayLabel(date)}
              </span>
            </div>

            <div className="space-y-2 ml-4">
              {dayEvents.map((evt) => {
                const impact = getImpactLabel(evt.impact_level);
                return (
                  <div
                    key={evt.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-[var(--background)] hover:bg-[var(--card-hover)] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {evt.impact_level >= 4 ? (
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: impact.color }} />
                      ) : (
                        <Clock className="w-4 h-4 flex-shrink-0 text-[var(--muted)]" />
                      )}
                      <div>
                        <div className="text-sm font-medium">{evt.title}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--card-hover)] text-[var(--muted)]">
                            {EVENT_CATEGORY_LABELS[evt.event_category] ?? evt.event_category}
                          </span>
                          {evt.country !== "KR" && (
                            <span className="text-xs text-[var(--muted)]">{evt.country}</span>
                          )}
                          {evt.metadata && (evt.metadata as Record<string, string>).forecast_value && (
                            <span className="text-xs text-[var(--muted)]">
                              예상: {(evt.metadata as Record<string, string>).forecast_value}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right flex-shrink-0">
                      <span className="text-xs font-medium" style={{ color: impact.color }}>
                        {impact.label}
                      </span>
                      {evt.risk_score !== 0 && (
                        <div className="text-xs text-[var(--muted)]">
                          {evt.risk_score > 0 ? "+" : ""}{evt.risk_score}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
