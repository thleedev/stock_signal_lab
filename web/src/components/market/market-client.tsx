"use client";

import React, { useMemo, useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  Activity, DollarSign, TrendingUp, TrendingDown, BarChart3,
  Gauge, Droplets, Globe, Landmark, Flame, ShieldAlert,
  ShieldCheck, ShieldX, OctagonAlert, RefreshCw, GitBranch, LineChart,
} from "lucide-react";
import {
  getRiskLevel, getRiskInterpretation, getRiskThresholdLabel,
  calculateRiskIndex, RISK_THRESHOLDS, COVERAGE_THRESHOLD,
  type RiskLevel, type IndicatorStats,
} from "@/lib/market-thresholds";
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

interface Props {
  indicators: IndicatorRow[];
  statsByKey: Record<string, IndicatorStats>;
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

// ─── 위험 경보 배너 ──────────────────────────────────────
// 커버리지 임계값(COVERAGE_THRESHOLD)과 그 근거는 market-thresholds.ts 에
// 있다 — 화면·크론(cron/market-score/route.ts) 이 각자 리터럴로 들고
// 있으면 둘이 따로 움직일 수 있어 한곳에서만 export 한다.

function RiskAlertBanner({
  riskIndex, dangerCount, validCount, coverage, missing,
}: {
  riskIndex: number;
  dangerCount: number;
  validCount: number;
  coverage: number;
  missing: string[];
}) {
  // 커버리지 미달이면 점수를 내지 않는다.
  // 이전 구현은 지표 0건일 때 riskIndex 0 을 calculateRiskIndex 가 그대로
  // 반환하고, getRiskInterpretation(0) 이 이를 "안전 · 적극 매수 가능"으로
  // 해석해 초록 배너로 표시했다. 파이프라인이 완전히 죽은 상태와 시장이
  // 가장 안전한 상태가 화면에서 구분되지 않는 문제였다.
  if (coverage < COVERAGE_THRESHOLD) {
    return (
      <div className="card p-3 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 border-[var(--border)]">
        <OctagonAlert className="w-8 h-8 sm:w-10 sm:h-10 shrink-0 text-[var(--muted)]" />
        <div className="flex-1 min-w-0">
          <div className="text-xl sm:text-2xl font-bold text-[var(--muted)]">산출 불가</div>
          <p className="text-xs sm:text-sm text-[var(--muted)] mt-1">
            지표 커버리지 {Math.round(coverage * 100)}% · 결측 {missing.length}종
            {missing.length > 0 && ` (${missing.slice(0, 4).join(", ")}${missing.length > 4 ? " 외" : ""})`}
          </p>
        </div>
      </div>
    );
  }

  const interp = getRiskInterpretation(riskIndex);
  const level = riskIndex >= 75 ? 3 : riskIndex >= 50 ? 2 : riskIndex >= 25 ? 1 : 0;
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
            {interp.label}
          </span>
          <span
            className="text-2xl sm:text-3xl font-black tabular-nums"
            style={{ color: interp.color }}
          >
            {riskIndex.toFixed(1)}
          </span>
          <span className="text-xs sm:text-sm text-[var(--muted)]">/ 100</span>
        </div>
        <p className="text-xs sm:text-sm text-[var(--muted)] mt-1">
          {validCount}개 지표 중 {dangerCount}개가 위험 구간 · {interp.action}
        </p>
        {/* 커버리지 게이트(위 분기)는 "점수를 낼지 말지"만 정한다. 게이트를
            통과해도(coverage ≥ 0.7) 파생 4종처럼 가벼운 지표군이 통째로
            빠질 수 있어(coverage 0.833 등) "무엇이 빠졌는지"는 항상 따로
            알려야 한다 — 안 그러면 회귀가 재발해도 이 배너가 침묵한다. */}
        {missing.length > 0 && (
          <p className="text-[11px] sm:text-xs text-[var(--warning)] mt-1">
            결손 {missing.length}종: {missing.slice(0, 4).join(", ")}{missing.length > 4 ? " 외" : ""}
          </p>
        )}
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

export function MarketClient({ indicators: initialIndicators, statsByKey, scoreHistory, events }: Props) {
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

        // 실시간에만 있는 새 지표를 추가하는 방어적 병합 로직. 과거에는
        // CNN_FEAR_GREED(소스 차단)·FEAR_GREED(VIX 역산 합성)가 이 경로로
        // 카탈로그에 없는 카드를 띄웠다 — 설계 §5.3 제거 대상이라 카탈로그·
        // realtime 라우트 양쪽에서 없앴다(최종 리뷰 I2). 지금은 해당하는
        // 예가 없지만, 카탈로그에 없는 실시간 지표가 다시 추가될 경우를
        // 대비해 병합 로직 자체는 남겨 둔다.
        const existingTypes = new Set(updated.map(i => i.indicator_type));
        for (const [type, rt] of Object.entries(realtimeMap)) {
          if (!existingTypes.has(type)) {
            updated.push({
              indicator_type: type,
              value: rt.value,
              prev_value: rt.prev_value,
              change_pct: rt.change_pct,
              date: new Date().toISOString().slice(0, 10),
              source: "realtime",
              collected_at: new Date().toISOString(),
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

  // ─── ETF 센티먼트 ─────────────────────────────────
  const [etfData, setEtfData] = useState<{
    rawEtfs: ClassifiedEtf[];
    sectors: Record<string, SectorSentiment>;
    overallSentiment: number;
    overallLabel: SentimentLabel;
  } | null>(null);

  const fetchEtfSentiment = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/market-indicators/etf-sentiment");
      if (!res.ok) return;
      const json = await res.json();
      if (!json.success) return;
      setEtfData({
        rawEtfs: json.rawEtfs ?? [],
        sectors: json.sectors ?? {},
        overallSentiment: json.overallSentiment ?? 0,
        overallLabel: json.overallLabel ?? 'neutral',
      });
    } catch (e) {
      console.error("[market] etf-sentiment fetch failed:", e);
    }
  }, []);

  // 페이지 진입 시 자동으로 실시간 데이터 로드
  useEffect(() => {
    fetchRealtime();
    fetchEtfSentiment();
  }, [fetchRealtime, fetchEtfSentiment]);

  // 현재 지표값 맵
  const valueMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const ind of indicators) m[ind.indicator_type] = ind.value;
    return m;
  }, [indicators]);

