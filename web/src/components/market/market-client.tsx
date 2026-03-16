"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import {
  Activity, DollarSign, TrendingUp, TrendingDown, BarChart3,
  Gauge, Droplets, Globe, Landmark, Flame, ShieldAlert,
  ShieldCheck, ShieldX, OctagonAlert, RefreshCw, GitBranch, LineChart,
} from "lucide-react";
import {
  getRiskLevel, getRiskInterpretation, getRiskThresholdLabel,
  calculateRiskIndex, RISK_THRESHOLDS,
  type RiskLevel,
} from "@/lib/market-thresholds";
import {
  getScoreInterpretation,
  type MarketScoreHistory,
} from "@/types/market";
import type { MarketEvent } from "@/types/market-event";
import { EventCalendar } from "./event-calendar";

interface IndicatorRow {
  indicator_type: string;
  value: number;
  prev_value: number | null;
  change_pct: number | null;
  date: string;
}

interface Props {
  indicators: IndicatorRow[];
  scoreHistory: Pick<MarketScoreHistory, "date" | "total_score" | "event_risk_score" | "combined_score" | "risk_index">[];
  events: MarketEvent[];
}

// ─── 아이콘 매핑 ────────────────────────────────────────

const INDICATOR_ICONS: Record<string, React.ReactNode> = {
  VIX: <Activity className="w-5 h-5" />,
  USD_KRW: <DollarSign className="w-5 h-5" />,
  US_10Y: <Landmark className="w-5 h-5" />,
  WTI: <Droplets className="w-5 h-5" />,
  KOSPI: <TrendingUp className="w-5 h-5" />,
  KOSDAQ: <BarChart3 className="w-5 h-5" />,
  GOLD: <Flame className="w-5 h-5" />,
  DXY: <Globe className="w-5 h-5" />,
  KR_3Y: <Landmark className="w-5 h-5" />,
  KORU: <TrendingUp className="w-5 h-5" />,
  EWY: <TrendingDown className="w-5 h-5" />,
  FEAR_GREED: <Gauge className="w-5 h-5" />,
  CNN_FEAR_GREED: <Gauge className="w-5 h-5" />,
  VKOSPI: <Activity className="w-5 h-5" />,
  HY_SPREAD: <LineChart className="w-5 h-5" />,
  YIELD_CURVE: <GitBranch className="w-5 h-5" />,
};

// ─── 값 포맷 ────────────────────────────────────────────

function formatValue(type: string, value: number): string {
  if (["USD_KRW"].includes(type)) return value.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) + "원";
  if (["US_10Y", "KR_3Y"].includes(type)) return value.toFixed(3) + "%";
  if (["VIX", "VKOSPI", "FEAR_GREED", "DXY"].includes(type)) return value.toFixed(2);
  if (["CNN_FEAR_GREED"].includes(type)) return value.toFixed(1) + " / 100";
  if (["WTI", "GOLD"].includes(type)) return "$" + value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (["KOSPI", "KOSDAQ"].includes(type)) return value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  if (["KORU", "EWY"].includes(type)) return "$" + value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (["HY_SPREAD"].includes(type)) return value.toFixed(0) + " bps";
  if (["YIELD_CURVE"].includes(type)) return (value >= 0 ? "+" : "") + value.toFixed(0) + " bps";
  return value.toFixed(2);
}

// ─── 위험 레벨 색상/라벨 ────────────────────────────────

const LEVEL_COLORS: Record<RiskLevel, { bg: string; text: string; border: string }> = {
  0: { bg: "bg-emerald-900/20", text: "text-emerald-400", border: "border-emerald-800/40" },
  1: { bg: "bg-yellow-900/20",  text: "text-yellow-400",  border: "border-yellow-800/40" },
  2: { bg: "bg-orange-900/20",  text: "text-orange-400",  border: "border-orange-800/40" },
  3: { bg: "bg-red-900/20",     text: "text-red-400",     border: "border-red-800/40" },
};
const LEVEL_LABELS: Record<RiskLevel, string> = { 0: "안전", 1: "주의", 2: "위험", 3: "극위험" };

