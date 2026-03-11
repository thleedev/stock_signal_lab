"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  Activity,
  DollarSign,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Gauge,
  Droplets,
  Globe,
  Landmark,
  Flame,
  RotateCcw,
  Save,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import {
  getScoreInterpretation,
  type IndicatorWeight,
  type MarketScoreHistory,
} from "@/types/market";
import type { MarketEvent } from "@/types/market-event";
import { EventCalendar } from "./event-calendar";

// ─── 타입 ───────────────────────────────────────────────

interface IndicatorRow {
  indicator_type: string;
  value: number;
  prev_value: number | null;
  change_pct: number | null;
  date: string;
}

interface Props {
  indicators: IndicatorRow[];
  weights: IndicatorWeight[];
  scoreHistory: Pick<MarketScoreHistory, "date" | "total_score" | "breakdown" | "event_risk_score" | "combined_score">[];
  indicatorRanges: Record<string, { min: number; max: number }>;
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
  FEAR_GREED: <Gauge className="w-5 h-5" />,
};

// ─── 값 포맷 ────────────────────────────────────────────

function formatValue(type: string, value: number): string {
  if (["USD_KRW"].includes(type)) return value.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) + "원";
  if (["US_10Y", "KR_3Y"].includes(type)) return value.toFixed(3) + "%";
  if (["VIX", "FEAR_GREED", "DXY"].includes(type)) return value.toFixed(2);
  if (["WTI", "GOLD"].includes(type)) return "$" + value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (["KOSPI", "KOSDAQ"].includes(type)) return value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  return value.toFixed(2);
}

// ─── 게이지 SVG ─────────────────────────────────────────

function ScoreGauge({ score, color }: { score: number; color: string }) {
  const radius = 85;
  const circumference = 2 * Math.PI * radius;
  const fillPct = Math.max(0, Math.min(100, score)) / 100;
  const offset = circumference * (1 - fillPct);

  const [animated, setAnimated] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 50);
    return () => clearTimeout(t);
  }, []);

  return (
    <svg width={200} height={200} viewBox="0 0 200 200" className="drop-shadow-lg">
      {/* 배경 */}
      <circle
        cx={100}
        cy={100}
        r={radius}
        fill="none"
        stroke="#1e293b"
        strokeWidth={14}
      />
      {/* 전경 */}
      <circle
        cx={100}
        cy={100}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={14}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={animated ? offset : circumference}
        transform="rotate(-90 100 100)"
        style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(.4,0,.2,1), stroke 0.5s" }}
      />
      {/* 점수 */}
      <text
        x={100}
        y={95}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={color}
        fontSize={42}
        fontWeight="bold"
      >
        {score.toFixed(1)}
      </text>
      <text
        x={100}
        y={130}
        textAnchor="middle"
        fill="#94a3b8"
        fontSize={13}
      >
        / 100
      </text>
    </svg>
  );
}

// ─── 정규화 점수 바 ─────────────────────────────────────

function NormalizedBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="w-full h-2 rounded-full bg-[#1e293b] overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }}
      />
    </div>
  );
}

// ─── 메인 컴포넌트 ──────────────────────────────────────

