import type { ScoreReason, NormalizedScoreBase } from '@/types/score-reason';

export interface TechnicalScoreResult extends NormalizedScoreBase {
  score: number; // 0~65 (추세 점수, 순수 가점만 — 저점매수 강화 반영) — 하위 호환
  trend_days: number; // 종가 > SMA20 연속일수
  rsi: number | null;
  macd_cross: boolean;
  golden_cross: boolean;
  bollinger_bottom: boolean;
  phoenix_pattern: boolean;
  double_top: boolean;
  volume_surge: boolean;
  volume_overheat: boolean;     // v2: 거래량 5배 이상 과열
  weekly_trend_up: boolean;     // v2: 주봉 추세 상승
  week52_low_near: boolean;
  week52_high_near: boolean;
  ma_aligned: boolean;
  disparity_rebound: boolean;   // 이격도 반등 (20일선 저이격 + 양봉)
  volume_breakout: boolean;     // 거래량 바닥 탈출
  consecutive_drop_rebound: boolean; // 연속하락 후 반등
  data_insufficient: boolean;
}

export interface DailyPrice {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** 숫자를 한국어 형식으로 포맷 (반올림 후 천단위 구분) */
function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
}

/** 정규화된 points 계산: rawPoints / MAX_RAW * 100 */
function norm(rawPoints: number): number {
  return Math.round((rawPoints / 65) * 1000) / 10;
}

function calcEMA(closes: number[], period: number): number[] {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  const emas: number[] = [closes.slice(0, period).reduce((a, b) => a + b, 0) / period];
  for (let i = period; i < closes.length; i++) {
    emas.push(closes[i] * k + emas[emas.length - 1] * (1 - k));
  }
  return emas;
}

export function calcRSI(closes: number[]): number | null {
  if (closes.length < 15) return null;
  const recent = closes.slice(-15);
  let gains = 0,
    losses = 0;
  for (let i = 1; i < recent.length; i++) {
    const diff = recent[i] - recent[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

export function calcSMA(values: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / period);
  }
  return result;
}

function calcBollingerLower(closes: number[], period = 20, stdMultiplier = 2): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
  return mean - stdMultiplier * Math.sqrt(variance);
}

/** 볼린저 밴드 상단: mean + 2 * std */
export function calcBollingerUpper(closes: number[], period = 20, stdMultiplier = 2): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
  return mean + stdMultiplier * Math.sqrt(variance);
}

