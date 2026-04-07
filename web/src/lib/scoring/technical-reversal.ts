/**
 * technical-reversal.ts
 * 가격 모멘텀(추세 지속력) 점수 계산 모듈
 * MA 정배열, 수익률, 52주 고점 근접, 거래량 동반 상승 등을 측정한다.
 * rawScore 범위: -20 ~ 65, normalizedScore: 0~100
 */
import { calcSMA, calcRSI } from '@/lib/ai-recommendation/technical-score';
import type { DailyPrice } from '@/lib/ai-recommendation/technical-score';
import type { ScoreReason, NormalizedScoreBase } from '@/types/score-reason';

export interface TechnicalReversalResult extends NormalizedScoreBase {
  /** 데이터 부족 여부 (20일 미만) */
  data_insufficient: boolean;
  /** MA5 골든크로스 여부 (하위호환) */
  golden_cross: boolean;
  /** RSI 값 */
  rsi: number | null;
  /** MA 정배열 (MA5 > MA20 > MA60) */
  ma_aligned: boolean;
  /** 볼린저 하단 터치 후 양봉 반등 (하위호환, 항상 false) */
  bollinger_rebound: boolean;
  /** 52주 고점 75%+ 구간 */
  week52_high_zone: boolean;
  /** 52주 저점 반등 (하위호환, 항상 false) */
  week52_rebound: boolean;
  /** 거래량 동반 상승 (5일 평균 > 20일 평균 1.2배) */
  volume_surge: boolean;
  /** 연속 하락 후 양봉 (하위호환, 항상 false) */
  consecutive_drop_rebound: boolean;
}

const MAX_RAW = 65;