function RiskBadge({ level }: { level: RiskLevel }) {
  const c = LEVEL_COLORS[level];
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${c.bg} ${c.text} ${c.border}`}>
      {LEVEL_LABELS[level]}
    </span>
  );
}

// ─── 위험 경보 배너 ──────────────────────────────────────

function RiskAlertBanner({
  riskIndex, dangerCount, validCount,
}: {
  riskIndex: number;
  dangerCount: number;
  validCount: number;
}) {
  const interp = getRiskInterpretation(riskIndex);
  const level = riskIndex >= 75 ? 3 : riskIndex >= 50 ? 2 : riskIndex >= 25 ? 1 : 0;
  const Icon = level >= 3 ? ShieldX : level >= 2 ? OctagonAlert : level >= 1 ? ShieldAlert : ShieldCheck;

  return (
    <div
      className="card p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4"
      style={{ borderColor: interp.color + "60", background: interp.color + "08" }}
    >
      <Icon className="w-10 h-10 shrink-0" style={{ color: interp.color }} />
      <div className="flex-1">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-2xl font-bold" style={{ color: interp.color }}>
            {interp.label}
          </span>
          <span
            className="text-3xl font-black tabular-nums"
            style={{ color: interp.color }}
          >
            {riskIndex.toFixed(1)}
          </span>
          <span className="text-sm text-[var(--muted)]">/ 100</span>
        </div>
        <p className="text-sm text-[var(--muted)] mt-1">
          {validCount}개 지표 중 {dangerCount}개가 위험 구간 · {interp.action}
        </p>
      </div>
    </div>
  );
}

// ─── 요약 카드 ───────────────────────────────────────────

function SummaryCard({
  title, value, sub, color,
}: {
  title: string;
  value: string | number;
  sub: string;
  color: string;
}) {
  return (
    <div className="card p-4">
      <div className="text-xs text-[var(--muted)] mb-1">{title}</div>
      <div className="text-xl font-bold tabular-nums" style={{ color }}>{value}</div>
      <div className="text-xs text-[var(--muted)] mt-1">{sub}</div>
    </div>
  );
}

// ─── 지표 카드 ───────────────────────────────────────────

function IndicatorCard({
  ind, level,
}: {
  ind: IndicatorRow;
  level: RiskLevel | null;
}) {
  const t = RISK_THRESHOLDS[ind.indicator_type];
  const changePct = ind.change_pct ?? 0;
  const isUp = changePct > 0;
  const isDown = changePct < 0;
  const thresholdLabel = level !== null ? getRiskThresholdLabel(ind.indicator_type, level) : null;

  return (
    <div className="px-4 py-3 flex items-center gap-3 flex-wrap hover:bg-[var(--card-hover)] transition-colors">
      {/* 레벨 배지 */}
      <div className="w-14 shrink-0">
        {level !== null ? <RiskBadge level={level} /> : (
          <span className="text-xs text-[var(--muted)]">-</span>
        )}
      </div>

      {/* 지표명 */}
      <div className="flex-1 min-w-[6rem]">
        <span className="text-sm font-medium">{t?.label ?? ind.indicator_type}</span>
        <span className="text-xs text-[var(--muted)] ml-1.5">{ind.indicator_type}</span>
      </div>

      {/* 현재값 */}
      <span className="text-sm font-bold tabular-nums">
        {formatValue(ind.indicator_type, ind.value)}
      </span>

      {/* 변화율 */}
      <span className={`text-xs tabular-nums ${isUp ? "text-red-400" : isDown ? "text-blue-400" : "text-[var(--muted)]"}`}>
        {changePct > 0 ? "+" : ""}{changePct.toFixed(2)}%
      </span>

      {/* 임계값 기준 */}
      {thresholdLabel && (
        <span className="text-xs text-[var(--muted)] ml-auto">기준: {thresholdLabel}</span>
      )}
    </div>
  );
}

// ─── 위험 지수 히스토리 차트 ─────────────────────────────

function RiskHistoryChart({ history }: {
  history: Pick<MarketScoreHistory, "date" | "total_score" | "risk_index">[];
}) {
  const reversed = [...history].reverse();
  return (
    <div className="card p-4 overflow-x-auto">
      <div className="flex items-end gap-1 h-40 min-w-[600px]">
        {reversed.map((entry) => {
          const val = entry.risk_index ?? null;
          if (val === null) return (
            <div key={entry.date} className="flex-1 flex flex-col items-center">
              <div className="w-full rounded-t bg-[var(--border)]" style={{ height: "4px" }} />
            </div>
          );
          const interp = getRiskInterpretation(val);
          const height = Math.max(4, val);
          return (
            <div key={entry.date} className="flex-1 flex flex-col items-center gap-1 group relative">
              <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                <div className="bg-[#1e293b] border border-[var(--border)] rounded-lg px-3 py-2 text-xs whitespace-nowrap shadow-lg">
                  <div className="font-medium">{entry.date}</div>
                  <div style={{ color: interp.color }}>
                    위험지수 {val.toFixed(1)} - {interp.label}
                  </div>
                </div>
              </div>
              <div
                className="w-full rounded-t transition-all duration-300 hover:opacity-80"
                style={{ height: `${height}%`, background: interp.color, minHeight: "4px" }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1 mt-2 min-w-[600px]">
        {reversed.map((entry, i) => (
          <div key={entry.date} className="flex-1 text-center">
            {i % 5 === 0 && (
              <span className="text-[10px] text-[var(--muted)]">{entry.date.slice(5)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 메인 컴포넌트 ──────────────────────────────────────

export function MarketClient({ indicators: initialIndicators, scoreHistory, events }: Props) {
  const [indicators, setIndicators] = useState(initialIndicators);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // 실시간 데이터 가져오기
  const fetchRealtime = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/v1/market-indicators/realtime");
      if (!res.ok) return;
      const json = await res.json();
      if (!json.success) return;

      const realtimeMap = json.indicators as Record<string, {
        value: number;
        prev_value: number | null;
        change_pct: number;
      }>;

      // 기존 지표를 실시간 값으로 업데이트
      setIndicators(prev => {
        const updated = prev.map(ind => {
          const rt = realtimeMap[ind.indicator_type];
          if (!rt) return ind;
          return {
            ...ind,
            value: rt.value,
            prev_value: rt.prev_value ?? ind.prev_value,
            change_pct: rt.change_pct ?? ind.change_pct,
          };
        });

        // 실시간에만 있는 새 지표 추가 (CNN_FEAR_GREED 등)
        const existingTypes = new Set(updated.map(i => i.indicator_type));
        for (const [type, rt] of Object.entries(realtimeMap)) {
          if (!existingTypes.has(type)) {
            updated.push({
              indicator_type: type,
              value: rt.value,
              prev_value: rt.prev_value,
              change_pct: rt.change_pct,
              date: new Date().toISOString().slice(0, 10),
            });
          }
        }

        return updated;
      });

      setLastUpdated(new Date().toLocaleTimeString("ko-KR"));
    } catch (e) {
      console.error("[market] realtime fetch failed:", e);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // 페이지 진입 시 자동으로 실시간 데이터 로드
  useEffect(() => {
    fetchRealtime();
  }, [fetchRealtime]);

  // 현재 지표값 맵
  const valueMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const ind of indicators) m[ind.indicator_type] = ind.value;
    return m;
  }, [indicators]);

  // 위험 지수 계산
  const { riskIndex, breakdown, validCount, dangerCount } = useMemo(
    () => calculateRiskIndex(valueMap),
    [valueMap]
  );

  // 이벤트 리스크
  const latestEventRisk = scoreHistory[0]?.event_risk_score ?? null;
  const eventInterp = latestEventRisk != null ? getScoreInterpretation(latestEventRisk) : null;

  // 7일 추이 (위험 레벨 변화)
  const trend7d = useMemo(() => {
    const recent = scoreHistory.slice(0, 7).map(h => h.risk_index).filter((v): v is number => v != null);
    if (recent.length < 2) return null;
    const diff = recent[0] - recent[recent.length - 1];
    return diff;
  }, [scoreHistory]);

  // 지표 정렬: 위험 레벨 내림차순
  const sortedIndicators = useMemo(() => {
    return [...indicators].sort((a, b) => {
      const la = breakdown[a.indicator_type]?.level ?? -1;
      const lb = breakdown[b.indicator_type]?.level ?? -1;
      return lb - la;
    });
  }, [indicators, breakdown]);

  const recentHistory = scoreHistory.slice(0, 30);

  return (
    <div className="space-y-6">
      {/* 페이지 제목 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">투자 시황</h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            절대 임계값 기반 위험 경보
            {lastUpdated && <span className="ml-2">· 실시간 {lastUpdated}</span>}
          </p>
        </div>
        <button
          onClick={fetchRealtime}
          disabled={isRefreshing}
          className="p-2 rounded-lg hover:bg-[var(--card-hover)] transition-colors disabled:opacity-50"
          title="실시간 데이터 새로고침"
        >
          <RefreshCw className={`w-5 h-5 ${isRefreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* 경보 배너 */}
      <RiskAlertBanner
        riskIndex={riskIndex}
        dangerCount={dangerCount}
        validCount={validCount}
      />

      {/* 요약 카드 3개 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          title="위험 지표"
          value={`${dangerCount} / ${validCount}`}
          sub="위험(🟠) 이상 지표 수"
          color={dangerCount >= 4 ? "#ef4444" : dangerCount >= 2 ? "#f97316" : "#10b981"}
        />
        <SummaryCard
          title="이벤트 리스크"
          value={latestEventRisk != null ? `${latestEventRisk.toFixed(0)}점` : "-"}
          sub={eventInterp?.label ?? "데이터 없음"}
          color={eventInterp?.color ?? "var(--muted)"}
        />
        <SummaryCard
          title="7일 추이"
          value={
            trend7d == null ? "-"
            : trend7d > 0 ? `▲ ${trend7d.toFixed(1)}`
            : trend7d < 0 ? `▼ ${Math.abs(trend7d).toFixed(1)}`
            : "→ 보합"
          }
          sub={
            trend7d == null ? "데이터 없음"
            : trend7d > 2 ? "위험도 상승 중"
            : trend7d < -2 ? "위험도 하락 중"
            : "안정적"
          }
          color={
            trend7d == null ? "var(--muted)"
            : trend7d > 5 ? "#ef4444"
            : trend7d > 2 ? "#f97316"
            : trend7d < -2 ? "#10b981"
            : "var(--muted)"
          }
        />
      </div>

      {/* 지표별 위험 현황 */}
      <section>
        <h2 className="text-lg font-semibold mb-3">지표별 위험 현황</h2>
        <div className="card divide-y divide-[var(--border)] overflow-hidden">
          {sortedIndicators.map((ind) => {
            const level = breakdown[ind.indicator_type]?.level ?? getRiskLevel(ind.indicator_type, ind.value);
            return (
              <IndicatorCard key={ind.indicator_type} ind={ind} level={level} />
            );
          })}
        </div>
      </section>

      {/* 최근 30일 위험 지수 추이 */}
      {recentHistory.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">최근 30일 위험 지수 추이</h2>
          <RiskHistoryChart history={recentHistory} />
        </section>
      )}

      {/* 예정 이벤트 */}
      {events.length > 0 && <EventCalendar events={events} />}
    </div>
  );
}
