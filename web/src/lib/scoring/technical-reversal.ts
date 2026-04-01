/**
 * technical-reversal.ts
 * MA/RSI/볼린저 밴드 기반 기술적 반전 점수 계산 모듈
 * rawScore 범위: -20 ~ 65, normalizedScore: 0~100
 */
import { calcSMA, calcRSI } from '@/lib/ai-recommendation/technical-score';
import type { DailyPrice } from '@/lib/ai-recommendation/technical-score';
import type { ScoreReason, NormalizedScoreBase } from '@/types/score-reason';

export interface TechnicalReversalResult extends NormalizedScoreBase {
  /** 데이터 부족 여부 (20일 미만) */
  data_insufficient: boolean;
  /** MA5 골든크로스 (MA5 > MA20 상향돌파, 최근 5일 내) */
  golden_cross: boolean;
  /** RSI 값 (null = 계산 불가) */
  rsi: number | null;
  /** MA 정배열 (MA5 > MA20 > MA60) */
  ma_aligned: boolean;
  /** 볼린저 하단 터치 후 양봉 반등 */
  bollinger_rebound: boolean;
  /** 52주 저점 +5~20% 반등 구간 */
  week52_rebound: boolean;
  /** 52주 고점 90%+ 모멘텀 구간 */
  week52_high_zone: boolean;
  /** 거래량 급증 (20일 평균 1.5배 이상) */
  volume_surge: boolean;
  /** 연속 하락(2일+) 후 첫 양봉 */
  consecutive_drop_rebound: boolean;
}

/** rawScore 최대값 — 정규화 기준 */
const MAX_RAW = 65;

/**
 * 기술적 반전 점수를 계산한다.
 *
 * @param prices - 일별 가격 배열 (오래된 순)
 * @param high52w - 52주 고가 (없으면 null)
 * @param low52w - 52주 저가 (없으면 null)
 * @returns TechnicalReversalResult
 */