export function calcTechnicalReversal(
  prices: DailyPrice[],
  high52w: number | null,
  low52w: number | null,
): TechnicalReversalResult {
  const empty: TechnicalReversalResult = {
    rawScore: 0,
    normalizedScore: 0,
    reasons: [],
    data_insufficient: true,
    golden_cross: false,
    rsi: null,
    ma_aligned: false,
    bollinger_rebound: false,
    week52_high_zone: false,
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
  const ma60 = prices.length >= 60 ? calcSMA(closes, 60) : [];
  const lastMa5 = ma5[ma5.length - 1];
  const lastMa20 = ma20[ma20.length - 1];
  const lastMa60 = ma60.length > 0 ? ma60[ma60.length - 1] : null;
  const lastClose = closes[closes.length - 1];

  // ── MA 정배열: MA5 > MA20 > MA60 — 25점 ──
  const maAligned = lastMa60 !== null && lastMa5 > lastMa20 && lastMa20 > lastMa60;
  const maPartial = lastMa5 > lastMa20; // MA60 부족 시 부분 인정
  let maScore = 0;
  if (maAligned) {
    maScore = 25;
    reasons.push({ label: 'MA 정배열', points: Math.round((25 / MAX_RAW) * 100), detail: `MA5(${lastMa5.toFixed(0)}) > MA20(${lastMa20.toFixed(0)}) > MA60(${lastMa60!.toFixed(0)})`, met: true });
  } else if (maPartial) {
    maScore = 12;
    reasons.push({ label: 'MA 정배열', points: Math.round((12 / MAX_RAW) * 100), detail: `MA5(${lastMa5.toFixed(0)}) > MA20(${lastMa20.toFixed(0)}) (부분 정배열)`, met: true });
  } else {
    reasons.push({ label: 'MA 정배열', points: 0, detail: 'MA 정배열 미충족', met: false });
  }
  rawScore += maScore;

  // ── 20일 수익률 ──
  let ret20Score = 0;
  if (prices.length >= 20) {
    const ret20 = ((lastClose - closes[closes.length - 20]) / closes[closes.length - 20]) * 100;
    if (ret20 >= 10) {
      ret20Score = 15;
      reasons.push({ label: '20일 수익률', points: Math.round((15 / MAX_RAW) * 100), detail: `20일 수익률 +${ret20.toFixed(1)}%`, met: true });
    } else if (ret20 >= 5) {
      ret20Score = 8;
      reasons.push({ label: '20일 수익률', points: Math.round((8 / MAX_RAW) * 100), detail: `20일 수익률 +${ret20.toFixed(1)}%`, met: true });
    } else if (ret20 >= 0) {
      ret20Score = 3;
      reasons.push({ label: '20일 수익률', points: Math.round((3 / MAX_RAW) * 100), detail: `20일 수익률 +${ret20.toFixed(1)}%`, met: true });
    } else {
      reasons.push({ label: '20일 수익률', points: 0, detail: `20일 수익률 ${ret20.toFixed(1)}%`, met: false });
    }
  } else {
    reasons.push({ label: '20일 수익률', points: 0, detail: '데이터 부족', met: false });
  }
  rawScore += ret20Score;

  // ── 60일 수익률 ──
  let ret60Score = 0;
  if (prices.length >= 60) {
    const ret60 = ((lastClose - closes[closes.length - 60]) / closes[closes.length - 60]) * 100;
    if (ret60 >= 15) {
      ret60Score = 15;
      reasons.push({ label: '60일 수익률', points: Math.round((15 / MAX_RAW) * 100), detail: `60일 수익률 +${ret60.toFixed(1)}%`, met: true });
    } else if (ret60 >= 5) {
      ret60Score = 8;
      reasons.push({ label: '60일 수익률', points: Math.round((8 / MAX_RAW) * 100), detail: `60일 수익률 +${ret60.toFixed(1)}%`, met: true });
    } else if (ret60 >= 0) {
      ret60Score = 3;
      reasons.push({ label: '60일 수익률', points: Math.round((3 / MAX_RAW) * 100), detail: `60일 수익률 +${ret60.toFixed(1)}%`, met: true });
    } else {
      reasons.push({ label: '60일 수익률', points: 0, detail: `60일 수익률 ${ret60.toFixed(1)}%`, met: false });
    }
  } else {
    reasons.push({ label: '60일 수익률', points: 0, detail: '데이터 부족 (60일 미만)', met: false });
  }
  rawScore += ret60Score;

  // ── 52주 고점 75%+ 모멘텀 구간 — 15점 ──
  let week52HighZone = false;
  let week52Score = 0;
  if (high52w && low52w && high52w > low52w) {
    const position = (lastClose - low52w) / (high52w - low52w);
    if (position >= 0.9) {
      week52HighZone = true;
      week52Score = 15;
      reasons.push({ label: '52주 고점 구간', points: Math.round((15 / MAX_RAW) * 100), detail: `52주 범위 ${(position * 100).toFixed(0)}% (강한 모멘텀)`, met: true });
    } else if (position >= 0.75) {
      week52HighZone = true;
      week52Score = 8;
      reasons.push({ label: '52주 고점 구간', points: Math.round((8 / MAX_RAW) * 100), detail: `52주 범위 ${(position * 100).toFixed(0)}%`, met: true });
    } else {
      reasons.push({ label: '52주 고점 구간', points: 0, detail: `52주 범위 ${(position * 100).toFixed(0)}%`, met: false });
    }
  } else {
    reasons.push({ label: '52주 고점 구간', points: 0, detail: '52주 데이터 없음', met: false });
  }
  rawScore += week52Score;

  // ── 거래량 동반 상승: 5일 평균 > 20일 평균 1.2배 — 10점 ──
  const volSMA5 = volumes.length >= 5 ? volumes.slice(-5).reduce((a, b) => a + b, 0) / 5 : null;
  const volSMA20 = volumes.length >= 20 ? volumes.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
  const volumeSurge = volSMA5 !== null && volSMA20 !== null && volSMA5 >= volSMA20 * 1.2;
  if (volumeSurge) {
    rawScore += 10;
    reasons.push({ label: '거래량 동반', points: Math.round((10 / MAX_RAW) * 100), detail: `5일 평균 거래량이 20일 평균 대비 ${(volSMA5! / volSMA20!).toFixed(1)}배`, met: true });
  } else {
    reasons.push({ label: '거래량 동반', points: 0, detail: volSMA5 && volSMA20 ? `5일 평균 거래량 20일 대비 ${(volSMA5 / volSMA20).toFixed(1)}배` : '거래량 데이터 부족', met: false });
  }

  // ── 5일 수익률 양수 — 5점 ──
  if (prices.length >= 6) {
    const ret5 = ((lastClose - closes[closes.length - 6]) / closes[closes.length - 6]) * 100;
    if (ret5 > 0) {
      rawScore += 5;
      reasons.push({ label: '5일 수익률', points: Math.round((5 / MAX_RAW) * 100), detail: `5일 수익률 +${ret5.toFixed(1)}%`, met: true });
    } else {
      reasons.push({ label: '5일 수익률', points: 0, detail: `5일 수익률 ${ret5.toFixed(1)}%`, met: false });
    }
  }

  // ── RSI: 과매수 감점 (모멘텀은 RSI 70+ 허용하되 극단적 과열만 감점) ──
  const rsi = calcRSI(closes);
  let rsiScore = 0;
  let rsiDetail = rsi !== null ? `RSI ${rsi.toFixed(1)}` : 'RSI 계산 불가';
  if (rsi !== null && rsi >= 80) {
    rsiScore = -10;
    rsiDetail = `RSI ${rsi.toFixed(1)} (극단 과열 감점)`;
    rawScore += rsiScore;
    reasons.push({ label: 'RSI', points: Math.round((rsiScore / MAX_RAW) * 100), detail: rsiDetail, met: false });
  } else {
    reasons.push({ label: 'RSI', points: 0, detail: rsiDetail, met: true });
  }

  // ── MA 역배열 감점 ──
  const maReverse = lastMa60 !== null && lastMa5 < lastMa20 && lastMa20 < lastMa60;
  if (maReverse) {
    rawScore -= 10;
    reasons.push({ label: 'MA 역배열', points: -Math.round((10 / MAX_RAW) * 100), detail: 'MA5 < MA20 < MA60 역배열', met: false });
  }

  const clampedRaw = Math.max(-20, Math.min(rawScore, MAX_RAW));
  const normalizedScore = Math.round(Math.max(0, (clampedRaw / MAX_RAW) * 100) * 10) / 10;

  return {
    rawScore: clampedRaw,
    normalizedScore,
    reasons,
    data_insufficient: false,
    golden_cross: maPartial,
    rsi,
    ma_aligned: maAligned,
    bollinger_rebound: false,
    week52_high_zone: week52HighZone,
    week52_rebound: false,
    volume_surge: volumeSurge,
    consecutive_drop_rebound: false,
  };
}
