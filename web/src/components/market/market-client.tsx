"use client";

import React, { useMemo, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  Activity, DollarSign, TrendingUp, TrendingDown, BarChart3,
  Gauge, Droplets, Globe, Landmark, Flame, ShieldAlert,
  ShieldCheck, ShieldX, OctagonAlert, RefreshCw, GitBranch, LineChart,
} from "lucide-react";
import {
  getRiskInterpretation, getRiskThresholdLabel,
  RISK_THRESHOLDS,
  type RiskLevel, type IndicatorStats,
} from "@/lib/market-thresholds";
import type { Contribution } from "@shared/market/verdict";
import { CATALOG } from "@shared/market/catalog";
import { getLastNDays } from "@/lib/date-utils";
import {
  getScoreInterpretation,
  type MarketScoreHistory,
} from "@/types/market";
import type { MarketEvent } from "@/types/market-event";
import { EventCalendar } from "./event-calendar";
import { EventRiskBreakdown } from "./event-risk-breakdown";
// 동적 임포트: ETF 센티먼트 섹션은 조건부 렌더링되므로 초기 번들에서 제외
const EtfSentimentSection = dynamic(
  () => import("./etf-sentiment-section").then((mod) => mod.EtfSentimentSection),
  { loading: () => <div className="card animate-pulse h-40" /> }
);
import { PageLayout, PageHeader } from "@/components/ui";
import type { ClassifiedEtf, SectorSentiment, SentimentLabel } from "@/lib/etf-sentiment";

interface IndicatorRow {
  indicator_type: string;
  value: number;
  prev_value: number | null;
  change_pct: number | null;
  date: string;
  source: string | null;
  collected_at: string | null;
}

/** market_verdict 행 — 배치(step14)가 저장한 판정. 화면은 재계산하지 않는다 */
export interface VerdictRow {
  date: string;
  kind: "open" | "intraday" | "close";
  status: "ok" | "insufficient";
  score: number | null;
  action: "enter" | "hold" | "reduce" | null;
  coverage: number;
  contributions: Contribution[] | null;
  missing: string[];
  as_of: string;
}

/** market_backtest_run 최신 행 + 국면별 결과 (설계 §6.5) */
export interface BacktestRun {
  id: number;
  warn_threshold: number;
  median_lead_days: number | null;
  false_alarm_rate: number | null;
  market_backtest_result: {
    regime: string;
    peak_date: string;
    breach_date: string | null;
    warned: boolean;
    first_warn_date: string | null;
    lead_days: number | null;
  }[];
}

interface Props {
  indicators: IndicatorRow[];
  statsByKey: Record<string, IndicatorStats>;
  scoreHistory: Pick<MarketScoreHistory, "date" | "total_score" | "event_risk_score" | "combined_score" | "risk_index">[];
  events: MarketEvent[];
  verdict: VerdictRow | null;
  /** 같은 날 아침 확정(open) 판정 — 최신 판정과 다를 때만 넘어온다 */
  verdictOpen: VerdictRow | null;
  backtest: BacktestRun | null;
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
  // 카탈로그 기반 전환으로 판정 대상에 들어온 수급 지표. 이 맵에 없으면
  // 아래 getIndicatorIcon() 이 기본 아이콘으로 대체하므로 룩업 자체는
  // 항상 안전하지만, 의미 있는 아이콘을 명시해 둔다.
  FOREIGN_NET: <Globe className="w-5 h-5" />,
  INSTITUTION_NET: <Landmark className="w-5 h-5" />,
};

/** 카탈로그에 지표가 추가돼도 매핑이 없어 깨지지 않도록 기본 아이콘을 둔다. */
function getIndicatorIcon(type: string): React.ReactNode {
  return INDICATOR_ICONS[type] ?? <Activity className="w-5 h-5" />;
}

// ─── 값 포맷 ────────────────────────────────────────────