export function calcTechnicalReversal(
  prices: DailyPrice[],
  high52w: number | null,
  low52w: number | null,
): TechnicalReversalResult {
  // 데이터 부족 시 빈 결과 반환
  const empty: TechnicalReversalResult = {
    rawScore: 0,
    normalizedScore: 0,
    reasons: [],
    data_insufficient: true,
    golden_cross: false,
    rsi: null,
    ma_aligned: false,
    bollinger_rebound: false,
    week52_rebound: false,
    week52_high_zone: false,
    volume_surge: false,
    consecutive_drop_rebound: false,
  };

  if (prices.length < 20) return empty;

  const closes = prices.map((p) => p.close);
  const volumes = prices.map((p) => p.volume);
  const reasons: ScoreReason[] = [];
  let rawScore = 0;

  // ── MA5, MA20, MA60 계산 ──
  const ma5 = calcSMA(closes, 5);
  const ma20 = calcSMA(closes, 20);
  const ma60 = prices.length >= 60 ? calcSMA(closes, 60) : [];

  const lastMa5 = ma5[ma5.length - 1];
  const lastMa20 = ma20[ma20.length - 1];

  // ── 골든크로스: MA5가 MA20 상향 돌파 (최근 20일 내) 또는 현재 MA5 > MA20 ──
  // 골든크로스 발생 시 25점, 단순 MA5 > MA20 상태면 10점 (추세 유지 가점)
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
      // 최근 5일 내 발생 시 만점, 그 이후는 감쇠
      goldenCrossScore = i <= 5 ? 25 : Math.round(25 * (1 - (i - 5) / 15));
      goldenCrossDetail = `MA5 > MA20 상향 돌파 (${i}일 전)`;
      break;
    }
  }

  // 골든크로스 미발생이지만 MA5 > MA20 상태 유지 시 소폭 가산
  if (!goldenCross && lastMa5 > lastMa20) {
    goldenCrossScore = 10;
    goldenCrossDetail = `MA5(${lastMa5.toFixed(0)}) > MA20(${lastMa20.toFixed(0)}) 상태 유지`;
  }

  rawScore += goldenCrossScore;
  if (goldenCrossScore > 0) {
    reasons.push({
      label: 'MA5 골든크로스',
      points: Math.round((goldenCrossScore / MAX_RAW) * 100),
      detail: goldenCrossDetail,
      met: true,
    });
  } else {
    reasons.push({ label: 'MA5 골든크로스', points: 0, detail: goldenCrossDetail, met: false });
  }
  goldenCross = goldenCross || lastMa5 > lastMa20;

  // ── RSI 점수: 과매도 회복 구간 가점, 과매수 구간은 별도 점수 없음 ──
  // 주의: 기술적 반전 모듈은 반전 초기 신호 탐지가 목적이므로 과매수 감점은 적용하지 않음
  const rsi = calcRSI(closes);
  let rsiScore = 0;
  let rsiDetail = rsi !== null ? `RSI ${rsi.toFixed(1)}` : 'RSI 계산 불가';
  if (rsi !== null) {
    if (rsi >= 25 && rsi <= 45) {
      // 과매도 회복 구간 — 최적 반전 진입 신호
      rsiScore = 20;
      rsiDetail = `RSI ${rsi.toFixed(1)} (과매도 회복 구간)`;
    } else if (rsi > 45 && rsi <= 55) {
      // 중립 구간 — 소폭 가산
      rsiScore = 8;
      rsiDetail = `RSI ${rsi.toFixed(1)} (중립)`;
    } else if (rsi > 55 && rsi < 70) {
      // 상승 모멘텀 구간 — 중립
      rsiScore = 0;
      rsiDetail = `RSI ${rsi.toFixed(1)} (상승 모멘텀)`;
    } else if (rsi >= 70) {
      // 과매수 구간 — 기술적 반전 관점에서는 가점 없음 (다른 신호로 판단)
      rsiScore = 0;
      rsiDetail = `RSI ${rsi.toFixed(1)} (과매수 구간, 추가 확인 필요)`;
    }
  }
  rawScore += rsiScore;
  reasons.push({
    label: 'RSI',
    points: Math.round((rsiScore / MAX_RAW) * 100),
    detail: rsiDetail,
    met: rsiScore > 0,
  });

  // ── 52주 저점 +5~20% 반등 구간 ──
  const lastClose = closes[closes.length - 1];
  let week52Rebound = false;
  let week52ReboundScore = 0;
  if (low52w && low52w > 0) {
    const reboundPct = ((lastClose - low52w) / low52w) * 100;
    if (reboundPct >= 5 && reboundPct <= 20) {
      week52ReboundScore = 20;
      week52Rebound = true;
      reasons.push({
        label: '52주 저점 반등',
        points: Math.round((20 / MAX_RAW) * 100),
        detail: `52주 저점 대비 +${reboundPct.toFixed(1)}% (진입 구간)`,
        met: true,
      });
    } else {
      reasons.push({
        label: '52주 저점 반등',
        points: 0,
        detail: `52주 저점 대비 ${reboundPct >= 0 ? '+' : ''}${reboundPct.toFixed(1)}%`,
        met: false,
      });
    }
  } else {
    reasons.push({ label: '52주 저점 반등', points: 0, detail: '52주 데이터 없음', met: false });
  }
  rawScore += week52ReboundScore;

  // ── 거래량 급증 (당일 > 20일 평균 1.5배) ──
  const volSMA20 =
    volumes.length >= 20 ? volumes.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
  const lastVol = volumes[volumes.length - 1];
  const volumeSurge = volSMA20 !== null && lastVol >= volSMA20 * 1.5;
  if (volumeSurge) {
    rawScore += 15;
    const ratio = (lastVol / volSMA20!).toFixed(1);
    reasons.push({
      label: '거래량 급증',
      points: Math.round((15 / MAX_RAW) * 100),
      detail: `20일 평균 대비 ${ratio}배`,
      met: true,
    });
  } else {
    reasons.push({
      label: '거래량 급증',
      points: 0,
      detail:
        volSMA20 !== null
          ? `20일 평균 대비 ${(lastVol / volSMA20).toFixed(1)}배`
          : '거래량 데이터 부족',
      met: false,
    });
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
      reasons.push({
        label: '볼린저 하단 반등',
        points: Math.round((15 / MAX_RAW) * 100),
        detail: `볼린저 하단(${bolLow.toFixed(0)}) 터치 후 양봉`,
        met: true,
      });
    } else {
      reasons.push({
        label: '볼린저 하단 반등',
        points: 0,
        detail: '볼린저 하단 미터치',
        met: false,
      });
    }
  } else {
    reasons.push({ label: '볼린저 하단 반등', points: 0, detail: '데이터 부족', met: false });
  }

  // ── MA5 > MA20 > MA60 정배열 ──
  const maAligned =
    ma60.length > 0 && lastMa5 > lastMa20 && lastMa20 > ma60[ma60.length - 1];
  if (maAligned) {
    rawScore += 10;
    reasons.push({
      label: 'MA 정배열',
      points: Math.round((10 / MAX_RAW) * 100),
      detail: 'MA5 > MA20 > MA60',
      met: true,
    });
  } else {
    reasons.push({ label: 'MA 정배열', points: 0, detail: '정배열 미충족', met: false });
  }

  // ── 52주 고점 90%+ 모멘텀 구간 ──
  let week52HighZone = false;
  if (high52w && low52w && high52w > low52w) {
    const position = (lastClose - low52w) / (high52w - low52w);
    if (position >= 0.9) {
      week52HighZone = true;
      rawScore += 10;
      reasons.push({
        label: '52주 고점 구간',
        points: Math.round((10 / MAX_RAW) * 100),
        detail: `52주 범위 ${(position * 100).toFixed(0)}% (강한 모멘텀)`,
        met: true,
      });
    } else {
      reasons.push({
        label: '52주 고점 구간',
        points: 0,
        detail: `52주 범위 ${(position * 100).toFixed(0)}%`,
        met: false,
      });
    }
  } else {
    reasons.push({ label: '52주 고점 구간', points: 0, detail: '52주 데이터 없음', met: false });
  }

  // ── 연속 하락 후 첫 양봉 (직전 2일+ 하락, 당일 양봉) ──
  let consecutiveDropRebound = false;
  if (prices.length >= 5) {
    const recentCloses = closes.slice(-4);
    let drops = 0;
    for (let i = 1; i < recentCloses.length - 1; i++) {
      if (recentCloses[i] < recentCloses[i - 1]) drops++;
    }
    const todayBullish = lastClose > prices[prices.length - 1].open;
    if (drops >= 2 && todayBullish) {
      consecutiveDropRebound = true;
      rawScore += 10;
      reasons.push({
        label: '연속하락 반등',
        points: Math.round((10 / MAX_RAW) * 100),
        detail: `${drops}일 하락 후 양봉 반등`,
        met: true,
      });
    } else {
      reasons.push({
        label: '연속하락 반등',
        points: 0,
        detail: '연속하락 반등 패턴 없음',
        met: false,
      });
    }
  } else {
    reasons.push({ label: '연속하락 반등', points: 0, detail: '데이터 부족', met: false });
  }

  // ── MA 역배열 감점 ──
  const maReverse =
    ma60.length > 0 && lastMa5 < lastMa20 && lastMa20 < ma60[ma60.length - 1];
  if (maReverse) {
    rawScore -= 5;
    reasons.push({
      label: 'MA 역배열',
      points: -Math.round((5 / MAX_RAW) * 100),
      detail: 'MA5 < MA20 < MA60 역배열',
      met: false,
    });
  }

  // ── 5일 급락 감점 (-15%+) ──
  if (prices.length >= 6) {
    const price5dAgo = closes[closes.length - 6];
    const cum5d = ((lastClose - price5dAgo) / price5dAgo) * 100;
    if (cum5d <= -15) {
      rawScore -= 10;
      reasons.push({
        label: '5일 급락',
        points: -Math.round((10 / MAX_RAW) * 100),
        detail: `5일 누적 ${cum5d.toFixed(1)}% 급락`,
        met: false,
      });
    }
  }

  // rawScore를 [-20, MAX_RAW] 범위로 클램핑 후 0~100으로 정규화
  const clampedRaw = Math.max(-20, Math.min(rawScore, MAX_RAW));
  const normalizedScore = Math.round(Math.max(0, (clampedRaw / MAX_RAW) * 100) * 10) / 10;

  return {
    rawScore: clampedRaw,
    normalizedScore,
    reasons,
    data_insufficient: false,
    golden_cross: goldenCross,
    rsi,
    ma_aligned: maAligned,
    bollinger_rebound: bollingerRebound,
    week52_rebound: week52Rebound,
    week52_high_zone: week52HighZone,
    volume_surge: volumeSurge,
    consecutive_drop_rebound: consecutiveDropRebound,
  };
}
