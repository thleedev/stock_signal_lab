// web/src/components/stock-modal/AiOpinionCard.tsx
"use client";

import type { StockRankItem } from "@/app/api/v1/stock-ranking/route";
import { SIGNAL_TYPE_LABELS } from "@/lib/signal-constants";

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

export function AiOpinionCard({ data, scoreMode = 'standard', shortTermScores }: Props) {
  const {
    score_total: rawTotal,
    score_signal,
    score_momentum,
    score_valuation,
    score_supply,
    score_risk = 0,
    characters,
  } = data;
  const score_total = Math.min(100, Math.max(0, rawTotal));
  const { grade, label: recommendation } = deriveGrade(score_total);

  // 총점 색상
  const gaugeColor =
    score_total >= 70
      ? "text-[var(--buy)]"
      : score_total >= 40
        ? "text-[var(--warning)]"
        : "text-[var(--muted)]";

  // ai 서브객체에서 활성 기술적 패턴 추출
  const activePatterns: string[] = [];
  if (data.ai) {
    for (const [key, label] of Object.entries(PATTERN_LABELS)) {
      if (data.ai[key as keyof typeof data.ai] === true) {
        activePatterns.push(label);
      }
    }
  }

  // 리스크 항목 목록
  const riskItems: string[] = [];
  if (data.is_managed) riskItems.push("관리종목");
  if (data.has_recent_cbw) riskItems.push("CB/BW 최근 발행");
  if (data.major_shareholder_pct != null && data.major_shareholder_pct > 0 && data.major_shareholder_pct < 20) {
    riskItems.push(`대주주 지분 ${data.major_shareholder_pct.toFixed(1)}%`);
  }
  if (data.audit_opinion && data.audit_opinion !== "적정") {
    riskItems.push(`감사의견: ${data.audit_opinion}`);
  }

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-lg font-semibold">AI 투자의견</h3>

      {/* 총점 + 등급 + 추천 + 캐릭터 태그 */}
      <div className="flex items-center gap-4">
        <div className="text-center">
          <p className={`text-4xl font-bold tabular-nums ${gaugeColor}`}>
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
        {/* 1. 신호 신뢰도 */}
        <ScoreBar label="신호 신뢰도" score={score_signal}>
          <p>30일간 매수신호 {data.signal_count_30d ?? 0}회</p>
          {data.latest_signal_type && (
            <p>
              최근 신호:{" "}
              {SIGNAL_TYPE_LABELS[data.latest_signal_type] ??
                data.latest_signal_type}{" "}
              ({data.latest_signal_date ?? "—"})
            </p>
          )}
          {data.gap_pct != null && (
            <p>
              신호가 대비 현재가{" "}
              <span
                className={
                  data.gap_pct >= 0
                    ? "text-[var(--buy)]"
                    : "text-[var(--sell)]"
                }
              >
                {data.gap_pct >= 0 ? "+" : ""}
                {data.gap_pct.toFixed(1)}%
              </span>
            </p>
          )}
        </ScoreBar>

        {/* 2. 기술적 모멘텀 */}
        <ScoreBar label="기술적 모멘텀" score={score_momentum}>
          {data.close_position != null && (
            <p>
              52주 범위 내 위치{" "}
              {(data.close_position * 100).toFixed(0)}%
            </p>
          )}
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

        {/* 3. 밸류에이션 */}
        <ScoreBar label="밸류에이션" score={score_valuation}>
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
          {(data.revenue_growth_yoy != null ||
            data.operating_profit_growth_yoy != null) && (
            <p>
              {data.revenue_growth_yoy != null &&
                `매출 YoY ${data.revenue_growth_yoy >= 0 ? "+" : ""}${data.revenue_growth_yoy.toFixed(1)}%`}
              {data.revenue_growth_yoy != null &&
                data.operating_profit_growth_yoy != null &&
                " / "}
              {data.operating_profit_growth_yoy != null &&
                `영업이익 YoY ${data.operating_profit_growth_yoy >= 0 ? "+" : ""}${data.operating_profit_growth_yoy.toFixed(1)}%`}
            </p>
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
    </div>
  );
}
