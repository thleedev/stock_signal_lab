/**
 * 리스크 감점 모듈
 *
 * 기술적 과열(RSI, 급등, 이격도, 볼린저 상단 돌파, 쌍봉)과
 * 수급 이탈(외국인/기관 순매도, 연속 매도, 공매도 비율)을 종합하여
 * 0~100 범위의 리스크 점수를 산출한다.
 *
 * 오케스트레이터(Task 4)에서 최종 추천 점수 산정 시 감산 항목으로 사용.
 */

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

export interface RiskScoreResult {
  score: number;  // 0~100
  rsi_overbought: boolean;
  surge_5d: boolean;
  high_disparity: boolean;
  bollinger_upper_break: boolean;
  double_top_risk: boolean;
  smart_money_exit: boolean;
  short_sell_high: boolean;
}

export function calcRiskScore(input: RiskScoreInput): RiskScoreResult {
  let techRisk = 0;
  let supplyRisk = 0;

  // --- 기술적 위험 (최대 50) ---

  // RSI 과매수: 70 이상이면 15점 감점
  const rsiOverbought = input.rsi !== null && input.rsi >= 70;
  if (rsiOverbought) techRisk += 15;

  // 5일 급등: 15% 이상 12점, 10% 이상 8점
  let surge5d = false;
  if (input.pct5d >= 15) { techRisk += 12; surge5d = true; }
  else if (input.pct5d >= 10) { techRisk += 8; surge5d = true; }

  // 이격도 과열: 110% 이상이면 10점 감점
  const highDisparity = input.disparity20 >= 1.10;
  if (highDisparity) techRisk += 10;

  // 볼린저 밴드 상단 돌파: 8점 감점
  const bollingerBreak = input.bollingerUpper !== null && input.currentPrice > input.bollingerUpper;
  if (bollingerBreak) techRisk += 8;

  // 쌍봉(더블탑) 패턴: 5점 감점
  const doubleTopRisk = input.doubleTop;
  if (doubleTopRisk) techRisk += 5;

  techRisk = Math.min(techRisk, 50);

  // --- 수급 이탈 (최대 50) ---

  const fSell = input.foreignNet !== null && input.foreignNet < 0;
  const iSell = input.institutionNet !== null && input.institutionNet < 0;
  let smartMoneyExit = false;

  // 동반 순매도 20점, 개별 매도는 외국인 10점 / 기관 8점 (중복 불가)
  if (fSell && iSell) {
    supplyRisk += 20; smartMoneyExit = true;
  } else if (fSell) {
    supplyRisk += 10;
  } else if (iSell) {
    supplyRisk += 8;
  }

  // 연속 매도 streak: 외국인 3일 이상 연속 매도 시 8점, 기관 6점
  if (input.foreignStreak !== null && input.foreignStreak <= -3) supplyRisk += 8;
  if (input.institutionStreak !== null && input.institutionStreak <= -3) supplyRisk += 6;

  // 공매도 비율: 10% 이상이면 8점 감점
  const shortSellHigh = input.shortSellRatio !== null && input.shortSellRatio >= 10;
  if (shortSellHigh) supplyRisk += 8;

  supplyRisk = Math.min(supplyRisk, 50);

  const score = Math.min(techRisk + supplyRisk, 100);

  return {
    score,
    rsi_overbought: rsiOverbought,
    surge_5d: surge5d,
    high_disparity: highDisparity,
    bollinger_upper_break: bollingerBreak,
    double_top_risk: doubleTopRisk,
    smart_money_exit: smartMoneyExit,
    short_sell_high: shortSellHigh,
  };
}
