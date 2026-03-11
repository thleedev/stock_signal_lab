/**
 * 투자 시황 점수 계산 엔진
 *
 * 10개 지표를 정규화 → 방향 보정 → 가중 평균으로 종합 점수 산출
 */

import type { IndicatorWeight, MarketIndicator } from '@/types/market';
import type { MarketEvent } from '@/types/market-event';

interface IndicatorData {
  current: number;
  min90d: number;
  max90d: number;
}

interface ScoreBreakdown {
  indicator_type: string;
  value: number;
  normalized: number;
  weighted_score: number;
  weight: number;
  direction: number;
}

/**
 * 단일 지표의 정규화 점수 계산 (0~100)
 */
function normalizeScore(
  current: number,
  min: number,
  max: number,
  direction: number
): number {
  if (max === min) return 50; // 변동 없으면 중립

  const normalized = ((current - min) / (max - min)) * 100;
  const clamped = Math.max(0, Math.min(100, normalized));

  // 역방향 지표는 100에서 뺌
  return direction === -1 ? 100 - clamped : clamped;
}

/**
 * 종합 시황 점수 계산
 */
export function calculateMarketScore(
  indicators: Record<string, IndicatorData>,
  weights: IndicatorWeight[]
): { totalScore: number; breakdown: Record<string, ScoreBreakdown> } {
  const breakdown: Record<string, ScoreBreakdown> = {};
  let weightedSum = 0;
  let totalWeight = 0;

  for (const w of weights) {
    const data = indicators[w.indicator_type];
    if (!data) continue;

    const score = normalizeScore(data.current, data.min90d, data.max90d, w.direction);
    const weightedScore = score * w.weight;

    breakdown[w.indicator_type] = {
      indicator_type: w.indicator_type,
      value: data.current,
      normalized: Math.round(score * 100) / 100,
      weighted_score: Math.round(weightedScore * 100) / 100,
      weight: w.weight,
      direction: w.direction,
    };

    weightedSum += weightedScore;
    totalWeight += w.weight;
  }

  const totalScore = totalWeight > 0
    ? Math.round((weightedSum / totalWeight) * 100) / 100
    : 50;

  return { totalScore, breakdown };
}

/**
 * 클라이언트 사이드: 가중치 변경 시 즉시 재계산
 */
export function recalculateWithWeights(
  breakdown: Record<string, ScoreBreakdown>,
  newWeights: Record<string, number>
): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [type, item] of Object.entries(breakdown)) {
    const weight = newWeights[type] ?? item.weight;
    const score = normalizeScore(
      item.value,
      0, // 클라이언트에서는 이미 정규화된 값 사용
      100,
      1 // 이미 방향 보정됨
    );
    weightedSum += item.normalized * weight;
    totalWeight += weight;
  }

  return totalWeight > 0
    ? Math.round((weightedSum / totalWeight) * 100) / 100
    : 50;
}

/**
 * 공포탐욕 지수 자체 계산
 * VIX 정규화 (40%) + KOSPI 20일 이동평균 괴리율 (30%) + 매수/매도 신호 비율 (30%)
 */
export function calculateFearGreedIndex(
  vixScore: number,
  kospiDeviation: number, // -100 ~ +100
  buyRatio: number        // 0 ~ 1 (매수 비율)
): number {
  // VIX: 낮을수록 탐욕 (이미 역방향 정규화된 값 사용)
  const vixComponent = vixScore * 0.4;

  // KOSPI 괴리율: 양수면 탐욕, 음수면 공포
  const deviationNormalized = Math.max(0, Math.min(100, (kospiDeviation + 100) / 2));
  const deviationComponent = deviationNormalized * 0.3;

  // 매수/매도 비율: 매수 많으면 탐욕
  const ratioComponent = buyRatio * 100 * 0.3;

  return Math.round(vixComponent + deviationComponent + ratioComponent);
}

/**
 * 이벤트 리스크 스코어 계산 (0~100, 100=리스크없음)
 */
export function calculateEventRiskScore(events: MarketEvent[], baseDate?: Date): number {
  const today = baseDate ?? new Date();
  const todayStr = today.toISOString().slice(0, 10);
  let totalPenalty = 0;

  for (const event of events) {
    const eventDate = new Date(event.event_date + 'T00:00:00');
    const todayDate = new Date(todayStr + 'T00:00:00');
    const daysUntil = Math.round((eventDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntil < 0) continue;

    const decay = daysUntil === 0 ? 1.0
                : daysUntil <= 1 ? 0.8
                : daysUntil <= 3 ? 0.5
                : daysUntil <= 7 ? 0.2
                : 0;

    totalPenalty += Math.abs(event.risk_score) * decay;
  }

  totalPenalty = Math.min(totalPenalty, 80);
  return Math.max(0, Math.min(100, 100 - totalPenalty));
}

/**
 * 통합 스코어 = 마켓 × 0.7 + 이벤트 리스크 × 0.3
 */
export function calculateCombinedScore(marketScore: number, eventRiskScore: number): number {
  const combined = marketScore * 0.7 + eventRiskScore * 0.3;
  return Math.round(combined * 100) / 100;
}
