// web/src/lib/scoring/supply-strength.ts
// 수급강도 점수 모듈 — streak 중심 (시총비율 로직 폐기)

import type { ScoreReason, NormalizedScoreBase } from '@/types/score-reason';

/** 수급강도 점수 결과 */
export interface SupplyStrengthResult extends NormalizedScoreBase {
  /** 외국인 순매수 여부 */
  foreign_buying: boolean;
  /** 기관 순매수 여부 */
  institution_buying: boolean;
  /** 공매도 비율 낮음 여부 */
  low_short_sell: boolean;
}

/** 수급강도 점수 입력값 */
export interface SupplyStrengthInput {
  /** 외국인 연속 매수(+) / 매도(-) 일수. 0이면 중립 */
  foreignStreak: number | null;
  /** 기관 연속 매수(+) / 매도(-) 일수. 0이면 중립 */
  institutionStreak: number | null;
  /** 외국인 당일 순매수 수량 */
  foreignNetQty: number | null;
  /** 기관 당일 순매수 수량 */
  institutionNetQty: number | null;
  /** 외국인 5일 누적 순매수 */
  foreignNet5d: number | null;
  /** 기관 5일 누적 순매수 */
  institutionNet5d: number | null;
  /** 공매도 비율 (%) */
  shortSellRatio: number | null;
}

/** 원점수 최대값 (정규화 기준) */
const MAX_RAW = 65;

/**
 * 수급강도 점수를 계산한다.
 *
 * 점수 구성:
 * - 외국인 streak: 전환(1~2일) +20, 매집(3~5일) +15, 과열(6일+) +5, 연속매도(3일+) -15
 * - 기관 streak: 동일 기준
 * - 동반 매수 당일: +10
 * - 5일 누적 동반 순매수: +10
 * - 공매도 1% 미만: +5
 * 최대 원점수: 65 → 정규화 100점
 */
export function calcSupplyStrength(input: SupplyStrengthInput): SupplyStrengthResult {
  const {
    foreignStreak,
    institutionStreak,
    foreignNetQty,
    institutionNetQty,
    foreignNet5d,
    institutionNet5d,
    shortSellRatio,
  } = input;

  let rawScore = 0;
  const reasons: ScoreReason[] = [];

  const fStreak = foreignStreak ?? 0;
  const iStreak = institutionStreak ?? 0;
  const foreignBuying = foreignNetQty !== null && foreignNetQty > 0;
  const institutionBuying = institutionNetQty !== null && institutionNetQty > 0;

  // ── 외국인 수급 (전환 시점에 최고점) ──
  let fScore = 0;
  let fDetail = '';
  if (fStreak >= 1 && fStreak <= 2) {
    fScore = 20;
    fDetail = `외국인 매수 전환 ${fStreak}일 (새 수급 유입)`;
  } else if (fStreak >= 3 && fStreak <= 5) {
    fScore = 15;
    fDetail = `외국인 ${fStreak}일 연속 매수 (매집 중)`;
  } else if (fStreak > 5) {
    fScore = 5;
    fDetail = `외국인 ${fStreak}일 연속 매수 (과열 주의)`;
  } else if (fStreak <= -3) {
    fScore = -15;
    fDetail = `외국인 ${Math.abs(fStreak)}일 연속 매도 ⚠️`;
  } else {
    fDetail = fStreak < 0 ? `외국인 ${Math.abs(fStreak)}일 매도` : '외국인 중립';
  }
  rawScore += fScore;
  reasons.push({
    label: '외국인 수급',
    points: Math.round((fScore / MAX_RAW) * 100),
    detail: fDetail,
    met: fScore > 0,
  });

  // ── 기관 수급 (동일 기준) ──
  let iScore = 0;
  let iDetail = '';
  if (iStreak >= 1 && iStreak <= 2) {
    iScore = 20;
    iDetail = `기관 매수 전환 ${iStreak}일 (새 수급 유입)`;
  } else if (iStreak >= 3 && iStreak <= 5) {
    iScore = 15;
    iDetail = `기관 ${iStreak}일 연속 매수 (매집 중)`;
  } else if (iStreak > 5) {
    iScore = 5;
    iDetail = `기관 ${iStreak}일 연속 매수 (과열 주의)`;
  } else if (iStreak <= -3) {
    iScore = -15;
    iDetail = `기관 ${Math.abs(iStreak)}일 연속 매도 ⚠️`;
  } else {
    iDetail = iStreak < 0 ? `기관 ${Math.abs(iStreak)}일 매도` : '기관 중립';
  }
  rawScore += iScore;
  reasons.push({
    label: '기관 수급',
    points: Math.round((iScore / MAX_RAW) * 100),
    detail: iDetail,
    met: iScore > 0,
  });

  // ── 동반 매수 (스마트머니 동시 유입) ──
  const bothBuying = foreignBuying && institutionBuying;
  if (bothBuying) {
    rawScore += 10;
    reasons.push({
      label: '동반 매수',
      points: Math.round((10 / MAX_RAW) * 100),
      detail: '외국인+기관 동반 순매수',
      met: true,
    });
  } else {
    reasons.push({ label: '동반 매수', points: 0, detail: '동반 매수 없음', met: false });
  }

  // ── 5일 누적 동반 순매수 ──
  const bothPositive5d = (foreignNet5d ?? 0) > 0 && (institutionNet5d ?? 0) > 0;
  if (bothPositive5d) {
    rawScore += 10;
    reasons.push({
      label: '5일 누적 동반',
      points: Math.round((10 / MAX_RAW) * 100),
      detail: '5일 누적 외국인+기관 동반 순매수',
      met: true,
    });
  } else {
    reasons.push({ label: '5일 누적 동반', points: 0, detail: '5일 누적 동반 없음', met: false });
  }

  // ── 공매도 비율 낮음 (1% 미만) ──
  const lowShortSell = shortSellRatio !== null && shortSellRatio >= 0 && shortSellRatio < 1;
  if (lowShortSell) {
    rawScore += 5;
    reasons.push({
      label: '공매도',
      points: Math.round((5 / MAX_RAW) * 100),
      detail: `공매도 ${shortSellRatio!.toFixed(2)}% (1% 미만)`,
      met: true,
    });
  } else {
    const detail =
      shortSellRatio !== null ? `공매도 ${shortSellRatio.toFixed(2)}%` : '공매도 데이터 없음';
    reasons.push({ label: '공매도', points: 0, detail, met: false });
  }

  // 원점수 클램핑 후 0~100 정규화
  const clampedRaw = Math.max(-30, Math.min(rawScore, MAX_RAW));
  const normalizedScore = Math.round(Math.max(0, (clampedRaw / MAX_RAW) * 100) * 10) / 10;

  return {
    rawScore: clampedRaw,
    normalizedScore,
    reasons,
    foreign_buying: foreignBuying,
    institution_buying: institutionBuying,
    low_short_sell: lowShortSell,
  };
}
