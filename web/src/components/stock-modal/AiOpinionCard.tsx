// web/src/components/stock-modal/AiOpinionCard.tsx
"use client";

import { useState } from "react";
import type { StockRankItem } from "@/app/api/v1/stock-ranking/route";
import { SIGNAL_TYPE_LABELS } from "@/lib/signal-constants";
import { WEIGHTS_BY_TIER, DEFAULT_SHORT_TERM_WEIGHTS } from "@/types/ai-recommendation";

/** 단기추천 점수 (ShortTermRecommendationSection에서 전달) */
export interface ShortTermDisplayScores {
  momentum: number;
  supply: number;
  catalyst: number;
  valuation: number;
  risk: number;
}

interface Props {
  data: StockRankItem;
  /** 'short_term'이면 단기추천 점수 바 표시 */
  scoreMode?: 'standard' | 'short_term';
  /** 단기추천 점수 (scoreMode='short_term'일 때 사용) */
  shortTermScores?: ShortTermDisplayScores;
}

/** 기술적 패턴 키 → 한국어 레이블 */
const PATTERN_LABELS: Record<string, string> = {
  golden_cross: "골든크로스",
  bollinger_bottom: "볼린저하단",
  phoenix_pattern: "피닉스패턴",
  macd_cross: "MACD크로스",
  volume_surge: "거래량급등",
  week52_low_near: "52주저가근접",
  double_top: "쌍봉",
  disparity_rebound: "이격도반등",
  volume_breakout: "거래량돌파",
  consecutive_drop_rebound: "연속하락반등",
};

/**
 * 점수 항목 바 컴포넌트
 * - score: 실제 점수 (max 기준 백분율로 렌더링)
 * - max: 점수 최대값 (기본 100)
 */
function ScoreBar({
  label,
  score,
  max = 100,
  children,
}: {
  label: string;
  score: number;
  max?: number;
  children: React.ReactNode;
}) {
  const pct = Math.min(Math.max((score / max) * 100, 0), 100);
  const color =
    pct >= 70
      ? "bg-[var(--buy)]"
      : pct >= 40
        ? "bg-[var(--warning)]"
        : "bg-[var(--muted)]";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums font-bold">
          {score.toFixed(0)}
          <span className="text-xs font-normal text-[var(--muted)]">점</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-[var(--background)] overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-xs text-[var(--muted)] space-y-0.5">{children}</div>
    </div>
  );
}

/**
 * AI 투자의견 카드
 *
 * StockRankItem 데이터를 받아 총점 게이지, 등급/추천, 캐릭터 태그,
 * 5개 항목(신호 신뢰도·기술적 모멘텀·밸류에이션·수급 동향·리스크)별 점수바와
 * 세부 근거 텍스트를 표시한다.
 */
/** score_total 기준 등급 산출 (리스트 뷰와 동일 기준) */
function deriveGrade(score: number): { grade: string; label: string } {
  if (score >= 90) return { grade: 'A+', label: '적극매수' };
  if (score >= 80) return { grade: 'A', label: '매수' };
  if (score >= 65) return { grade: 'B+', label: '관심' };
  if (score >= 50) return { grade: 'B', label: '보통' };
  if (score >= 35) return { grade: 'C', label: '관망' };
  return { grade: 'D', label: '주의' };
}

/** 가중치 기여도 막대 */
function WeightBar({ label, raw, maxRaw, weight, normalized }: {
  label: string; raw: number; maxRaw: number; weight: number; normalized: number;
}) {
  const pct = Math.min(Math.max(normalized, 0), 100);
  const contribution = (normalized / 100) * weight;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 shrink-0 text-[var(--muted)]">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-[var(--background)] overflow-hidden">
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-24 shrink-0 text-right tabular-nums text-[var(--muted)]">
        {raw.toFixed(1)}/{maxRaw} × {weight}% = <span className="text-[var(--foreground)] font-medium">{contribution.toFixed(1)}</span>
      </span>
    </div>
  );
}