/**
 * 카탈로그의 display.suffix·display.digits 로 원값을 포맷한다.
 * 지표별 하드코딩 분기(toFixed 자릿수, "$"·"원"·"bps" 접미사 등)를
 * 두면 카탈로그에 지표를 추가·변경할 때마다 이 파일도 같이 고쳐야
 * 하고, 실제로 FOREIGN_NET·INSTITUTION_NET 이 분기 밖으로 빠져
 * 억원 단위 표기 없이 숫자만 보이던 사고로 이어졌다. 카탈로그에 없는
 * 타입(예: 실시간 전용 임시 지표)은 소수점 2자리로 안전하게 폴백한다.
 *
 * display.suffix 는 접미사만 표현할 수 있어 WTI·GOLD·EWY(unit: 'usd')는
 * 카탈로그만으로는 통화 단서가 사라진다("2,000.00"만 보임). catalog.ts
 * 는 수정 대상이 아니므로, 이미 카탈로그가 갖고 있는 unit 필드(판정
 * 단위가 아니라 저장 단위)를 읽어 usd 인 지표에만 화면에서 "$" 접두사를
 * 보충한다 — 하드코딩 지표명 분기가 아니라 카탈로그 필드 기반 규칙이다.
 */
function formatValue(type: string, value: number): string {
  const spec = CATALOG[type];
  if (!spec) return value.toFixed(2);
  const formatted = value.toLocaleString("ko-KR", {
    minimumFractionDigits: spec.display.digits,
    maximumFractionDigits: spec.display.digits,
  });
  const prefix = spec.unit === "usd" ? "$" : "";
  return `${prefix}${formatted}${spec.display.suffix}`;
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

// ─── 판정 배너 (설계 §6.1) ───────────────────────────────
// 점수·행동·커버리지는 배치(step14)가 저장한 market_verdict 를 그대로
// 표시한다. 브라우저 재계산을 없애 첫 페인트와 최종 표시, 크론과 화면이
// 같은 숫자를 본다. insufficient 는 회색 「산출 불가」로 표시한다 —
// 결손을 초록으로 칠하지 않는 것이 이 설계의 핵심이다.

const ACTION_LABELS: Record<string, { label: string; sub: string }> = {
  enter: { label: "진입 가능", sub: "신규 매수 가능 구간" },
  hold: { label: "관망", sub: "비중 유지 · 신규 진입 보류" },
  reduce: { label: "비중 축소", sub: "방어적 대응 · 신규 진입 중단" },
};

const KIND_LABELS: Record<string, string> = {
  open: "개장 전 확정",
  intraday: "장중 보정",
  close: "마감 확정",
};

/** as_of(ISO) → KST HH:MM */
function kstTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul",
  });
}

