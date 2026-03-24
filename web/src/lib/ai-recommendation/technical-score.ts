export interface TechnicalScoreResult {
  score: number; // -12~34
  rsi: number | null;
  macd_cross: boolean;
  golden_cross: boolean;
  bollinger_bottom: boolean;
  phoenix_pattern: boolean;
  double_top: boolean;
  volume_surge: boolean;
  week52_low_near: boolean;
  ma_aligned: boolean;
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

function calcEMA(closes: number[], period: number): number[] {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  const emas: number[] = [closes.slice(0, period).reduce((a, b) => a + b, 0) / period];
  for (let i = period; i < closes.length; i++) {
    emas.push(closes[i] * k + emas[emas.length - 1] * (1 - k));
  }
  return emas;
}

function calcRSI(closes: number[]): number | null {
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

function calcSMA(values: number[], period: number): number[] {
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

export function calcTechnicalScore(
  prices: DailyPrice[],
  high52w: number | null,
  low52w: number | null
): TechnicalScoreResult {
  const empty: TechnicalScoreResult = {
    score: 0,
    rsi: null,
    macd_cross: false,
    golden_cross: false,
    bollinger_bottom: false,
    phoenix_pattern: false,
    double_top: false,
    volume_surge: false,
    week52_low_near: false,
    ma_aligned: false,
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

  // RSI (14일)
  const rsi = calcRSI(closes);
  const rsiInZone = rsi !== null && rsi >= 30 && rsi <= 50;
  if (rsiInZone) score += 5;

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

  // 볼린저 밴드 하단 이탈 후 복귀 (최근 5일 내)
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
  if (bollingerBottom) score += 4;

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

  // 불새패턴: 최근 5거래일 중 3일 이상 음봉/보합, 마지막 2일 내 +3% 이상 장대 양봉
  let phoenixPattern = false;
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
        break;
      }
    }
  }
  if (phoenixPattern) score += 5;

  // 거래량 급증: 20일 평균 대비 2배 이상
  let volumeSurge = false;
  if (volumes.length >= 21) {
    const avgVol = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
    if (avgVol > 0 && volumes[volumes.length - 1] >= avgVol * 2) {
      volumeSurge = true;
    }
  }
  if (volumeSurge) score += 4;

  // 이동평균 정배열: 5일선 > 20일선 > 60일선 (확실한 상승 추세)
  let maAligned = false;
  if (closes.length >= 60) {
    const sma60 = calcSMA(closes, 60);
    const latest5 = sma5[sma5.length - 1];
    const latest20 = sma20[sma20.length - 1];
    const latest60 = sma60[sma60.length - 1];
    if (latest5 > latest20 && latest20 > latest60) {
      maAligned = true;
    }
  }
  if (maAligned) score += 4;

  // 52주 저점 근처 (±5%)
  let week52LowNear = false;
  if (low52w && low52w > 0 && currentPrice > 0) {
    const ratio = currentPrice / low52w;
    if (ratio >= 0.95 && ratio <= 1.05) week52LowNear = true;
  }
  if (week52LowNear) score += 3;

  // 애널리스트 관점: RSI + 5일 등락률 복합 타이밍 보정
  const isRsiOverbought = rsi !== null && rsi >= 70;
  if (closes.length >= 6) {
    const pct5d = ((currentPrice - closes[closes.length - 6]) / closes[closes.length - 6]) * 100;
    if (isRsiOverbought && pct5d >= 10) {
      // RSI 과매수 + 5일 +10%: 과열 확실 → 큰 감점
      score -= 6;
    } else if (pct5d >= 25) {
      // 극단적 급등 → 감점
      score -= 4;
    } else if (pct5d >= 0 && pct5d < 3 && (goldenCross || macdCross || volumeSurge)) {
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
  if (doubleTop) score -= 8;

  return {
    score: Math.max(-12, Math.min(score, 34)),
    rsi,
    macd_cross: macdCross,
    golden_cross: goldenCross,
    bollinger_bottom: bollingerBottom,
    phoenix_pattern: phoenixPattern,
    double_top: doubleTop,
    volume_surge: volumeSurge,
    week52_low_near: week52LowNear,
    ma_aligned: maAligned,
    data_insufficient: false,
  };
}