export function calcTechnicalScore(
  prices: DailyPrice[],
  high52w: number | null,
  low52w: number | null,
  marketCapTier: 'large' | 'mid' | 'small' = 'small',
): TechnicalScoreResult {
  const empty: TechnicalScoreResult = {
    score: 0,
    rawScore: 0,
    normalizedScore: 0,
    reasons: [],
    trend_days: 0,
    rsi: null,
    macd_cross: false,
    golden_cross: false,
    bollinger_bottom: false,
    phoenix_pattern: false,
    double_top: false,
    volume_surge: false,
    volume_overheat: false,
    weekly_trend_up: false,
    week52_low_near: false,
    week52_high_near: false,
    ma_aligned: false,
    disparity_rebound: false,
    volume_breakout: false,
    consecutive_drop_rebound: false,
    data_insufficient: true,
  };

  if (!prices || prices.length < 20) return empty;

  const closes = prices.map((p) => p.close);
  const volumes = prices.map((p) => (p.volume as number) ?? 0);
  const highs = prices.map((p) => p.high);
  const lows = prices.map((p) => p.low);
  const opens = prices.map((p) => p.open);
  const currentPrice = closes[closes.length - 1];

  let score = 0;
  const reasons: ScoreReason[] = [];

  // RSI (14일)
  const rsi = calcRSI(closes);
  const rsiInZone = rsi !== null && rsi >= 30 && rsi <= 50;
  if (rsiInZone) score += 4;
  if (rsi === null) {
    reasons.push({ label: 'RSI 매수구간', points: 0, detail: 'RSI 데이터 부족', met: false });
  } else if (rsiInZone) {
    reasons.push({ label: 'RSI 매수구간', points: norm(4), detail: `RSI ${Math.round(rsi)} (매수구간 30~50)`, met: true });
  } else {
    reasons.push({ label: 'RSI 매수구간', points: 0, detail: `RSI ${Math.round(rsi)} (구간 밖)`, met: false });
  }

  // 골든크로스: 5일선이 20일선 상향 돌파 (최근 3일 내)
  const sma5 = calcSMA(closes, 5);
  const sma20 = calcSMA(closes, 20);
  let goldenCross = false;
  if (sma5.length >= 4 && sma20.length >= 4) {
    const offset = sma5.length - sma20.length;
    for (let i = Math.max(1, sma20.length - 3); i < sma20.length; i++) {
      const i5 = i + offset;
      if (i5 >= 1 && i5 < sma5.length) {
        if (sma5[i5 - 1] <= sma20[i - 1] && sma5[i5] > sma20[i]) {
          goldenCross = true;
          break;
        }
      }
    }
  }
  if (goldenCross) score += 5;
  {
    const s5 = sma5.length > 0 ? sma5[sma5.length - 1] : 0;
    const s20 = sma20.length > 0 ? sma20[sma20.length - 1] : 0;
    if (goldenCross) {
      reasons.push({ label: '골든크로스', points: norm(5), detail: `5일선 ${fmt(s5)} > 20일선 ${fmt(s20)}`, met: true });
    } else {
      reasons.push({ label: '골든크로스', points: 0, detail: `5일선 ${fmt(s5)} ≤ 20일선 ${fmt(s20)}`, met: false });
    }
  }

  // 볼린저 밴드 하단 이탈 후 복귀 (최근 5일 내) — 저점매수 핵심 시그널
  // v2: 이격도 반등과 중복 시 max만 취함 (아래 이격도 섹션에서 처리)
  let bollingerBottom = false;
  if (closes.length >= 25) {
    for (let i = closes.length - 5; i < closes.length - 1; i++) {
      const lower = calcBollingerLower(closes.slice(0, i + 1));
      if (lower !== null && closes[i] < lower && closes[closes.length - 1] >= lower) {
        bollingerBottom = true;
        break;
      }
    }
  }
  const bollingerPoints = bollingerBottom ? 6 : 0;
  // 볼린저 점수는 이격도 반등과 중복 제거 후 아래에서 합산
  if (bollingerBottom) {
    reasons.push({ label: '볼린저 하단', points: norm(6), detail: '볼린저 하단 이탈 후 복귀', met: true });
  } else {
    reasons.push({ label: '볼린저 하단', points: 0, detail: '볼린저 하단 미이탈', met: false });
  }

  // MACD 골든크로스 (12/26/9) — 최근 3일 내 발생 여부 확인
  let macdCross = false;
  if (closes.length >= 35) {
    const ema12 = calcEMA(closes, 12);
    const ema26 = calcEMA(closes, 26);
    const emaOffset = ema12.length - ema26.length;
    const macdLine = ema26.map((v, i) => ema12[i + emaOffset] - v);
    const signalLine = calcEMA(macdLine, 9);
    if (macdLine.length >= 4 && signalLine.length >= 4) {
      const mOffset = macdLine.length - signalLine.length;
      for (let i = macdLine.length - 3; i < macdLine.length; i++) {
        const si = i - mOffset;
        if (si >= 1 && si < signalLine.length) {
          const prev = macdLine[i - 1] - signalLine[si - 1];
          const curr = macdLine[i] - signalLine[si];
          if (prev <= 0 && curr > 0) {
            macdCross = true;
            break;
          }
        }
      }
    }
  }
  if (macdCross) score += 4;
  if (macdCross) {
    reasons.push({ label: 'MACD 크로스', points: norm(4), detail: 'MACD > Signal (상향돌파)', met: true });
  } else {
    reasons.push({ label: 'MACD 크로스', points: 0, detail: 'MACD 크로스 미발생', met: false });
  }

  // 불새패턴: 최근 5거래일 중 3일 이상 음봉/보합, 마지막 2일 내 +3% 이상 장대 양봉
  let phoenixPattern = false;
  let phoenixPct = 0;
  if (closes.length >= 5 && opens.length >= 5) {
    const recentCloses = closes.slice(-5);
    const recentOpens = opens.slice(-5);
    const bearDays = recentCloses.slice(0, 3).filter((c, i) => c <= recentOpens[i]).length;
    for (let i = 3; i < 5; i++) {
      const body = recentCloses[i] - recentOpens[i];
      const hiIdx = closes.length - 5 + i;
      const totalRange = highs[hiIdx] - lows[hiIdx];
      const bodyRatio = totalRange > 0 ? body / totalRange : 0;
      const pctGain = recentOpens[i] > 0 ? (body / recentOpens[i]) * 100 : 0;
      if (bearDays >= 3 && body > 0 && pctGain >= 3 && bodyRatio >= 0.6) {
        phoenixPattern = true;
        phoenixPct = pctGain;
        break;
      }
    }
  }
  if (phoenixPattern) score += 3;
  if (phoenixPattern) {
    reasons.push({ label: '불새패턴', points: norm(3), detail: `음봉 후 +${Math.round(phoenixPct * 10) / 10}% 장대양봉`, met: true });
  } else {
    reasons.push({ label: '불새패턴', points: 0, detail: '불새패턴 미발생', met: false });
  }

  // 거래량 급증: 20일 평균 대비 — v2: 3단계 분리 + 과열 감지
  let volumeSurge = false;
  let volumeOverheat = false;
  let volumeSurgeRatio = 0;
  let todayVolumeVal = 0;
  let volumeRawPts = 0;
  if (volumes.length >= 21) {
    const avgVol = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
    todayVolumeVal = volumes[volumes.length - 1];
    volumeSurgeRatio = avgVol > 0 ? todayVolumeVal / avgVol : 0;
    if (volumeSurgeRatio >= 5) {
      // 과열 거래량: 리스크로 처리, trend에는 안전한 급증 점수만
      volumeRawPts = 4;
      volumeOverheat = true;
      volumeSurge = true;
    } else if (volumeSurgeRatio >= 3) {
      volumeRawPts = 8; // 강한 돌파 신호
      volumeSurge = true;
    } else if (volumeSurgeRatio >= 2) {
      volumeRawPts = 4; // 기존과 동일
      volumeSurge = true;
    } else if (volumeSurgeRatio >= 1.5) {
      volumeRawPts = 2; // 관심 증가
    }
  }
  score += volumeRawPts;
  if (volumeRawPts > 0) {
    const overHeatSuffix = volumeOverheat ? ' (과열 주의)' : '';
    reasons.push({ label: '거래량 급증', points: norm(volumeRawPts), detail: `거래량 ${fmt(todayVolumeVal)}주 (20일 평균 대비 ${Math.round(volumeSurgeRatio * 10) / 10}배)${overHeatSuffix}`, met: true });
  } else {
    reasons.push({ label: '거래량 급증', points: 0, detail: '거래량 평균 범위', met: false });
  }

  // 이동평균 정배열: 티어별 차등 (대형주는 기관 장기배분 신호로 유지, 소형주만 축소)
  let maAligned = false;
  let maAlignedRawPoints = 0;
  let maAlignedDetail = '';
  if (closes.length >= 60) {
    const sma60 = calcSMA(closes, 60);
    const latest5 = sma5[sma5.length - 1];
    const latest20 = sma20[sma20.length - 1];
    const latest60 = sma60[sma60.length - 1];
    if (latest5 > latest20 && latest20 > latest60) {
      maAligned = true;
      maAlignedRawPoints = marketCapTier === 'large' ? 10 : marketCapTier === 'mid' ? 8 : 7;
      score += maAlignedRawPoints;
      maAlignedDetail = `5일 ${fmt(latest5)} > 20일 ${fmt(latest20)} > 60일 ${fmt(latest60)}`;
    } else if (latest5 > latest20) {
      maAlignedRawPoints = marketCapTier === 'large' ? 5 : 4;
      score += maAlignedRawPoints;
      maAlignedDetail = `5일 ${fmt(latest5)} > 20일 ${fmt(latest20)} (부분 정배열)`;
    } else {
      maAlignedDetail = `5일 ${fmt(latest5)}, 20일 ${fmt(latest20)}, 60일 ${fmt(latest60)} (정배열 미달)`;
    }
  } else if (sma5.length >= 1 && sma20.length >= 1) {
    const latest5 = sma5[sma5.length - 1];
    const latest20 = sma20[sma20.length - 1];
    if (latest5 > latest20) {
      maAlignedRawPoints = marketCapTier === 'large' ? 5 : 4;
      score += maAlignedRawPoints;
      maAlignedDetail = `5일 ${fmt(latest5)} > 20일 ${fmt(latest20)} (60일 데이터 부족)`;
    } else {
      maAlignedDetail = `5일 ${fmt(latest5)} ≤ 20일 ${fmt(latest20)} (정배열 미달)`;
    }
  } else {
    maAlignedDetail = '이동평균 데이터 부족';
  }
  reasons.push({ label: '이동평균 정배열', points: norm(maAlignedRawPoints), detail: maAlignedDetail, met: maAlignedRawPoints > 0 });

  // 52주 위치 점수 (티어별 차등)
  let week52LowNear = false;
  let week52HighNear = false;
  let week52RawPoints = 0;
  let week52Detail = '';
  if (high52w && low52w && high52w > low52w && currentPrice > 0) {
    const range52 = high52w - low52w;
    const position52 = (currentPrice - low52w) / range52; // 0=저점, 1=고점
    const positionPct = Math.round(position52 * 1000) / 10;
    week52Detail = `52주 위치 ${positionPct}% (저점 ${fmt(low52w)} ~ 고점 ${fmt(high52w)})`;

    if (marketCapTier === 'large') {
      // 대형주: 고점 가점 축소, 저점 가점 강화 (저점매수 유도)
      if (position52 >= 0.95) { week52RawPoints = 5; week52HighNear = true; }  // 8→5
      else if (position52 >= 0.85) week52RawPoints = 4;                         // 6→4
      else if (position52 >= 0.70) week52RawPoints = 3;                         // 4→3
      else if (position52 >= 0.50) week52RawPoints = 2;
      else if (position52 <= 0.15) { week52RawPoints = 4; week52LowNear = true; }  // 1→4
      else if (position52 <= 0.30) { week52RawPoints = 3; week52LowNear = true; }  // 신규: 저점 구간 가점
    } else if (marketCapTier === 'mid') {
      // 중형주: 저점 쪽 가점 상향
      if (position52 >= 0.95) { week52RawPoints = 4; week52HighNear = true; }
      else if (position52 <= 0.15) { week52RawPoints = 6; week52LowNear = true; } // 7→6
      else if (position52 <= 0.30) { week52RawPoints = 4; week52LowNear = true; }
      else if (position52 >= 0.85) week52RawPoints = 3;
    } else {
      // 소형주: 저점 가점 + 거래량/양봉 콤보 강화 (떨어지는 칼날 방지)
      const todayBullish = closes[closes.length - 1] > opens[opens.length - 1];
      const pctGain = closes.length >= 2
        ? ((closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2]) * 100
        : 0;
      if (position52 <= 0.15) {
        week52LowNear = true;
        if (volumeSurge && todayBullish && pctGain >= 1.5) week52RawPoints = 12;
        else if (volumeSurge) week52RawPoints = 7;
        else week52RawPoints = 2; // 거래량 없으면 최소 (칼날 방지)
      } else if (position52 <= 0.30) {
        week52LowNear = true;
        if (volumeSurge && todayBullish && pctGain >= 1.5) week52RawPoints = 8;
        else if (volumeSurge) week52RawPoints = 5;
        else week52RawPoints = 2;
      }
    }
    score += week52RawPoints;
  } else if (low52w && low52w > 0 && currentPrice > 0) {
    // high52w 없는 경우 기존 로직
    const ratioLow = currentPrice / low52w;
    if (ratioLow >= 0.95 && ratioLow <= 1.05) {
      week52LowNear = true;
      week52RawPoints = 2;
      score += week52RawPoints;
    }
    week52Detail = `52주 저점 ${fmt(low52w)} 기준 (고점 데이터 없음)`;
  } else {
    week52Detail = '52주 데이터 없음';
  }
  reasons.push({ label: '52주 위치', points: norm(week52RawPoints), detail: week52Detail, met: week52RawPoints > 0 });

  // ── 단기 상승 임박 지표 ──

  // 이격도 반등: 현재가가 20일선 대비 저이격 + 오늘 양봉 — 저점매수 핵심 시그널
  // v2: 볼린저 하단과 중복 시 max만 취함
  let disparityRebound = false;
  let disparityRawPoints = 0;
  let disparityDetail = '';
  if (sma20.length >= 1 && closes.length >= 2) {
    const latestSma20 = sma20[sma20.length - 1];
    if (latestSma20 > 0) {
      const disparity = currentPrice / latestSma20;
      const disparityPct = Math.round(disparity * 1000) / 10;
      const todayBullish = closes[closes.length - 1] > opens[opens.length - 1];
      if (disparity >= 0.88 && disparity <= 0.95 && todayBullish) {
        disparityRebound = true;
        disparityRawPoints = 7;
        disparityDetail = `이격도 ${disparityPct}% + 양봉 (20일선 ${fmt(latestSma20)})`;
      } else if (disparity >= 0.92 && disparity <= 0.98 && todayBullish) {
        disparityRebound = true;
        disparityRawPoints = 5;
        disparityDetail = `이격도 ${disparityPct}% + 양봉 (20일선 ${fmt(latestSma20)})`;
      } else {
        disparityDetail = `이격도 ${disparityPct}% (반등 미발생, 20일선 ${fmt(latestSma20)})`;
      }
    }
  }
  // 볼린저 하단 + 이격도 반등 중복 제거: 두 조건 중 max만 취함
  const overlappingBonus = Math.max(bollingerPoints, disparityRawPoints);
  score += overlappingBonus;
  // 두 항목 모두 표시하되, 둘 다 met이면 낮은 쪽 points=0으로 표시
  if (bollingerBottom && disparityRebound) {
    // 둘 다 충족: 높은 쪽만 실제 점수 반영
    if (bollingerPoints < disparityRawPoints) {
      // 볼린저 reason을 points=0으로 재조정 (이미 push됨 → 마지막 항목 교체)
      const bIdx = reasons.findIndex(r => r.label === '볼린저 하단');
      if (bIdx >= 0) reasons[bIdx] = { ...reasons[bIdx], points: 0 };
    }
  }
  reasons.push({ label: '이격도 반등', points: norm(bollingerPoints >= disparityRawPoints && bollingerBottom && disparityRebound ? 0 : disparityRawPoints), detail: disparityDetail || '이격도 데이터 부족', met: disparityRebound });

  // 거래량 바닥 탈출: 최근 10일 평균 거래량이 20일 평균의 50% 이하 → 오늘 20일 평균 2배 이상
  let volumeBreakout = false;
  let volumeBreakoutRatio = 0;
  let avg10RecentVal = 0;
  if (volumes.length >= 21) {
    const avg20Vol = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
    if (avg20Vol > 0 && volumes.length >= 11) {
      avg10RecentVal = volumes.slice(-11, -1).reduce((a, b) => a + b, 0) / 10;
      const todayVol = volumes[volumes.length - 1];
      volumeBreakoutRatio = avg20Vol > 0 ? todayVol / avg20Vol : 0;
      if (avg10RecentVal <= avg20Vol * 0.5 && todayVol >= avg20Vol * 2) {
        volumeBreakout = true;
        score += 3;
      }
    }
  }
  if (volumeBreakout) {
    reasons.push({ label: '거래량 바닥 탈출', points: norm(3), detail: `10일 평균 → 오늘 (${Math.round(volumeBreakoutRatio * 10) / 10}배 탈출)`, met: true });
  } else {
    reasons.push({ label: '거래량 바닥 탈출', points: 0, detail: '거래량 바닥 탈출 미발생', met: false });
  }

  // 연속하락 후 반등: 3일 이상 연속 하락 후 오늘 +1.5% 이상 양봉 — 저점매수 핵심 시그널
  let consecutiveDropRebound = false;
  let consecutiveDropRawPoints = 0;
  let dropDays = 0;
  let dropReboundPct = 0;
  if (closes.length >= 5) {
    for (let i = closes.length - 2; i >= Math.max(1, closes.length - 6); i--) {
      if (closes[i] < closes[i - 1]) dropDays++;
      else break;
    }
    if (dropDays >= 3) {
      dropReboundPct = (closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2] * 100;
      const todayBullish = closes[closes.length - 1] > opens[opens.length - 1];
      if (dropReboundPct >= 1.5 && todayBullish) {
        consecutiveDropRebound = true;
        // 하락일수가 길수록 반등 가점 상향 (저점매수 강화)
        consecutiveDropRawPoints = dropDays >= 5 ? 8 : 6;  // 3→6~8
        score += consecutiveDropRawPoints;
      }
    }
  }
  if (consecutiveDropRebound) {
    reasons.push({ label: '연속하락 반등', points: norm(consecutiveDropRawPoints), detail: `${dropDays}일 연속 하락 후 +${Math.round(dropReboundPct * 10) / 10}% 반등`, met: true });
  } else {
    reasons.push({ label: '연속하락 반등', points: 0, detail: '연속하락 반등 미발생', met: false });
  }

  // 초기진입 보너스: 신호 발생 + 아직 덜 오름
  if (closes.length >= 6) {
    const pct5d = ((currentPrice - closes[closes.length - 6]) / closes[closes.length - 6]) * 100;
    if (pct5d >= 0 && pct5d < 3 && (goldenCross || macdCross || volumeSurge)) {
      // 신호 발생 + 아직 덜 오름: 초기 진입 기회 → 가산점
      score += 3;
    }
  }

  // 쌍봉 패턴: 최근 20거래일 내 두 고점이 ±2% 이내, 사이에 -5% 이상 하락,
  // 현재가가 두 번째 고점의 97%~103% 구간 (매도 경고 구간에서만 페널티)
  let doubleTop = false;
  if (highs.length >= 20) {
    const recentHighs = highs.slice(-20);
    const recentClosesFull = closes.slice(-20);
    outer: for (let i = 1; i < recentHighs.length - 2; i++) {
      for (let j = i + 2; j < recentHighs.length; j++) {
        const h1 = recentHighs[i],
          h2 = recentHighs[j];
        const priceDiff = Math.abs(h1 - h2) / Math.max(h1, h2);
        if (priceDiff <= 0.02) {
          const between = recentClosesFull.slice(i, j);
          const minBetween = Math.min(...between);
          const dropRatio = (Math.min(h1, h2) - minBetween) / Math.min(h1, h2);
          const nearSecondPeak = currentPrice >= h2 * 0.97 && currentPrice <= h2 * 1.03;
          if (dropRatio >= 0.05 && nearSecondPeak) {
            doubleTop = true;
            break outer;
          }
        }
      }
    }
  }
  // 쌍봉 판정 결과는 risk-score에서 참조하므로 boolean만 유지 (감점 제거)

  // 추세 지속일수: 종가 > SMA20인 연속일수를 역순 카운트
  let trendDays = 0;
  if (sma20.length >= 1) {
    // sma20 배열은 closes[19]부터 시작 (index 기준)
    const sma20Offset = closes.length - sma20.length;
    for (let i = closes.length - 1; i >= sma20Offset; i--) {
      const sma20Idx = i - sma20Offset;
      if (closes[i] > sma20[sma20Idx]) {
        trendDays++;
      } else {
        break;
      }
    }
  }
  // 추세 지속일수 점수: 대형주는 유지, 소형주만 축소
  let trendRawPoints = 0;
  let trendDetail = '';
  if (marketCapTier === 'large') {
    if (trendDays >= 15) { trendRawPoints = 9; score += 9; }       // 대형주: 장기추세 존중
    else if (trendDays >= 10) { trendRawPoints = 5; score += 5; }
    else if (trendDays >= 5) { trendRawPoints = 3; score += 3; }
  } else {
    if (trendDays >= 15) { trendRawPoints = 7; score += 7; }       // 중소형주: 축소
    else if (trendDays >= 10) { trendRawPoints = 4; score += 4; }
    else if (trendDays >= 5) { trendRawPoints = 2; score += 2; }
  }
  const latestSma20ForTrend = sma20.length > 0 ? sma20[sma20.length - 1] : 0;
  if (trendDays > 0) {
    trendDetail = `SMA20 위 ${trendDays}일 연속 (20일선 ${fmt(latestSma20ForTrend)})`;
  } else {
    trendDetail = `SMA20 위 0일 (20일선 ${fmt(latestSma20ForTrend)})`;
  }
  reasons.push({ label: '추세지속', points: norm(trendRawPoints), detail: trendDetail, met: trendRawPoints > 0 });

  // ── 주봉 추세 일치 보너스 (v2) ──
  // daily_prices 기반으로 주봉 계산 (별도 DB 조회 없음)
  function getWeeklyCloses(priceCloses: number[]): number[] {
    const result: number[] = [];
    for (let i = priceCloses.length - 1; i >= 4; i -= 5) {
      result.unshift(priceCloses[i]);
    }
    return result;
  }

  const weeklyCloses = getWeeklyCloses(closes);
  const weeklySma5 = calcSMA(weeklyCloses, 5);
  const weeklyTrendUp = weeklySma5.length > 0 &&
    weeklyCloses[weeklyCloses.length - 1] > weeklySma5[weeklySma5.length - 1];

  // 일봉 신호 + 주봉 추세 일치 보너스
  if (weeklyTrendUp && (goldenCross || volumeBreakout || bollingerBottom)) {
    score += 8;
    reasons.push({ label: '주봉 추세 일치', points: norm(8), detail: '일봉 신호 + 주봉 상승 추세 일치', met: true });
  } else if (!weeklyTrendUp && weeklyCloses.length >= 5) {
    // 주봉 하락 중 일봉 신호 → 역추세 패널티
    score -= 4;
    reasons.push({ label: '주봉 역추세', points: norm(-4), detail: '주봉 하락 추세 중 신호 (신뢰도 낮음)', met: false });
  }

  // ── 낙폭 과대 반등 보너스 (v2) ──
  const peak20d = closes.length >= 20 ? Math.max(...closes.slice(-20)) : 0;
  const drawdownPct = peak20d > 0 ? (peak20d - currentPrice) / peak20d * 100 : 0;
  let drawdownBonusRaw = 0;

  if (drawdownPct >= 20 && (goldenCross || volumeBreakout)) {
    drawdownBonusRaw = 10;
    score += 10;
  } else if (drawdownPct >= 10 && volumeSurge) {
    drawdownBonusRaw = 5;
    score += 5;
  } else if (drawdownPct >= 30 && !goldenCross && !bollingerBottom && !disparityRebound) {
    // 낙폭 과대 + 반등 신호 없음 = 떨어지는 칼날 패널티
    drawdownBonusRaw = -6;
    score -= 6;
  }
  if (drawdownPct >= 5 || drawdownBonusRaw !== 0) {
    reasons.push({
      label: '낙폭 반등',
      points: norm(drawdownBonusRaw),
      detail: `20일 고점 대비 낙폭 ${Math.round(drawdownPct * 10) / 10}%`,
      met: drawdownBonusRaw > 0,
    });
  }

  const rawScore = Math.max(0, Math.min(score, 65));

  return {
    score: rawScore,
    rawScore,
    normalizedScore: Math.round((rawScore / 65) * 1000) / 10,
    reasons,
    trend_days: trendDays,
    rsi,
    macd_cross: macdCross,
    golden_cross: goldenCross,
    bollinger_bottom: bollingerBottom,
    phoenix_pattern: phoenixPattern,
    double_top: doubleTop,
    volume_surge: volumeSurge,
    volume_overheat: volumeOverheat,
    weekly_trend_up: weeklyTrendUp,
    week52_low_near: week52LowNear,
    week52_high_near: week52HighNear ?? false,
    ma_aligned: maAligned,
    disparity_rebound: disparityRebound,
    volume_breakout: volumeBreakout,
    consecutive_drop_rebound: consecutiveDropRebound,
    data_insufficient: false,
  };
}