  // 위험 지수 계산 (절대 임계값 + 상대 분위수 하이브리드).
  // statsByKey(market_indicator_stats 배치 선계산치)를 넘겨야 KOSPI/KOSDAQ/
  // EWY/GOLD 같은 drawdown_52w·ma200_diff 파생 지표가 판정에 들어온다.
  // 생략하면 이 넷은 통계가 없어 missing 으로 빠져 배지 없이 표시된다.
  const { riskIndex, breakdown, validCount, dangerCount, coverage, missing } = useMemo(
    () => calculateRiskIndex(valueMap, statsByKey),
    [valueMap, statsByKey]
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

  // KST 기준 오늘 — 지표 기준일(ind.date) 지연 판정용. 렌더마다 다시 구해도
  // Date 연산 하나뿐이라 비용이 무시할 만하다.
  const todayKst = getLastNDays(1)[0];

  return (
    <PageLayout>
      {/* 페이지 제목 */}
      <PageHeader
        title="투자 시황"
        subtitle={`절대 임계값 기반 위험 경보${lastUpdated ? ` · 실시간 ${lastUpdated}` : ""}`}
        action={
          <button
            onClick={fetchRealtime}
            disabled={isRefreshing}
            className="p-2 rounded-lg hover:bg-[var(--card-hover)] transition-colors disabled:opacity-50"
            title="실시간 데이터 새로고침"
          >
            <RefreshCw className={`w-5 h-5 ${isRefreshing ? "animate-spin" : ""}`} />
          </button>
        }
      />

      {/* 경보 배너 */}
      <RiskAlertBanner
        riskIndex={riskIndex}
        dangerCount={dangerCount}
        validCount={validCount}
        coverage={coverage}
        missing={missing}
      />

      {/* 요약 카드 3개 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <SummaryCard
          title="위험 지표"
          value={`${dangerCount} / ${validCount}`}
          sub="위험(🟠) 이상 지표 수"
          // 커버리지 미달(산출 불가 배너)일 때 "0 / 0"이 초록으로 뜨면 바로
          // 위 회색 배너와 모순돼 보인다 — 이 카드도 중립색으로 맞춘다.
          color={
            coverage < COVERAGE_THRESHOLD ? "var(--muted)"
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

      {/* 지표별 위험 현황 */}
      <section>
        <h2 className="text-lg font-semibold mb-3">지표별 위험 현황</h2>
        <div className="card divide-y divide-[var(--border)] overflow-hidden">
          {sortedIndicators.map((ind) => {
            const level = breakdown[ind.indicator_type]?.level ?? getRiskLevel(ind.indicator_type, ind.value);
            return (
              <IndicatorCard
                key={ind.indicator_type}
                ind={ind}
                level={level}
                sampleDays={statsByKey[ind.indicator_type]?.sample_days}
                todayKst={todayKst}
              />
            );
          })}
        </div>
      </section>

      {/* 이벤트 리스크 상세 */}
      <EventRiskBreakdown events={events} />

      {/* ETF 신호 기반 시장 센티먼트 */}
      {etfData && Object.keys(etfData.sectors).length > 0 && (
        <EtfSentimentSection
          rawEtfs={etfData.rawEtfs}
          sectors={etfData.sectors}
          overallSentiment={etfData.overallSentiment}
          overallLabel={etfData.overallLabel}
        />
      )}

      {/* 최근 30일 위험 지수 추이 */}
      {recentHistory.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">최근 30일 위험 지수 추이</h2>
          <RiskHistoryChart history={recentHistory} />
        </section>
      )}

      {/* 예정 이벤트 */}
      {events.length > 0 && <EventCalendar events={events} />}
    </PageLayout>
  );
}