export function MarketClient({ indicators, weights, scoreHistory, indicatorRanges, events }: Props) {
  // 가중치 상태 (슬라이더 조절용)
  const defaultWeights = useMemo(() => {
    const map: Record<string, number> = {};
    weights.forEach((w) => (map[w.indicator_type] = w.weight));
    return map;
  }, [weights]);

  const [currentWeights, setCurrentWeights] = useState<Record<string, number>>(defaultWeights);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [chartTab, setChartTab] = useState<"combined" | "market" | "event">("combined");

  // breakdown에서 정규화 점수 추출 (최신 히스토리 기준)
  // scoreHistory가 없으면 indicators에서 합성
  const latestBreakdown = useMemo(() => {
    if (scoreHistory.length > 0 && scoreHistory[0].breakdown) {
      return scoreHistory[0].breakdown;
    }
    if (indicators.length === 0) return null;

    const DIRECTION: Record<string, number> = {
      VIX: -1, USD_KRW: -1, US_10Y: -1, DXY: -1,
      KOSPI: 1, KOSDAQ: 1, GOLD: 1, WTI: 1,
    };

    const synthetic: Record<string, { normalized: number; weight: number }> = {};
    for (const ind of indicators) {
      if (ind.indicator_type === "FEAR_GREED") continue;
      const dir = DIRECTION[ind.indicator_type] ?? 1;
      const range = indicatorRanges[ind.indicator_type];

      let normalized: number;
      if (!range || range.max === range.min) {
        normalized = 50;
      } else {
        const raw = ((ind.value - range.min) / (range.max - range.min)) * 100;
        const clamped = Math.max(0, Math.min(100, raw));
        normalized = dir === -1 ? 100 - clamped : clamped;
      }

      synthetic[ind.indicator_type] = {
        normalized,
        weight: currentWeights[ind.indicator_type] ?? 1,
      };
    }
    return Object.keys(synthetic).length > 0 ? synthetic : null;
  }, [scoreHistory, indicators, currentWeights, indicatorRanges]);

  // 종합 점수 계산 (가중치 변경 시 재계산)
  const totalScore = useMemo(() => {
    if (!latestBreakdown) return 50;

    let weightedSum = 0;
    let totalWeight = 0;

    for (const [type, item] of Object.entries(latestBreakdown)) {
      const w = currentWeights[type] ?? 1;
      const entry = item as { normalized: number; weight: number };
      weightedSum += entry.normalized * w;
      totalWeight += w;
    }

    return totalWeight > 0
      ? Math.round((weightedSum / totalWeight) * 100) / 100
      : 50;
  }, [latestBreakdown, currentWeights]);

  const interpretation = getScoreInterpretation(totalScore);

  // 이벤트 리스크 & 통합 스코어
  const eventRiskScore = useMemo(() => {
    if (scoreHistory.length > 0 && scoreHistory[0].event_risk_score != null) {
      return scoreHistory[0].event_risk_score;
    }
    return 100;
  }, [scoreHistory]);

  const combinedScore = useMemo(() => {
    if (scoreHistory.length > 0 && scoreHistory[0].combined_score != null) {
      return scoreHistory[0].combined_score;
    }
    return totalScore * 0.7 + eventRiskScore * 0.3;
  }, [scoreHistory, totalScore, eventRiskScore]);

  const eventInterp = getScoreInterpretation(eventRiskScore);
  const combinedInterp = getScoreInterpretation(combinedScore);

  // 지표별 정규화 점수 가져오기
  const getNormalized = useCallback(
    (type: string): number => {
      if (!latestBreakdown || !latestBreakdown[type]) return 50;
      return latestBreakdown[type].normalized;
    },
    [latestBreakdown]
  );

  // 가중치 변경
  const handleWeightChange = (type: string, value: number) => {
    setCurrentWeights((prev) => ({ ...prev, [type]: value }));
  };

  // 초기화
  const handleReset = () => {
    setCurrentWeights(defaultWeights);
    setSaveMessage(null);
  };

  // 저장
  const handleSave = async () => {
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch("/api/v1/market-indicators/weights", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weights: currentWeights }),
      });
      if (!res.ok) throw new Error("저장 실패");
      setSaveMessage("저장 완료");
    } catch {
      setSaveMessage("저장에 실패했습니다");
    } finally {
      setSaving(false);
    }
  };

  // 가중치 매핑 (빠른 조회)
  const weightMap = useMemo(() => {
    const m: Record<string, IndicatorWeight> = {};
    weights.forEach((w) => (m[w.indicator_type] = w));
    return m;
  }, [weights]);

  // 히스토리 (최근 30일)
  const recentHistory = useMemo(() => scoreHistory.slice(0, 30), [scoreHistory]);

  return (
    <div className="space-y-8">
      {/* 페이지 제목 */}
      <div>
        <h1 className="text-2xl font-bold">투자 시황 점수</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          주요 지표 기반 종합 시장 분석
        </p>
      </div>

      {/* ─── 1. 3-스코어 게이지 ─────────────────────── */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-6 flex flex-col items-center gap-4">
          <div className="text-sm text-[var(--muted)]">통합 스코어</div>
          <ScoreGauge score={combinedScore} color={combinedInterp.color} />
          <span
            className="inline-block px-4 py-1.5 rounded-full text-sm font-semibold"
            style={{ background: combinedInterp.color + "22", color: combinedInterp.color }}
          >
            {combinedInterp.label}
          </span>
          <p className="text-sm text-[var(--muted)]">{combinedInterp.signal}</p>
        </div>

        <div className="card p-6 flex flex-col items-center gap-4">
          <div className="text-sm text-[var(--muted)]">마켓 심리</div>
          <ScoreGauge score={totalScore} color={interpretation.color} />
          <span
            className="inline-block px-4 py-1.5 rounded-full text-sm font-semibold"
            style={{ background: interpretation.color + "22", color: interpretation.color }}
          >
            {interpretation.label}
          </span>
        </div>

        <div className="card p-6 flex flex-col items-center gap-4">
          <div className="text-sm text-[var(--muted)]">이벤트 리스크</div>
          <ScoreGauge score={eventRiskScore} color={eventInterp.color} />
          <span
            className="inline-block px-4 py-1.5 rounded-full text-sm font-semibold"
            style={{ background: eventInterp.color + "22", color: eventInterp.color }}
          >
            {eventInterp.label}
          </span>
        </div>
      </section>

      {/* ─── 2. 지표별 카드 그리드 ───────────────────── */}
      <section>
        <h2 className="text-lg font-semibold mb-4">지표별 현황</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {indicators.map((ind) => {
            const w = weightMap[ind.indicator_type];
            const label = w?.label ?? ind.indicator_type;
            const desc = w?.description ?? "";
            const normalized = getNormalized(ind.indicator_type);
            const normInterp = getScoreInterpretation(normalized);
            const changePct = ind.change_pct ?? 0;
            const isUp = changePct > 0;
            const isDown = changePct < 0;

            return (
              <div key={ind.indicator_type} className="card p-4 space-y-3">
                {/* 헤더 */}
                <div className="flex items-center gap-2">
                  <span className="text-[var(--muted)]">
                    {INDICATOR_ICONS[ind.indicator_type] ?? <BarChart3 className="w-5 h-5" />}
                  </span>
                  <span className="text-sm font-medium truncate">{label}</span>
                </div>

                {/* 현재 값 */}
                <div className="text-xl font-bold">
                  {formatValue(ind.indicator_type, ind.value)}
                </div>

                {/* 변화율 */}
                <div className="flex items-center gap-1 text-sm">
                  {isUp && <ArrowUp className="w-3.5 h-3.5 text-[var(--danger)]" />}
                  {isDown && <ArrowDown className="w-3.5 h-3.5 text-[#3b82f6]" />}
                  <span className={isUp ? "price-up" : isDown ? "price-down" : "price-flat"}>
                    {changePct > 0 ? "+" : ""}
                    {changePct.toFixed(2)}%
                  </span>
                </div>

                {/* 정규화 점수 바 */}
                <div>
                  <div className="flex justify-between text-xs text-[var(--muted)] mb-1">
                    <span>점수</span>
                    <span>{normalized.toFixed(1)}</span>
                  </div>
                  <NormalizedBar value={normalized} color={normInterp.color} />
                </div>

                {/* 설명 */}
                {desc && (
                  <p className="text-xs text-[var(--muted)] leading-relaxed">{desc}</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── 3. 점수 히스토리 ────────────────────────── */}
      {recentHistory.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">최근 30일 점수 추이</h2>
            <div className="flex gap-1">
              {[
                { key: "combined" as const, label: "통합" },
                { key: "market" as const, label: "마켓" },
                { key: "event" as const, label: "이벤트" },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setChartTab(t.key)}
                  className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                    chartTab === t.key
                      ? "bg-[var(--accent)] text-white"
                      : "text-[var(--muted)] hover:bg-[var(--card-hover)]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="card p-4 overflow-x-auto">
            <div className="flex items-end gap-1 h-40 min-w-[600px]">
              {[...recentHistory].reverse().map((entry) => {
                const scoreValue =
                  chartTab === "combined" ? (entry.combined_score ?? entry.total_score)
                  : chartTab === "event" ? (entry.event_risk_score ?? 100)
                  : entry.total_score;
                const interp = getScoreInterpretation(scoreValue);
                const height = Math.max(4, (scoreValue / 100) * 100);
                return (
                  <div
                    key={entry.date}
                    className="flex-1 flex flex-col items-center gap-1 group relative"
                  >
                    <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                      <div className="bg-[#1e293b] border border-[var(--border)] rounded-lg px-3 py-2 text-xs whitespace-nowrap shadow-lg">
                        <div className="font-medium">{entry.date}</div>
                        <div style={{ color: interp.color }}>
                          {scoreValue.toFixed(1)}점 - {interp.label}
                        </div>
                      </div>
                    </div>
                    <div
                      className="w-full rounded-t transition-all duration-300 hover:opacity-80 cursor-pointer"
                      style={{
                        height: `${height}%`,
                        background: interp.color,
                        minHeight: "4px",
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex gap-1 mt-2 min-w-[600px]">
              {[...recentHistory].reverse().map((entry, i) => (
                <div key={entry.date} className="flex-1 text-center">
                  {i % 5 === 0 && (
                    <span className="text-[10px] text-[var(--muted)]">
                      {entry.date.slice(5)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ─── 3.5 이벤트 캘린더 ───────────────────────── */}
      {events.length > 0 && <EventCalendar events={events} />}

      {/* ─── 4. 가중치 조절 패널 ─────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold mb-4">가중치 조절</h2>
        <div className="card p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
            {weights.map((w) => (
              <div key={w.indicator_type} className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium">{w.label}</label>
                  <span className="text-sm font-mono text-[var(--accent-light)]">
                    {(currentWeights[w.indicator_type] ?? w.weight).toFixed(1)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={0.5}
                  value={currentWeights[w.indicator_type] ?? w.weight}
                  onChange={(e) =>
                    handleWeightChange(w.indicator_type, parseFloat(e.target.value))
                  }
                  className="w-full h-2 rounded-full appearance-none cursor-pointer
                    [&::-webkit-slider-thumb]:appearance-none
                    [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                    [&::-webkit-slider-thumb]:rounded-full
                    [&::-webkit-slider-thumb]:bg-[var(--accent)]
                    [&::-webkit-slider-thumb]:shadow-md
                    [&::-webkit-slider-thumb]:cursor-pointer
                    bg-[#1e293b]"
                />
              </div>
            ))}
          </div>

          {/* 버튼 */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium
                bg-[var(--accent)] hover:bg-[var(--accent-light)] text-white
                disabled:opacity-50 transition-colors"
            >
              <Save className="w-4 h-4" />
              {saving ? "저장 중..." : "저장"}
            </button>
            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium
                border border-[var(--border)] text-[var(--muted)]
                hover:bg-[var(--card-hover)] transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              초기화
            </button>
            {saveMessage && (
              <span
                className={`text-sm ${
                  saveMessage === "저장 완료" ? "text-[var(--success)]" : "text-[var(--danger)]"
                }`}
              >
                {saveMessage}
              </span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