function VerdictBanner({ verdict, verdictOpen }: { verdict: VerdictRow | null; verdictOpen: VerdictRow | null }) {
  // 판정 행 자체가 없으면(배치 미실행) 산출 불가와 같은 회색으로 다룬다.
  if (!verdict || verdict.status === "insufficient" || verdict.score == null) {
    const missing = verdict?.missing ?? [];
    return (
      <div className="card p-3 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 border-[var(--border)]">
        <OctagonAlert className="w-8 h-8 sm:w-10 sm:h-10 shrink-0 text-[var(--muted)]" />
        <div className="flex-1 min-w-0">
          <div className="text-xl sm:text-2xl font-bold text-[var(--muted)]">산출 불가</div>
          <p className="text-xs sm:text-sm text-[var(--muted)] mt-1">
            {verdict
              ? `지표 커버리지 ${Math.round(verdict.coverage * 100)}% · 결측 ${missing.length}종${missing.length > 0 ? ` (${missing.slice(0, 4).join(", ")}${missing.length > 4 ? " 외" : ""})` : ""}`
              : "판정 데이터가 없습니다 — 시황 배치 실행 이력을 확인하십시오"}
          </p>
        </div>
      </div>
    );
  }

  const interp = getRiskInterpretation(verdict.score);
  const action = ACTION_LABELS[verdict.action ?? "hold"];
  const level = verdict.score >= 75 ? 3 : verdict.score >= 50 ? 2 : verdict.score >= 25 ? 1 : 0;
  const Icon = level >= 3 ? ShieldX : level >= 2 ? OctagonAlert : level >= 1 ? ShieldAlert : ShieldCheck;

  return (
    <div
      className="card p-3 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4"
      style={{ borderColor: interp.color + "60", background: interp.color + "08" }}
    >
      <Icon className="w-8 h-8 sm:w-10 sm:h-10 shrink-0" style={{ color: interp.color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <span className="text-xl sm:text-2xl font-bold" style={{ color: interp.color }}>
            {action.label}
          </span>
          <span className="text-2xl sm:text-3xl font-black tabular-nums" style={{ color: interp.color }}>
            위험 {verdict.score.toFixed(1)}
          </span>
          <span className="text-xs sm:text-sm text-[var(--muted)]">/ 100</span>
        </div>
        <p className="text-xs sm:text-sm text-[var(--muted)] mt-1">{action.sub}</p>
        <p className="text-[11px] sm:text-xs text-[var(--muted)] mt-1 tabular-nums">
          {verdict.date} {KIND_LABELS[verdict.kind]} {kstTime(verdict.as_of)} 기준
          {verdictOpen?.score != null && ` · 아침 확정 ${verdictOpen.score.toFixed(1)}`}
          {" · "}커버리지 {Math.round(verdict.coverage * 100)}%
        </p>
        {verdict.missing.length > 0 && (
          <p className="text-[11px] sm:text-xs text-[var(--warning)] mt-1">
            결손 {verdict.missing.length}종: {verdict.missing.slice(0, 4).join(", ")}{verdict.missing.length > 4 ? " 외" : ""}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── 판단 근거 블록 (설계 §6.2) ─────────────────────────
// contributions 를 기여 점수 내림차순(저장 시 이미 정렬됨)으로 상위 3개를
// 펼치고 나머지를 접는다. 각 행이 현재값·판정값·기여 점수를 보여 판단이
// 어디서 왔는지 추적 가능하게 한다.

function ContributionBlock({ verdict }: { verdict: VerdictRow }) {
  const [expanded, setExpanded] = useState(false);
  const contributions = verdict.contributions ?? [];
  if (contributions.length === 0) return null;
  const shown = expanded ? contributions : contributions.slice(0, 3);
  const rest = contributions.length - 3;

  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">이 판단의 근거</h2>
      <div className="card divide-y divide-[var(--border)] overflow-hidden">
        {shown.map((c) => {
          const spec = CATALOG[c.key];
          const isDerived = spec?.derive != null;
          return (
            <div key={c.key} className="px-3 sm:px-4 py-2.5 flex items-center gap-2 sm:gap-3 flex-wrap">
              <RiskBadge level={c.level as RiskLevel} />
              <span className="text-xs sm:text-sm font-medium flex-1 min-w-[6rem]">
                {spec?.label ?? c.key}
              </span>
              <span className="text-xs sm:text-sm tabular-nums">
                {formatValue(c.key, c.value)}
                {isDerived && (
                  <span className="text-[var(--muted)] ml-1">({c.evalValue.toFixed(1)}%)</span>
                )}
              </span>
              <span className="text-[11px] sm:text-xs text-[var(--muted)] tabular-nums">
                임계 {c.threshold.toLocaleString("ko-KR")}
              </span>
              <span className="text-[11px] sm:text-xs font-semibold tabular-nums w-12 text-right">
                +{c.points.toFixed(1)}
              </span>
            </div>
          );
        })}
        {rest > 0 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="w-full px-4 py-2 text-xs text-[var(--muted)] hover:bg-[var(--card-hover)] transition-colors"
          >
            {expanded ? "접기 ▴" : `나머지 ${rest}개 펼치기 ▾`}
          </button>
        )}
      </div>
    </section>
  );
}

// ─── 백테스트 실적 (설계 §6.5) ──────────────────────────

function BacktestRecord({ backtest }: { backtest: BacktestRun | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!backtest) {
    return (
      <p className="text-xs text-[var(--muted)] mt-2">
        백테스트 실적 데이터가 없습니다 — scripts/backtest-market.ts --save 실행 이력이 필요합니다.
      </p>
    );
  }
  const results = backtest.market_backtest_result ?? [];
  const eligible = results.filter((r) => r.breach_date != null);
  const hits = eligible.filter((r) => r.warned);
  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
      >
        과거 하락 국면 적중 {hits.length}/{eligible.length} · 경고 선행 중앙값{" "}
        {backtest.median_lead_days ?? "-"}거래일 · 오경보율{" "}
        {backtest.false_alarm_rate != null ? `${(backtest.false_alarm_rate * 100).toFixed(1)}%` : "-"}
        {" "}(경고 임계 {backtest.warn_threshold}) {expanded ? "▴" : "상세 ▾"}
      </button>
      {expanded && (
        <div className="card divide-y divide-[var(--border)] overflow-hidden mt-2">
          {results.map((r) => (
            <div key={r.regime} className="px-3 sm:px-4 py-2 flex items-center gap-2 sm:gap-3 text-xs flex-wrap">
              <span className={`w-10 font-semibold ${r.breach_date == null ? "text-[var(--muted)]" : r.warned ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
                {r.breach_date == null ? "제외" : r.warned ? "적중" : "실기"}
              </span>
              <span className="flex-1 min-w-[5rem] font-medium">{r.regime}</span>
              <span className="text-[var(--muted)] tabular-nums">고점 {r.peak_date}</span>
              <span className="text-[var(--muted)] tabular-nums">-10% 이탈 {r.breach_date ?? "-"}</span>
              <span className="tabular-nums">{r.warned && r.lead_days != null ? `D-${r.lead_days} 경고` : "-"}</span>
            </div>
          ))}
        </div>
      )}
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
    <div className="card p-3 sm:p-4">
      <div className="text-xs text-[var(--muted)] mb-1">{title}</div>
      <div className="text-lg sm:text-xl font-bold tabular-nums" style={{ color }}>{value}</div>
      <div className="text-[11px] sm:text-xs text-[var(--muted)] mt-1">{sub}</div>
    </div>
  );
}

/**
 * 두 YYYY-MM-DD 날짜 문자열의 일수 차(b - a). 둘 다 날짜만 있는 값이라
 * UTC 자정으로 파싱해도 시간대 오차가 없다(타임스탬프가 아니라 달력
 * 날짜 비교라서 KST/UTC 어느 쪽으로 읽어도 같은 결과).
 */
function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(`${dateA}T00:00:00Z`).getTime();
  const b = new Date(`${dateB}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

// ─── 지표 카드 (React.memo로 불필요한 리렌더링 방지) ─────

const IndicatorCard = React.memo(function IndicatorCard({
  ind, level, sampleDays, todayKst,
}: {
  ind: IndicatorRow;
  level: RiskLevel | null;
  /** market_indicator_stats.sample_days — derive 지표 라벨의 실제 창 길이 계산용 */
  sampleDays?: number;
  /** KST 기준 오늘 날짜(YYYY-MM-DD) — 지표 기준일이 얼마나 지연됐는지 판단용 */
  todayKst: string;
}) {
  const t = RISK_THRESHOLDS[ind.indicator_type];
  const spec = CATALOG[ind.indicator_type];
  const changePct = ind.change_pct;
  const isUp = changePct !== null && changePct > 0;
  const isDown = changePct !== null && changePct < 0;
  const thresholdLabel = level !== null ? getRiskThresholdLabel(ind.indicator_type, level, sampleDays) : null;

  // 결손 감지: page.tsx 는 최근 30일 조회에서 지표별 최신 1건만 남기므로,
  // 배치가 며칠 멈춰도 그 마지막 값이 계속 반환돼 커버리지·배너만으로는
  // 알 수 없다. maxStaleDays(카탈로그)를 넘긴 기준일만이 유일한 단서다.
  const staleDays = daysBetween(ind.date, todayKst);
  const isStale = spec != null && staleDays > spec.maxStaleDays;

  return (
    <div className="px-3 sm:px-4 py-2.5 sm:py-3 flex items-center gap-2 sm:gap-3 flex-wrap hover:bg-[var(--card-hover)] transition-colors">
      {/* 레벨 배지 */}
      <div className="w-12 sm:w-14 shrink-0">
        {level !== null ? <RiskBadge level={level} /> : (
          <span className="text-xs text-[var(--muted)]">-</span>
        )}
      </div>

      {/* 아이콘 */}
      <div className="shrink-0 text-[var(--muted)]">
        {getIndicatorIcon(ind.indicator_type)}
      </div>

      {/* 지표명 + 기준일 */}
      <div className="flex-1 min-w-[5rem] sm:min-w-[6rem]">
        <span className="text-xs sm:text-sm font-medium">{t?.label ?? ind.indicator_type}</span>
        <span className="text-[11px] sm:text-xs text-[var(--muted)] ml-1 sm:ml-1.5">{ind.indicator_type}</span>
        <span
          className={`block text-[10px] tabular-nums ${isStale ? "text-[var(--warning)] font-medium" : "text-[var(--muted)]"}`}
          title={isStale ? `카탈로그 갱신 주기(${spec?.maxStaleDays}일)를 넘겼습니다` : undefined}
        >
          {ind.date}{isStale && ` · ${staleDays}일 지연`}
        </span>
      </div>

      {/* 현재값 */}
      <span className="text-xs sm:text-sm font-bold tabular-nums">
        {formatValue(ind.indicator_type, ind.value)}
      </span>

      {/* 변화율: FOREIGN_NET/INSTITUTION_NET(5일 누적)은 등락률이 정의되지 않아 null — "+0.00%"로 치환하지 않고 "-"로 구분한다 */}
      <span className={`text-[11px] sm:text-xs tabular-nums ${isUp ? "text-red-400" : isDown ? "text-blue-400" : "text-[var(--muted)]"}`}>
        {changePct === null ? "-" : `${changePct > 0 ? "+" : ""}${changePct.toFixed(2)}%`}
      </span>

      {/* 임계값 기준 */}
      {thresholdLabel && (
        <span className="text-[11px] sm:text-xs text-[var(--muted)] sm:ml-auto">기준: {thresholdLabel}</span>
      )}
    </div>
  );
});

// ─── 위험 지수 히스토리 차트 ─────────────────────────────

function RiskHistoryChart({ history }: {
  history: Pick<MarketScoreHistory, "date" | "total_score" | "risk_index">[];
}) {
  const reversed = [...history].reverse();
  return (
    <div className="card p-4 overflow-x-auto">
      <div className="flex items-end gap-1 h-40 min-w-[420px] sm:min-w-[600px]">
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
      <div className="flex gap-1 mt-2 min-w-[420px] sm:min-w-[600px]">
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

export function MarketClient({ indicators, statsByKey, scoreHistory, events, verdict, verdictOpen, backtest }: Props) {
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 실시간 오버레이(브라우저의 Yahoo 직접 조회)는 제거했다(설계 §4.2).
  // 장중 갱신은 15분 배치(market-intraday)가 수집 경로로 하고, 화면은
  // 서버 정본만 읽는다 — 새로고침 버튼은 서버 데이터를 다시 읽을 뿐이다.
  const refresh = useCallback(() => {
    setIsRefreshing(true);
    router.refresh();
    // router.refresh() 는 완료 신호가 없어 짧은 지연 후 아이콘을 되돌린다.
    setTimeout(() => setIsRefreshing(false), 1200);
  }, [router]);

  // ─── ETF 센티먼트 ─────────────────────────────────
  const [etfData, setEtfData] = useState<{
    rawEtfs: ClassifiedEtf[];
    sectors: Record<string, SectorSentiment>;
    overallSentiment: number;
    overallLabel: SentimentLabel;
  } | null>(null);

  // 외부 시스템(API) 구독은 effect 안에서 하고, setState 는 응답 콜백에서만
  // 부른다 — 동기 setState 호출로 React Compiler 린트에 걸리지 않게 한다.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/market-indicators/etf-sentiment")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.success) return;
        setEtfData({
          rawEtfs: json.rawEtfs ?? [],
          sectors: json.sectors ?? {},
          overallSentiment: json.overallSentiment ?? 0,
          overallLabel: json.overallLabel ?? "neutral",
        });
      })
      .catch((e) => console.error("[market] etf-sentiment fetch failed:", e));
    return () => { cancelled = true; };
  }, []);

  // 지표별 판정 레벨 — 배치가 저장한 verdict.contributions 에서 온다.
  // 브라우저 재계산(calculateRiskIndex)을 제거해 크론·대시보드·이 화면이
  // 같은 숫자를 본다(설계 §4.2). contributions 에 없는 지표는 결손이라
  // 배지 없이 표시된다.
  const levelByKey = useMemo(() => {
    const m: Record<string, RiskLevel> = {};
    for (const c of verdict?.contributions ?? []) m[c.key] = c.level as RiskLevel;
    return m;
  }, [verdict]);
  const dangerCount = useMemo(
    () => (verdict?.contributions ?? []).filter((c) => c.level >= 2).length,
    [verdict],
  );
  const validCount = verdict?.contributions?.length ?? 0;

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

  // 2계층 지표 목록(설계 §6.3) — 글로벌은 아침에 확정된 값, 국내는 장중에
  // 움직이는 값이라 섞어 나열하면 어느 쪽이 반영 완료된 정보인지 구분되지
  // 않는다. 계층별로 나누고 각 계층 안에서 위험 레벨 내림차순 정렬한다.
  const byLayer = useMemo(() => {
    const sorted = [...indicators].sort((a, b) => {
      const la = levelByKey[a.indicator_type] ?? -1;
      const lb = levelByKey[b.indicator_type] ?? -1;
      return lb - la;
    });
    return {
      global: sorted.filter((i) => CATALOG[i.indicator_type]?.layer === "global"),
      domestic: sorted.filter((i) => CATALOG[i.indicator_type]?.layer !== "global"),
    };
  }, [indicators, levelByKey]);

  const recentHistory = scoreHistory.slice(0, 30);

  // KST 기준 오늘 — 지표 기준일(ind.date) 지연 판정용. 렌더마다 다시 구해도
  // Date 연산 하나뿐이라 비용이 무시할 만하다.
  const todayKst = getLastNDays(1)[0];

  return (
    <PageLayout>
      {/* 페이지 제목 */}
      <PageHeader
        title="투자 시황"
        subtitle="서버 판정 기반 위험 경보 — 배치가 계산하고 화면은 표시만 합니다"
        action={
          <button
            onClick={refresh}
            disabled={isRefreshing}
            className="p-2 rounded-lg hover:bg-[var(--card-hover)] transition-colors disabled:opacity-50"
            title="서버 데이터 새로고침"
          >
            <RefreshCw className={`w-5 h-5 ${isRefreshing ? "animate-spin" : ""}`} />
          </button>
        }
      />

      {/* 판정 배너 */}
      <VerdictBanner verdict={verdict} verdictOpen={verdictOpen} />

      {/* 판단 근거 */}
      {verdict?.status === "ok" && <ContributionBlock verdict={verdict} />}

      {/* 요약 카드 3개 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <SummaryCard
          title="위험 지표"
          value={`${dangerCount} / ${validCount}`}
          sub="위험(🟠) 이상 지표 수"
          // 판정 불가일 때 "0 / 0"이 초록으로 뜨면 위 회색 배너와 모순돼
          // 보인다 — 이 카드도 중립색으로 맞춘다.
          color={
            verdict?.status !== "ok" ? "var(--muted)"
            : dangerCount >= 4 ? "#ef4444" : dangerCount >= 2 ? "#f97316" : "#10b981"
          }
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

      {/* 지표별 위험 현황 — 2계층 (설계 §6.3) */}
      <section>
        <h2 className="text-lg font-semibold mb-3">간밤 글로벌</h2>
        <div className="card divide-y divide-[var(--border)] overflow-hidden">
          {byLayer.global.length === 0 && (
            <p className="p-8 text-sm text-[var(--muted)] text-center">글로벌 지표 데이터가 없습니다</p>
          )}
          {byLayer.global.map((ind) => (
            <IndicatorCard
              key={ind.indicator_type}
              ind={ind}
              level={levelByKey[ind.indicator_type] ?? null}
              sampleDays={statsByKey[ind.indicator_type]?.sample_days}
              todayKst={todayKst}
            />
          ))}
        </div>
      </section>
      <section>
        <h2 className="text-lg font-semibold mb-3">당일 국내</h2>
        <div className="card divide-y divide-[var(--border)] overflow-hidden">
          {byLayer.domestic.length === 0 && (
            <p className="p-8 text-sm text-[var(--muted)] text-center">국내 지표 데이터가 없습니다</p>
          )}
          {byLayer.domestic.map((ind) => (
            <IndicatorCard
              key={ind.indicator_type}
              ind={ind}
              level={levelByKey[ind.indicator_type] ?? null}
              sampleDays={statsByKey[ind.indicator_type]?.sample_days}
              todayKst={todayKst}
            />
          ))}
        </div>
      </section>

      {/* 이벤트 리스크 상세 */}
      <EventRiskBreakdown events={events} />

      {/* ETF 신호 기반 시장 센티먼트 — 결측이어도 섹션은 자리를 지킨다 (설계 §6.4) */}
      {etfData && Object.keys(etfData.sectors).length > 0 ? (
        <EtfSentimentSection
          rawEtfs={etfData.rawEtfs}
          sectors={etfData.sectors}
          overallSentiment={etfData.overallSentiment}
          overallLabel={etfData.overallLabel}
        />
      ) : (
        <section>
          <h2 className="text-lg font-semibold mb-3">ETF 시장 센티먼트</h2>
          <div className="card p-8 text-sm text-[var(--muted)] text-center">
            {etfData === null ? "센티먼트 데이터를 불러오지 못했습니다" : "분류된 ETF 신호가 없습니다"}
          </div>
        </section>
      )}

      {/* 최근 30일 위험 지수 추이 + 백테스트 실적 (설계 §6.5) */}
      <section>
        <h2 className="text-lg font-semibold mb-3">최근 30일 위험 지수 추이</h2>
        {recentHistory.length > 0 ? (
          <RiskHistoryChart history={recentHistory} />
        ) : (
          <div className="card p-8 text-sm text-[var(--muted)] text-center">추이 데이터가 없습니다</div>
        )}
        <BacktestRecord backtest={backtest} />
      </section>

      {/* 예정 이벤트 — 없어도 섹션은 자리를 지킨다 */}
      {events.length > 0 ? (
        <EventCalendar events={events} />
      ) : (
        <section>
          <h2 className="text-lg font-semibold mb-3">예정 이벤트 (30일)</h2>
          <div className="card p-8 text-sm text-[var(--muted)] text-center">예정된 이벤트가 없습니다</div>
        </section>
      )}
    </PageLayout>
  );
}
