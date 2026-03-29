/**
 * 리스크 감점 모듈
 *
 * 기술적 과열(RSI, 급등, 이격도, 볼린저 상단 돌파, 쌍봉)과
 * 수급 이탈(외국인/기관 순매도, 연속 매도, 공매도 비율)을 종합하여
 * 0~100 범위의 리스크 점수를 산출한다.
 *
 * 오케스트레이터(Task 4)에서 최종 추천 점수 산정 시 감산 항목으로 사용.
 */

import { type ScoreReason, type NormalizedScoreBase } from '@/types/score-reason';

export interface RiskScoreInput {
  rsi: number | null;
  pct5d: number;              // 5일 누적 등락률 (%)
  disparity20: number;        // 20일선 대비 이격도 (1.10 = 110%)
  bollingerUpper: number | null;
  currentPrice: number;
  doubleTop: boolean;
  foreignNet: number | null;
  institutionNet: number | null;
  foreignStreak: number | null;    // 연속 순매수/순매도 일수 (음수=매도)
  institutionStreak: number | null;
  shortSellRatio: number | null;   // 공매도 비율 (%)
}

export interface RiskScoreResult extends NormalizedScoreBase {
  score: number;  // 0~100
  rsi_overbought: boolean;
  surge_5d: boolean;
  high_disparity: boolean;
  bollinger_upper_break: boolean;
  double_top_risk: boolean;
  smart_money_exit: boolean;
  short_sell_high: boolean;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
}

export function calcRiskScore(input: RiskScoreInput): RiskScoreResult {
  let techRisk = 0;
  let supplyRisk = 0;
  const reasons: ScoreReason[] = [];

  // --- 기술적 위험 (최대 50) ---

  // RSI 과매수: 70 이상이면 15점 감점
  const rsiOverbought = input.rsi !== null && input.rsi >= 70;
  if (rsiOverbought) techRisk += 15;
  reasons.push({
    label: 'RSI 과매수',
    points: rsiOverbought ? -15 : 0,
    detail: `RSI ${input.rsi ?? 'N/A'} (기준: 70 이상)`,
    met: rsiOverbought,
  });

  // 5일 급등: 15% 이상 12점, 10% 이상 8점
  let surge5d = false;
  let surgePoints = 0;
  if (input.pct5d >= 15) { techRisk += 12; surge5d = true; surgePoints = 12; }
  else if (input.pct5d >= 10) { techRisk += 8; surge5d = true; surgePoints = 8; }
  reasons.push({
    label: '5일 급등',
    points: surgePoints > 0 ? -surgePoints : 0,
    detail: `5일 등락률 +${Math.round(input.pct5d * 10) / 10}% (기준: 10% 이상)`,
    met: surge5d,
  });

  // 이격도 과열: 110% 이상이면 10점 감점
  const highDisparity = input.disparity20 >= 1.10;
  if (highDisparity) techRisk += 10;
  reasons.push({
    label: '이격도 과열',
    points: highDisparity ? -10 : 0,
    detail: `이격도 ${Math.round(input.disparity20 * 1000) / 10}% (기준: 110% 이상)`,
    met: highDisparity,
  });

  // 볼린저 밴드 상단 돌파: 8점 감점
  const bollingerBreak = input.bollingerUpper !== null && input.currentPrice > input.bollingerUpper;
  if (bollingerBreak) techRisk += 8;
  reasons.push({
    label: '볼린저 상단 돌파',
    points: bollingerBreak ? -8 : 0,
    detail: input.bollingerUpper !== null
      ? `현재가 ${fmt(input.currentPrice)} > 볼린저 상단 ${fmt(input.bollingerUpper)}`
      : `현재가 ${fmt(input.currentPrice)} (볼린저 상단 데이터 없음)`,
    met: bollingerBreak,
  });

  // 쌍봉(더블탑) 패턴: 5점 감점
  const doubleTopRisk = input.doubleTop;
  if (doubleTopRisk) techRisk += 5;
  reasons.push({
    label: '쌍봉 패턴',
    points: doubleTopRisk ? -5 : 0,
    detail: '쌍봉 패턴 감지',
    met: doubleTopRisk,
  });

  techRisk = Math.min(techRisk, 50);

  // --- 수급 이탈 (최대 50) ---

  const fSell = input.foreignNet !== null && input.foreignNet < 0;
  const iSell = input.institutionNet !== null && input.institutionNet < 0;
  let smartMoneyExit = false;

  // 동반 순매도 20점, 개별 매도는 외국인 10점 / 기관 8점 (중복 불가)
  if (fSell && iSell) {
    supplyRisk += 20; smartMoneyExit = true;
    reasons.push({
      label: '스마트머니 이탈',
      points: -20,
      detail: `외국인 ${fmt(input.foreignNet!)}주, 기관 ${fmt(input.institutionNet!)}주 (동반 매도)`,
      met: true,
    });
  } else if (fSell) {
    supplyRisk += 10;
    reasons.push({
      label: '스마트머니 이탈',
      points: -10,
      detail: `외국인 ${fmt(input.foreignNet!)}주 (단독 매도)`,
      met: true,
    });
  } else if (iSell) {
    supplyRisk += 8;
    reasons.push({
      label: '스마트머니 이탈',
      points: -8,
      detail: `기관 ${fmt(input.institutionNet!)}주 (단독 매도)`,
      met: true,
    });
  } else {
    reasons.push({
      label: '스마트머니 이탈',
      points: 0,
      detail: '외국인/기관 순매도 없음',
      met: false,
    });
  }

  // 연속 매도 streak: 외국인 3일 이상 연속 매도 시 8점, 기관 6점
  const foreignStreakMet = input.foreignStreak !== null && input.foreignStreak <= -3;
  if (foreignStreakMet) supplyRisk += 8;
  reasons.push({
    label: '외국인 연속매도',
    points: foreignStreakMet ? -8 : 0,
    detail: `외국인 ${Math.abs(input.foreignStreak ?? 0)}일 연속 매도`,
    met: foreignStreakMet,
  });

  const institutionStreakMet = input.institutionStreak !== null && input.institutionStreak <= -3;
  if (institutionStreakMet) supplyRisk += 6;
  reasons.push({
    label: '기관 연속매도',
    points: institutionStreakMet ? -6 : 0,
    detail: `기관 ${Math.abs(input.institutionStreak ?? 0)}일 연속 매도`,
    met: institutionStreakMet,
  });

  // 공매도 비율: 10% 이상이면 8점 감점
  const shortSellHigh = input.shortSellRatio !== null && input.shortSellRatio >= 10;
  if (shortSellHigh) supplyRisk += 8;
  reasons.push({
    label: '공매도 비율',
    points: shortSellHigh ? -8 : 0,
    detail: `공매도 ${Math.round((input.shortSellRatio ?? 0) * 10) / 10}% (기준: 10% 이상)`,
    met: shortSellHigh,
  });

  supplyRisk = Math.min(supplyRisk, 50);

  const rawScore = Math.min(techRisk + supplyRisk, 100);
  // 리스크 스코어는 이미 0~100 범위이므로 normalizedScore = rawScore
  const normalizedScore = rawScore;

  return {
    score: rawScore,
    rsi_overbought: rsiOverbought,
    surge_5d: surge5d,
    high_disparity: highDisparity,
    bollinger_upper_break: bollingerBreak,
    double_top_risk: doubleTopRisk,
    smart_money_exit: smartMoneyExit,
    short_sell_high: shortSellHigh,
    rawScore,
    normalizedScore,
    reasons,
  };
}
