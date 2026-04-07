/**
 * reversal-score.ts
 * 기술적 반전 신호 점수 계산 모듈 — contrarian 스타일 전용
 * 과매도 회복, 볼린저 하단 반등, 연속하락 후 양봉 등 바닥 반전 신호를 측정한다.
 * rawScore 범위: -20 ~ 65, normalizedScore: 0~100
 */
import { calcSMA, calcRSI } from '@/lib/ai-recommendation/technical-score';
import type { DailyPrice } from '@/lib/ai-recommendation/technical-score';
import type { ScoreReason, NormalizedScoreBase } from '@/types/score-reason';

export interface ReversalScoreResult extends NormalizedScoreBase {
  /** 데이터 부족 여부 (20일 미만) */
  data_insufficient: boolean;
  /** MA5 골든크로스 (MA5 > MA20 상향돌파, 최근 20일 내) */
  golden_cross: boolean;
  /** RSI 값 (null = 계산 불가) */
  rsi: number | null;
  /** 볼린저 하단 터치 후 양봉 반등 */
  bollinger_rebound: boolean;
  /** 52주 저점 +5~20% 반등 구간 */
  week52_rebound: boolean;
  /** 거래량 급증 (20일 평균 1.5배 이상) */
  volume_surge: boolean;
  /** 연속 하락(3일+) 후 첫 양봉 */
  consecutive_drop_rebound: boolean;
}

const MAX_RAW = 65;