export function AiOpinionCard({ data, scoreMode = 'standard', shortTermScores }: Props) {
  const [showReport, setShowReport] = useState(false);

  const {
    score_total: rawTotal,
    score_signal,
    score_momentum,
    score_value: score_valuation,
    score_supply,
    score_risk = 0,
  } = data;
  // characters 필드는 제거됨 — 빈 배열로 대체
  const characters: string[] = [];
  const score_total = Math.min(100, Math.max(0, rawTotal));
  const { grade, label: recommendation } = deriveGrade(score_total);

  // 총점 색상
  const gaugeColor =
    score_total >= 70
      ? "text-[var(--buy)]"
      : score_total >= 40
        ? "text-[var(--warning)]"
        : "text-[var(--muted)]";

  // 기술적 패턴 — ai 필드 제거 후 표시하지 않음
  const activePatterns: string[] = [];

  // 리스크 항목 목록
  const riskItems: string[] = [];
  if (data.is_managed) riskItems.push("관리종목");

  return (
    <div className="p-3 sm:p-4 space-y-3 sm:space-y-4">
      <h3 className="text-base sm:text-lg font-semibold">AI 투자의견</h3>

      {/* 총점 + 등급 + 추천 + 캐릭터 태그 */}
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="text-center">
          <p className={`text-3xl sm:text-4xl font-bold tabular-nums ${gaugeColor}`}>
            {score_total.toFixed(0)}
          </p>
          <p className="text-xs text-[var(--muted)]">/ 100</p>
        </div>
        <div className="flex-1 space-y-1">
          {grade && (
            <span className="text-sm font-bold">등급 {grade}</span>
          )}
          {recommendation && (
            <span className="ml-2 text-sm text-[var(--muted)]">
              {recommendation}
            </span>
          )}
          {characters && characters.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {characters.map((c) => (
                <span
                  key={c}
                  className="px-2 py-0.5 text-xs rounded-full bg-[var(--accent)]/20 text-[var(--accent)]"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 항목별 점수 바 */}
      <div className="space-y-3">
        {scoreMode === 'short_term' && shortTermScores ? (
          <>
            <ScoreBar label="모멘텀" score={shortTermScores.momentum}>
              {data.price_change_pct != null && (
                <p>당일 등락률{" "}
                  <span className={data.price_change_pct >= 0 ? "text-[var(--buy)]" : "text-[var(--sell)]"}>
                    {data.price_change_pct >= 0 ? "+" : ""}{data.price_change_pct.toFixed(2)}%
                  </span>
                </p>
              )}
            </ScoreBar>
            <ScoreBar label="수급" score={shortTermScores.supply}>
              {data.foreign_net_qty != null && (
                <p>외국인{" "}
                  <span className={data.foreign_net_qty >= 0 ? "text-[var(--buy)]" : "text-[var(--sell)]"}>
                    {data.foreign_net_qty >= 0 ? "순매수" : "순매도"} {Math.abs(data.foreign_net_qty).toLocaleString()}주
                  </span>
                </p>
              )}
            </ScoreBar>
            <ScoreBar label="촉매" score={shortTermScores.catalyst}>
              <p>30일간 매수신호 {data.signal_count_30d ?? 0}회</p>
            </ScoreBar>
            <ScoreBar label="밸류에이션" score={shortTermScores.valuation}>
              <p>PER {data.per?.toFixed(1) ?? "—"} / PBR {data.pbr?.toFixed(2) ?? "—"}</p>
            </ScoreBar>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">리스크</span>
                <span className={`tabular-nums font-bold ${shortTermScores.risk > 0 ? "text-[var(--danger)]" : "text-[var(--success)]"}`}>
                  {shortTermScores.risk === 0 ? "없음" : `${shortTermScores.risk.toFixed(0)}점`}
                </span>
              </div>
            </div>
          </>
        ) : (
          <>
        {/* 1. 재료/촉매 (v2: 신호 신뢰도에서 변경) */}
        <ScoreBar label="재료/촉매" score={score_signal}>
          <p>30일간 매수신호 {data.signal_count_30d ?? 0}회</p>
          {data.latest_signal_type && (
            <p>
              최근 신호:{" "}
              {SIGNAL_TYPE_LABELS[data.latest_signal_type] ??
                data.latest_signal_type}{" "}
              ({data.latest_signal_date ?? "—"})
            </p>
          )}
        </ScoreBar>

        {/* 2. 모멘텀 (v2: 기술적 모멘텀에서 변경) */}
        <ScoreBar label="모멘텀" score={score_momentum}>
          {data.price_change_pct != null && (
            <p>
              당일 등락률{" "}
              <span
                className={
                  data.price_change_pct >= 0
                    ? "text-[var(--buy)]"
                    : "text-[var(--sell)]"
                }
              >
                {data.price_change_pct >= 0 ? "+" : ""}
                {data.price_change_pct.toFixed(2)}%
              </span>
            </p>
          )}
          {activePatterns.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {activePatterns.map((p) => (
                <span
                  key={p}
                  className="px-1.5 py-0.5 text-[10px] rounded bg-purple-900/40 text-purple-300"
                >
                  {p}
                </span>
              ))}
            </div>
          )}
        </ScoreBar>

        {/* 3. 가치/성장 (v2: 밸류에이션에서 변경) */}
        <ScoreBar label="가치/성장" score={score_valuation}>
          <p>
            PER {data.per?.toFixed(1) ?? "—"} / PBR{" "}
            {data.pbr?.toFixed(2) ?? "—"} / ROE{" "}
            {data.roe?.toFixed(1) ?? "—"}%
          </p>
          {data.forward_per != null && (
            <p>추정PER {data.forward_per.toFixed(1)}</p>
          )}
          {data.dividend_yield != null && data.dividend_yield > 0 && (
            <p>배당수익률 {data.dividend_yield.toFixed(2)}%</p>
          )}
        </ScoreBar>

        {/* 4. 수급 동향 */}
        <ScoreBar label="수급 동향" score={score_supply}>
          {data.foreign_net_qty != null && (
            <p>
              외국인{" "}
              <span
                className={
                  data.foreign_net_qty >= 0
                    ? "text-[var(--buy)]"
                    : "text-[var(--sell)]"
                }
              >
                {data.foreign_net_qty >= 0 ? "순매수" : "순매도"}{" "}
                {Math.abs(data.foreign_net_qty).toLocaleString()}주
              </span>
              {data.foreign_streak != null &&
                data.foreign_streak > 0 &&
                ` (연속 ${data.foreign_streak}일)`}
            </p>
          )}
          {data.institution_net_qty != null && (
            <p>
              기관{" "}
              <span
                className={
                  data.institution_net_qty >= 0
                    ? "text-[var(--buy)]"
                    : "text-[var(--sell)]"
                }
              >
                {data.institution_net_qty >= 0 ? "순매수" : "순매도"}{" "}
                {Math.abs(data.institution_net_qty).toLocaleString()}주
              </span>
              {data.institution_streak != null &&
                data.institution_streak > 0 &&
                ` (연속 ${data.institution_streak}일)`}
            </p>
          )}
          {data.short_sell_ratio != null && (
            <p>공매도 비율 {data.short_sell_ratio.toFixed(2)}%</p>
          )}
        </ScoreBar>

        {/* 5. 리스크 (차감 점수) */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">리스크</span>
            <span
              className={`tabular-nums font-bold ${
                score_risk < 0
                  ? "text-[var(--danger)]"
                  : "text-[var(--success)]"
              }`}
            >
              {score_risk === 0 ? "없음" : `${score_risk.toFixed(0)}점`}
            </span>
          </div>
          {riskItems.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {riskItems.map((r) => (
                <span
                  key={r}
                  className="px-2 py-0.5 text-xs rounded-full bg-[var(--danger)]/20 text-[var(--danger)]"
                >
                  {r}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--success)]">리스크 요인 없음</p>
          )}
        </div>
          </>
        )}
      </div>

      {/* ── 점수 산출 리포트 (접이식) ── */}
      <button
        type="button"
        onClick={() => setShowReport(!showReport)}
        className="w-full text-left text-xs font-medium text-[var(--accent)] hover:underline py-1"
      >
        {showReport ? "▼ 점수 산출 리포트 접기" : "▶ 점수 산출 리포트 보기"}
      </button>

      {showReport && (
        <ScoreReport
          data={data}
          scoreMode={scoreMode}
          shortTermScores={shortTermScores}
        />
      )}
    </div>
  );
}

/* ================================================================
 * 점수 산출 리포트 — 각 항목의 원점수, 가중치, 기여도를 시각화
 * ================================================================ */

function ScoreReport({
  data,
  scoreMode,
  shortTermScores,
}: {
  data: StockRankItem;
  scoreMode: 'standard' | 'short_term';
  shortTermScores?: ShortTermDisplayScores;
}) {
  if (scoreMode === 'short_term' && shortTermScores) {
    return <ShortTermReport data={data} scores={shortTermScores} />;
  }
  return <StandardReport data={data} />;
}

/* ── 종목추천 리포트 ── */
function StandardReport({ data }: { data: StockRankItem }) {
  // 시총 티어 추정 (market_cap 단위: 억원)
  const mcap = data.market_cap ?? 0;
  const tier: 'large' | 'mid' | 'small' =
    mcap >= 100000 ? 'large' : mcap >= 10000 ? 'mid' : 'small';
  const w = WEIGHTS_BY_TIER[tier];

  // score_* 필드는 이미 0~100 정규화 점수
  const normSignal = data.score_signal ?? 0;
  const normTrend = data.score_momentum ?? 0;
  const normValuation = data.score_value ?? 0;
  const normSupply = data.score_supply ?? 0;
  const normRisk = data.score_risk ?? 0;
  // 원점수 역산 (WeightBar 표시용)
  const rawSignal = normSignal * 30 / 100;
  const rawTrend = normTrend * 65 / 100;
  const rawValuation = normValuation * 25 / 100;
  const rawSupply = normSupply * 55 / 100 - 10;
  const rawRisk = normRisk;

  // 기여도 계산
  const contCatalyst = (normSignal / 100) * w.catalyst;
  const contTrend = (normTrend / 100) * w.trend;
  const contVal = (normValuation / 100) * w.valuation;
  const contSupply = (normSupply / 100) * w.supply;
  const contEarn = 0;
  const contRisk = (normRisk / 100) * w.risk;
  const base = contCatalyst + contTrend + contVal + contSupply + contEarn;

  // 기술 패턴 — ai 필드 제거 후 표시하지 않음
  const patterns: string[] = [];

  // 수급 상세
  const supplyDetails: string[] = [];
  if (data.foreign_net_qty != null && data.foreign_net_qty > 0) supplyDetails.push("외국인 순매수");
  if (data.institution_net_qty != null && data.institution_net_qty > 0) supplyDetails.push("기관 순매수");
  if (data.foreign_net_qty != null && data.foreign_net_qty > 0 &&
      data.institution_net_qty != null && data.institution_net_qty > 0) supplyDetails.push("동반매수");
  if (data.foreign_streak != null) {
    if (data.foreign_streak === 1) supplyDetails.push("외국인 매수 전환 첫날");
    else if (data.foreign_streak >= 2) supplyDetails.push(`외국인 ${data.foreign_streak}일 연속 매수`);
  }
  if (data.institution_streak != null) {
    if (data.institution_streak === 1) supplyDetails.push("기관 매수 전환 첫날");
    else if (data.institution_streak >= 2) supplyDetails.push(`기관 ${data.institution_streak}일 연속 매수`);
  }

  return (
    <div className="space-y-3 text-xs border-t border-[var(--border)] pt-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sm">종목추천 산출 근거</h4>
        <span className="px-2 py-0.5 rounded bg-[var(--accent)]/20 text-[var(--accent)] text-[10px] font-medium">
          {tier === 'large' ? '대형주' : tier === 'mid' ? '중형주' : '소형주'} 가중치
        </span>
      </div>

      {/* 가중치 기여도 막대 */}
      <div className="space-y-1.5">
        <WeightBar label="재료/촉매" raw={rawSignal} maxRaw={30} weight={w.catalyst} normalized={normSignal} />
        <WeightBar label="모멘텀" raw={rawTrend} maxRaw={65} weight={w.trend} normalized={normTrend} />
        <WeightBar label="가치/성장" raw={rawValuation} maxRaw={20} weight={w.valuation} normalized={normValuation} />
        <WeightBar label="수급" raw={rawSupply} maxRaw={45} weight={w.supply} normalized={normSupply} />
        {w.earnings_momentum > 0 && (
          <WeightBar label="이익모멘텀" raw={0} maxRaw={80} weight={w.earnings_momentum} normalized={0} />
        )}
      </div>

      {/* 총점 공식 */}
      <div className="p-2 rounded bg-[var(--background)] text-[10px] font-mono leading-relaxed">
        <p>base = {contCatalyst.toFixed(1)} + {contTrend.toFixed(1)} + {contVal.toFixed(1)} + {contSupply.toFixed(1)} = <span className="font-bold">{base.toFixed(1)}</span></p>
        <p>risk 감산 = {contRisk.toFixed(1)} (원점수 {rawRisk.toFixed(0)} × {w.risk}%)</p>
        <p>total = {base.toFixed(1)} − {contRisk.toFixed(1)} = <span className="font-bold text-[var(--foreground)]">{Math.max(0, base - contRisk).toFixed(1)}</span></p>
      </div>

      {/* 활성 기술 패턴 */}
      {patterns.length > 0 && (
        <div>
          <p className="text-[var(--muted)] mb-1">활성 기술 패턴:</p>
          <div className="flex flex-wrap gap-1">
            {patterns.map((p) => (
              <span key={p} className="px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-300 text-[10px]">
                {p}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 수급 상세 */}
      {supplyDetails.length > 0 && (
        <div>
          <p className="text-[var(--muted)] mb-1">수급 구성:</p>
          <div className="flex flex-wrap gap-1">
            {supplyDetails.map((s) => (
              <span key={s} className="px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300 text-[10px]">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 밸류에이션 상세 */}
      <div>
        <p className="text-[var(--muted)] mb-1">밸류에이션 입력값:</p>
        <div className="grid grid-cols-3 gap-1 text-[10px]">
          <span>PER {data.per?.toFixed(1) ?? "—"}</span>
          <span>PBR {data.pbr?.toFixed(2) ?? "—"}</span>
          <span>ROE {data.roe?.toFixed(1) ?? "—"}%</span>
          {data.forward_per != null && <span>F.PER {data.forward_per.toFixed(1)}</span>}
          {data.dividend_yield != null && data.dividend_yield > 0 && (
            <span>배당 {data.dividend_yield.toFixed(2)}%</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── 단기추천 리포트 ── */
function ShortTermReport({ data, scores }: { data: StockRankItem; scores: ShortTermDisplayScores }) {
  const w = DEFAULT_SHORT_TERM_WEIGHTS;

  const contMom = (scores.momentum / 100) * w.momentum;
  const contSup = (scores.supply / 100) * w.supply;
  const contCat = (scores.catalyst / 100) * w.catalyst;
  const contVal = (scores.valuation / 100) * w.valuation;
  const contRisk = (scores.risk / 100) * w.risk;
  const base = contMom + contSup + contCat + contVal;

  // 프리필터 통과 조건 요약
  const filterInfo: string[] = [];
  if (data.price_change_pct != null) {
    filterInfo.push(`등락률 ${data.price_change_pct >= 0 ? '+' : ''}${data.price_change_pct.toFixed(2)}%`);
  }

  return (
    <div className="space-y-3 text-xs border-t border-[var(--border)] pt-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sm">단기추천 산출 근거</h4>
        <span className="px-2 py-0.5 rounded bg-orange-900/40 text-orange-300 text-[10px] font-medium">
          1~2일 모멘텀
        </span>
      </div>

      {/* 가중치 기여도 막대 */}
      <div className="space-y-1.5">
        <WeightBar label="모멘텀" raw={scores.momentum} maxRaw={100} weight={w.momentum} normalized={scores.momentum} />
        <WeightBar label="수급" raw={scores.supply} maxRaw={100} weight={w.supply} normalized={scores.supply} />
        <WeightBar label="촉매" raw={scores.catalyst} maxRaw={100} weight={w.catalyst} normalized={scores.catalyst} />
        <WeightBar label="밸류에이션" raw={scores.valuation} maxRaw={100} weight={w.valuation} normalized={scores.valuation} />
      </div>

      {/* 총점 공식 */}
      <div className="p-2 rounded bg-[var(--background)] text-[10px] font-mono leading-relaxed">
        <p>base = {contMom.toFixed(1)} + {contSup.toFixed(1)} + {contCat.toFixed(1)} + {contVal.toFixed(1)} = <span className="font-bold">{base.toFixed(1)}</span></p>
        <p>risk 감산 = {contRisk.toFixed(1)} (점수 {scores.risk.toFixed(0)} × {w.risk}%)</p>
        <p>total = {base.toFixed(1)} − {contRisk.toFixed(1)} = <span className="font-bold text-[var(--foreground)]">{Math.max(0, base - contRisk).toFixed(1)}</span></p>
      </div>

      {/* 프리필터 통과 정보 */}
      {filterInfo.length > 0 && (
        <div>
          <p className="text-[var(--muted)] mb-1">프리필터 통과 조건:</p>
          <div className="flex flex-wrap gap-1">
            {filterInfo.map((f) => (
              <span key={f} className="px-1.5 py-0.5 rounded bg-green-900/40 text-green-300 text-[10px]">
                {f}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 수급 상세 */}
      <div>
        <p className="text-[var(--muted)] mb-1">수급 정보:</p>
        <div className="space-y-0.5 text-[10px]">
          {data.foreign_net_qty != null && (
            <p>
              외국인 {data.foreign_net_qty >= 0 ? "순매수" : "순매도"} {Math.abs(data.foreign_net_qty).toLocaleString()}주
              {data.foreign_streak != null && data.foreign_streak !== 0 && (
                <span className="text-[var(--muted)]">
                  {" "}(streak {data.foreign_streak > 0 ? '+' : ''}{data.foreign_streak}일)
                </span>
              )}
            </p>
          )}
          {data.institution_net_qty != null && (
            <p>
              기관 {data.institution_net_qty >= 0 ? "순매수" : "순매도"} {Math.abs(data.institution_net_qty).toLocaleString()}주
              {data.institution_streak != null && data.institution_streak !== 0 && (
                <span className="text-[var(--muted)]">
                  {" "}(streak {data.institution_streak > 0 ? '+' : ''}{data.institution_streak}일)
                </span>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
