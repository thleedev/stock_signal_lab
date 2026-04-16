/**
 * Catalyst 점수 (재료/촉매 레이어)
 *
 * 기존 valuation_score + earnings_momentum에서 이관:
 *   - 목표주가 상승여력
 *   - 투자의견
 *
 * 신규:
 *   - 신호 신선도 + 진입 타이밍
 *   - 섹터 모멘텀
 *
 * 원점수 범위: 0~100
 */

import type { ScoreReason, NormalizedScoreBase } from '@/types/score-reason';

export interface CatalystScoreInput {
  // 이관: 목표주가
  targetPrice: number | null;
  currentPrice: number | null;
  // 이관: 투자의견
  investOpinion: number | null;
  // 신호 신선도
  todaySourceCount: number;
  daysSinceLastSignal: number | null;
  // 진입 타이밍 (신호가 대비 현재가)
  signalPriceGapPct: number | null; // (현재가 - 신호가) / 신호가 * 100
  // 섹터 모멘텀 (선택적)
  sectorRank: number | null;        // 당일 섹터 등락률 순위
  sectorTotalCount: number;
  sectorAvgChangePct: number | null;
  stockChangePct: number | null;
}

export interface CatalystScoreResult extends NormalizedScoreBase {
  score: number; // 0~100
  target_upside: number | null;
}

const MAX_RAW = 100;

/** 정규화 포인트 계산: rawPoints / MAX_RAW * 100 */
function normPt(rawPoints: number): number {
  return Math.round((rawPoints / MAX_RAW) * 100 * 10) / 10;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
}

export function calcCatalystScore(input: CatalystScoreInput): CatalystScoreResult {
  let score = 0;
  const reasons: ScoreReason[] = [];

  // ── A. 목표주가 상승여력 (0~30) ──
  let targetUpside: number | null = null;
  let upsidePoints = 0;
  if (input.targetPrice && input.currentPrice && input.currentPrice > 0) {
    targetUpside = ((input.targetPrice - input.currentPrice) / input.currentPrice) * 100;
    if (targetUpside >= 50) upsidePoints = 30;
    else if (targetUpside >= 30) upsidePoints = 22;
    else if (targetUpside >= 15) upsidePoints = 12;
    else if (targetUpside >= 5) upsidePoints = 5;
    score += upsidePoints;
  }
  reasons.push({
    label: '목표주가 상승여력',
    points: normPt(upsidePoints),
    detail: targetUpside !== null
      ? `목표 ${fmt(input.targetPrice!)} vs 현재 ${fmt(input.currentPrice!)} (상승여력 ${Math.round(targetUpside * 10) / 10}%)`
      : '목표주가 데이터 없음',
    met: upsidePoints > 0,
  });

  // ── B. 투자의견 (0~20) ──
  let opinionPoints = 0;
  if (input.investOpinion !== null && input.investOpinion > 0) {
    if (input.investOpinion >= 4.5) opinionPoints = 20;
    else if (input.investOpinion >= 3.5) opinionPoints = 14;
    else if (input.investOpinion >= 2.5) opinionPoints = 5;
    score += opinionPoints;
  }
  reasons.push({
    label: '투자의견',
    points: normPt(opinionPoints),
    detail: input.investOpinion !== null
      ? `애널리스트 합의 ${Math.round(input.investOpinion * 10) / 10}/5`
      : '투자의견 데이터 없음',
    met: opinionPoints > 0,
  });

  // ── C. 신호 신선도 (0~25) ──
  let freshnessPoints = 0;
  const daysAgo = input.daysSinceLastSignal;
  const srcCount = input.todaySourceCount;

  if (daysAgo === null || daysAgo > 7) {
    freshnessPoints = 0;
  } else if (daysAgo === 0) {
    // 오늘 신호
    if (srcCount >= 3) freshnessPoints = 25;
    else if (srcCount >= 2) freshnessPoints = 20;
    else freshnessPoints = 15;
  } else if (daysAgo === 1) {
    freshnessPoints = 8;
  } else if (daysAgo <= 3) {
    freshnessPoints = 4;
  }
  score += freshnessPoints;
  reasons.push({
    label: '신호 신선도',
    points: normPt(freshnessPoints),
    detail: daysAgo !== null
      ? daysAgo === 0
        ? `오늘 ${srcCount}개 소스 신호`
        : `${daysAgo}일 전 신호`
      : '신호 없음',
    met: freshnessPoints > 0,
  });

  // ── D. 진입 타이밍 (0~15) ──
  let timingPoints = 0;
  if (input.signalPriceGapPct !== null) {
    const gap = input.signalPriceGapPct;
    if (gap <= -3) timingPoints = 15;       // 신호가 대비 -3% 이하 (할인 진입)
    else if (gap <= 0) timingPoints = 10;   // 신호가 이하 (좋은 진입)
    else if (gap <= 3) timingPoints = 5;    // 3% 이내 (아직 괜찮음)
    else if (gap >= 7) timingPoints = 0;    // 7% 이상 추격 (점수 없음)
    else timingPoints = 2;                  // 3~7% (약한 점수)
    score += timingPoints;
  }
  reasons.push({
    label: '진입 타이밍',
    points: normPt(timingPoints),
    detail: input.signalPriceGapPct !== null
      ? `신호가 대비 ${input.signalPriceGapPct >= 0 ? '+' : ''}${Math.round(input.signalPriceGapPct * 10) / 10}%`
      : '신호가 정보 없음',
    met: timingPoints > 0,
  });

  // ── E. 섹터 모멘텀 (0~10, 약세 시 -8) ──
  let sectorPoints = 0;
  if (input.sectorRank !== null && input.sectorTotalCount > 0) {
    const pctRank = input.sectorRank / input.sectorTotalCount;
    if (input.sectorRank <= 3) sectorPoints = 10;
    else if (pctRank <= 0.2) sectorPoints = 6;
    else if (input.sectorAvgChangePct !== null && input.stockChangePct !== null
      && input.stockChangePct > input.sectorAvgChangePct) sectorPoints = 3;
    else if (input.sectorAvgChangePct !== null && input.sectorAvgChangePct < -1.5) {
      sectorPoints = -8;
    }
    score += sectorPoints;
  }
  reasons.push({
    label: '섹터 모멘텀',
    points: normPt(sectorPoints),
    detail: input.sectorRank !== null
      ? `섹터 순위 ${input.sectorRank}/${input.sectorTotalCount} (평균 ${input.sectorAvgChangePct !== null ? (input.sectorAvgChangePct >= 0 ? '+' : '') + Math.round(input.sectorAvgChangePct * 10) / 10 + '%' : '-'})`
      : '섹터 데이터 없음',
    met: sectorPoints > 0,
  });

  const rawScore = Math.max(0, Math.min(score, MAX_RAW));
  const normalizedScore = Math.round((rawScore / MAX_RAW) * 100 * 10) / 10;

  return {
    score: rawScore,
    rawScore,
    normalizedScore: Math.max(0, Math.min(normalizedScore, 100)),
    reasons,
    target_upside: targetUpside,
  };
}