export function calcReversalScore(
  prices: DailyPrice[],
  high52w: number | null,
  low52w: number | null,
): ReversalScoreResult {
  const empty: ReversalScoreResult = {
    rawScore: 0,
    normalizedScore: 0,
    reasons: [],
    data_insufficient: true,
    golden_cross: false,
    rsi: null,
    bollinger_rebound: false,
    week52_rebound: false,
    volume_surge: false,
    consecutive_drop_rebound: false,
  };

  if (prices.length < 20) return empty;

  const closes = prices.map((p) => p.close);
  const volumes = prices.map((p) => p.volume);
  const reasons: ScoreReason[] = [];
  let rawScore = 0;

  const ma5 = calcSMA(closes, 5);
  const ma20 = calcSMA(closes, 20);
  const lastMa5 = ma5[ma5.length - 1];
  const lastMa20 = ma20[ma20.length - 1];

  // ── 골든크로스: MA5가 MA20 상향 돌파 (최근 20일 내) ──
  let goldenCross = false;
  let goldenCrossScore = 0;
  let goldenCrossDetail = '미발생';

  const crossLookback = Math.min(20, ma5.length - 1, ma20.length - 1);
  for (let i = 1; i <= crossLookback; i++) {
    const cur5 = ma5[ma5.length - i];
    const cur20 = ma20[ma20.length - i];
    const pre5 = ma5.length - i - 1 >= 0 ? ma5[ma5.length - i - 1] : null;
    const pre20 = ma20.length - i - 1 >= 0 ? ma20[ma20.length - i - 1] : null;
    if (cur5 > cur20 && pre5 !== null && pre20 !== null && pre5 <= pre20) {
      goldenCross = true;
      goldenCrossScore = i <= 5 ? 25 : Math.round(25 * (1 - (i - 5) / 15));
      goldenCrossDetail = `MA5 > MA20 상향 돌파 (${i}일 전)`;
      break;
    }
  }

  if (!goldenCross && lastMa5 > lastMa20) {
    goldenCrossScore = 10;
    goldenCrossDetail = `MA5(${lastMa5.toFixed(0)}) > MA20(${lastMa20.toFixed(0)}) 상태 유지`;
  }

  rawScore += goldenCrossScore;
  if (goldenCrossScore > 0) {
    reasons.push({ label: 'MA5 골든크로스', points: Math.round((goldenCrossScore / MAX_RAW) * 100), detail: goldenCrossDetail, met: true });
  } else {
    reasons.push({ label: 'MA5 골든크로스', points: 0, detail: goldenCrossDetail, met: false });
  }
  goldenCross = goldenCross || lastMa5 > lastMa20;

  // ── RSI: 과매도 회복 구간 가점, 과매수 감점 ──
  const rsi = calcRSI(closes);
  let rsiScore = 0;
  let rsiDetail = rsi !== null ? `RSI ${rsi.toFixed(1)}` : 'RSI 계산 불가';
  if (rsi !== null) {
    if (rsi >= 25 && rsi <= 45) {
      rsiScore = 20;
      rsiDetail = `RSI ${rsi.toFixed(1)} (과매도 회복 구간)`;
    } else if (rsi > 45 && rsi <= 55) {
      rsiScore = 8;
      rsiDetail = `RSI ${rsi.toFixed(1)} (중립)`;
    } else if (rsi >= 70) {
      rsiScore = -15;
      rsiDetail = `RSI ${rsi.toFixed(1)} (과매수, 반전 신호 없음)`;
    }
  }
  rawScore += rsiScore;
  reasons.push({ label: 'RSI 과매도 회복', points: Math.round((rsiScore / MAX_RAW) * 100), detail: rsiDetail, met: rsiScore > 0 });

  // ── 52주 저점 +5~20% 반등 구간 ──
  const lastClose = closes[closes.length - 1];
  let week52Rebound = false;
  let week52ReboundScore = 0;
  if (low52w && low52w > 0) {
    const reboundPct = ((lastClose - low52w) / low52w) * 100;
    if (reboundPct >= 5 && reboundPct <= 20) {
      week52ReboundScore = 20;
      week52Rebound = true;
      reasons.push({ label: '52주 저점 반등', points: Math.round((20 / MAX_RAW) * 100), detail: `52주 저점 대비 +${reboundPct.toFixed(1)}% (진입 구간)`, met: true });
    } else {
      reasons.push({ label: '52주 저점 반등', points: 0, detail: `52주 저점 대비 ${reboundPct >= 0 ? '+' : ''}${reboundPct.toFixed(1)}%`, met: false });
    }
  } else {
    reasons.push({ label: '52주 저점 반등', points: 0, detail: '52주 데이터 없음', met: false });
  }
  rawScore += week52ReboundScore;

  // ── 거래량 급증 (당일 > 20일 평균 1.5배) ──
  const volSMA20 = volumes.length >= 20 ? volumes.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
  const lastVol = volumes[volumes.length - 1];
  const volumeSurge = volSMA20 !== null && lastVol >= volSMA20 * 1.5;
  if (volumeSurge) {
    rawScore += 15;
    reasons.push({ label: '거래량 급증', points: Math.round((15 / MAX_RAW) * 100), detail: `20일 평균 대비 ${(lastVol / volSMA20!).toFixed(1)}배`, met: true });
  } else {
    reasons.push({ label: '거래량 급증', points: 0, detail: volSMA20 !== null ? `20일 평균 대비 ${(lastVol / volSMA20).toFixed(1)}배` : '거래량 데이터 부족', met: false });
  }

  // ── 볼린저 하단 터치 후 양봉 반등 ──
  let bollingerRebound = false;
  if (prices.length >= 21) {
    const prevCloses = closes.slice(0, -1);
    const slice20 = prevCloses.slice(-20);
    const mean20 = slice20.reduce((a, b) => a + b, 0) / 20;
    const variance20 = slice20.reduce((a, b) => a + Math.pow(b - mean20, 2), 0) / 20;
    const bolLow = mean20 - 2 * Math.sqrt(variance20);
    const prevClose = closes[closes.length - 2];
    const curClose = closes[closes.length - 1];
    const curOpen = prices[prices.length - 1].open;
    if (prevClose <= bolLow && curClose > curOpen) {
      bollingerRebound = true;
      rawScore += 15;
      reasons.push({ label: '볼린저 하단 반등', points: Math.round((15 / MAX_RAW) * 100), detail: `볼린저 하단(${bolLow.toFixed(0)}) 터치 후 양봉`, met: true });
    } else {
      reasons.push({ label: '볼린저 하단 반등', points: 0, detail: '볼린저 하단 미터치', met: false });
    }
  } else {
    reasons.push({ label: '볼린저 하단 반등', points: 0, detail: '데이터 부족', met: false });
  }

  // ── 연속 하락(3일+) 후 첫 양봉 ──
  let consecutiveDropRebound = false;
  {
    const recentCloses = closes.slice(-5);
    let drops = 0;
    for (let i = 1; i < recentCloses.length - 1; i++) {
      if (recentCloses[i] < recentCloses[i - 1]) drops++;
    }
    const todayBullish = lastClose > prices[prices.length - 1].open;
    if (drops >= 3 && todayBullish) {
      consecutiveDropRebound = true;
      rawScore += 10;
      reasons.push({ label: '연속하락 반등', points: Math.round((10 / MAX_RAW) * 100), detail: `${drops}일 하락 후 양봉 반등`, met: true });
    } else {
      reasons.push({ label: '연속하락 반등', points: 0, detail: '연속하락 반등 패턴 없음', met: false });
    }
  }

  // ── MA 역배열 감점 ──
  const ma60 = prices.length >= 60 ? calcSMA(closes, 60) : [];
  const maReverse = ma60.length > 0 && lastMa5 < lastMa20 && lastMa20 < ma60[ma60.length - 1];
  if (maReverse) {
    rawScore -= 5;
    reasons.push({ label: 'MA 역배열', points: -Math.round((5 / MAX_RAW) * 100), detail: 'MA5 < MA20 < MA60 역배열', met: false });
  }

  // ── 5일 급락 감점 (-15%+) ──
  if (prices.length >= 6) {
    const price5dAgo = closes[closes.length - 6];
    const cum5d = ((lastClose - price5dAgo) / price5dAgo) * 100;
    if (cum5d <= -15) {
      rawScore -= 10;
      reasons.push({ label: '5일 급락', points: -Math.round((10 / MAX_RAW) * 100), detail: `5일 누적 ${cum5d.toFixed(1)}% 급락`, met: false });
    }
  }

  const clampedRaw = Math.max(-20, Math.min(rawScore, MAX_RAW));
  const normalizedScore = Math.round(Math.max(0, (clampedRaw / MAX_RAW) * 100) * 10) / 10;

  return {
    rawScore: clampedRaw,
    normalizedScore,
    reasons,
    data_insufficient: false,
    golden_cross: goldenCross,
    rsi,
    bollinger_rebound: bollingerRebound,
    week52_rebound: week52Rebound,
    volume_surge: volumeSurge,
    consecutive_drop_rebound: consecutiveDropRebound,
  };
}
