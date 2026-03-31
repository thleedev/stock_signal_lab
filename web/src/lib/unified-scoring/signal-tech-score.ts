// web/src/lib/unified-scoring/signal-tech-score.ts
import type { ScoreReason } from '@/types/score-reason';
import type { CategoryScore, ScoringInput } from './types';
import { isContrarianStyle } from './presets';

/**
 * 신호·기술 카테고리 (0~100)
 *
 * AI 신호 파트 (0~40): 신호 수, 소스 다양성, 갭, 최근성
 * 기술 트렌드 파트 (0~60): SMA정배열, RSI, MACD, 볼린저, 52주위치, 봉패턴 등
 */
export function calcSignalTechScore(input: ScoringInput, styleId: string): CategoryScore {
  const reasons: ScoreReason[] = [];
  let raw = 0;
  const maxRaw = 100;
  const contrarian = isContrarianStyle(styleId);

  // ── AI 신호 파트 (0~40) ──

  // 30일 BUY 신호 수 (0~20)
  const sigCount = input.signalCount30d ?? 0;
  if (sigCount >= 3) {
    raw += 20;
    reasons.push({ label: `30일 BUY ${sigCount}건`, points: 20, detail: `${sigCount}건 매수 신호`, met: true });
  } else if (sigCount === 2) {
    raw += 12;
    reasons.push({ label: `30일 BUY ${sigCount}건`, points: 12, detail: `${sigCount}건 매수 신호`, met: true });
  } else if (sigCount === 1) {
    raw += 6;
    reasons.push({ label: `30일 BUY ${sigCount}건`, points: 6, detail: `${sigCount}건 매수 신호`, met: true });
  } else {
    reasons.push({ label: '30일 BUY 신호 없음', points: 0, detail: '매수 신호 없음', met: false });
  }

  // 소스 다양성 (0~10)
  const sourceCount = input.signalSources.length;
  if (sourceCount >= 3) {
    raw += 10;
    reasons.push({ label: '멀티소스 (3+)', points: 10, detail: input.signalSources.join(', '), met: true });
  } else if (sourceCount === 2) {
    raw += 5;
    reasons.push({ label: '멀티소스 (2)', points: 5, detail: input.signalSources.join(', '), met: true });
  }

  // 현재가 vs 신호가 갭 (-5~+10)
  if (input.latestSignalPrice && input.currentPrice && input.currentPrice > 0) {
    const gap = ((input.currentPrice - input.latestSignalPrice) / input.latestSignalPrice) * 100;
    if (gap <= -5) {
      raw += 10;
      reasons.push({ label: '신호가 대비 저평가', points: 10, detail: `갭 ${gap.toFixed(1)}%`, met: true });
    } else if (gap <= 5) {
      raw += 5;
      reasons.push({ label: '신호가 근접', points: 5, detail: `갭 ${gap.toFixed(1)}%`, met: true });
    } else if (gap > 15) {
      raw -= 5;
      reasons.push({ label: '신호가 대비 과열', points: -5, detail: `갭 ${gap.toFixed(1)}%`, met: false });
    }
  }

  // 신호 최근성 (0~5)
  if (input.latestSignalDaysAgo !== null) {
    if (input.latestSignalDaysAgo <= 3) {
      raw += 5;
      reasons.push({ label: '최근 신호 (3일내)', points: 5, detail: `${input.latestSignalDaysAgo}일 전`, met: true });
    } else if (input.latestSignalDaysAgo <= 7) {
      raw += 3;
      reasons.push({ label: '최근 신호 (7일내)', points: 3, detail: `${input.latestSignalDaysAgo}일 전`, met: true });
    }
  }

  // ── 기술 트렌드 파트 (0~60) ──
  // daily_prices 기반 기술적 지표 계산
  const prices = input.dailyPrices;
  if (prices.length >= 20) {
    const closes = prices.map(p => p.close);
    const volumes = prices.map(p => p.volume);

    // SMA 계산
    const sma = (arr: number[], period: number) => {
      if (arr.length < period) return null;
      return arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    };
    const sma5 = sma(closes, 5);
    const sma20 = sma(closes, 20);
    const sma60 = prices.length >= 60 ? sma(closes, 60) : null;

    // SMA 정배열 (5>20>60): +12
    if (sma5 !== null && sma20 !== null && sma60 !== null && sma5 > sma20 && sma20 > sma60) {
      raw += 12;
      reasons.push({ label: '이평 정배열', points: 12, detail: `5일 ${sma5.toFixed(0)} > 20일 ${sma20.toFixed(0)} > 60일 ${sma60.toFixed(0)}`, met: true });
    } else if (sma5 !== null && sma20 !== null && sma60 !== null) {
      reasons.push({ label: '이평 정배열', points: 0, detail: '정배열 아님', met: false });
    }

    // RSI 계산 (14일)
    const rsi = calcRSI(closes, 14);
    if (rsi !== null) {
      if (contrarian && rsi < 30) {
        // 역발상: 과매도 가점
        raw += 15;
        reasons.push({ label: 'RSI 과매도 (역발상)', points: 15, detail: `RSI ${rsi.toFixed(1)}`, met: true });
      } else if (rsi >= 30 && rsi <= 50) {
        raw += 10;
        reasons.push({ label: 'RSI 매수구간', points: 10, detail: `RSI ${rsi.toFixed(1)}`, met: true });
      } else if (rsi > 50 && rsi <= 70) {
        raw += 5;
        reasons.push({ label: 'RSI 중립', points: 5, detail: `RSI ${rsi.toFixed(1)}`, met: true });
      } else {
        reasons.push({ label: 'RSI 매수구간', points: 0, detail: `RSI ${rsi?.toFixed(1) ?? 'N/A'}`, met: false });
      }
    }

    // MACD 골든크로스: 5일/20일 SMA 교차 (최근 3일 내) +10
    if (closes.length >= 23) {
      const macdGolden = checkMacdGoldenCross(closes);
      if (macdGolden) {
        raw += 10;
        reasons.push({ label: 'MACD 골든크로스', points: 10, detail: '최근 3일 내 교차', met: true });
      } else {
        reasons.push({ label: 'MACD 골든크로스', points: 0, detail: '교차 없음', met: false });
      }
    }

    // 볼린저 밴드 하단 근접: +8 (역발상: +12)
    if (closes.length >= 20) {
      const { lower } = calcBollingerBands(closes, 20);
      if (lower !== null && closes[0] <= lower * 1.02) {
        const pts = contrarian ? 12 : 8;
        raw += pts;
        reasons.push({ label: '볼린저 하단 근접', points: pts, detail: `종가 ${closes[0]} ≤ 하단 ${lower.toFixed(0)}`, met: true });
      }
    }

    // 52주 위치
    if (input.high52w && input.low52w && input.currentPrice) {
      const range = input.high52w - input.low52w;
      if (range > 0) {
        const position = ((input.currentPrice - input.low52w) / range) * 100;
        if (position <= 30) {
          raw += 8;
          reasons.push({ label: '52주 하위 30%', points: 8, detail: `위치 ${position.toFixed(0)}%`, met: true });
        } else if (position <= 50) {
          raw += 4;
          reasons.push({ label: '52주 하위 50%', points: 4, detail: `위치 ${position.toFixed(0)}%`, met: true });
        }
      }
    }

    // 이격도 (역발상 보정)
    if (sma20 !== null && input.currentPrice && sma20 > 0) {
      const disparity = ((input.currentPrice - sma20) / sma20) * 100;
      if (contrarian && disparity < -5) {
        raw += 10;
        reasons.push({ label: '이격도 과매도 (역발상)', points: 10, detail: `이격도 ${disparity.toFixed(1)}%`, met: true });
      } else if (disparity > -5 && disparity < 0) {
        raw += 5;
        reasons.push({ label: '이격도 반등', points: 5, detail: `이격도 ${disparity.toFixed(1)}%`, met: true });
      }
    }

    // 거래량 돌파
    const avgVol20 = sma(volumes, 20);
    if (avgVol20 && volumes[0] > avgVol20 * 2.5) {
      raw += 5;
      reasons.push({ label: '거래량 돌파', points: 5, detail: `${(volumes[0] / avgVol20).toFixed(1)}배`, met: true });
    }

    // 연속하락 반등 (역발상: +8)
    if (contrarian && closes.length >= 6) {
      let consecDown = 0;
      for (let i = 1; i < 6; i++) {
        if (closes[i] > closes[i - 1]) consecDown++;
        else break;
      }
      if (consecDown >= 5 && closes[0] > closes[1]) {
        raw += 8;
        reasons.push({ label: '연속하락 후 반등 (역발상)', points: 8, detail: `${consecDown}일 하락 후 반등`, met: true });
      }
    }
  }

  const normalized = Math.max(0, Math.min(raw, maxRaw));
  return { raw, maxRaw, normalized, reasons };
}

// ── 보조 함수 ──

function calcRSI(closes: number[], period: number): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 0; i < period; i++) {
    const diff = closes[i] - closes[i + 1]; // 최신이 앞
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function checkMacdGoldenCross(closes: number[]): boolean {
  const sma = (start: number, period: number) => {
    let sum = 0;
    for (let i = start; i < start + period; i++) sum += closes[i];
    return sum / period;
  };
  // 최근 3일 체크
  for (let d = 0; d < 3; d++) {
    if (closes.length < d + 21) break;
    const sma5Now = sma(d, 5);
    const sma20Now = sma(d, 20);
    const sma5Prev = sma(d + 1, 5);
    const sma20Prev = sma(d + 1, 20);
    if (sma5Now > sma20Now && sma5Prev <= sma20Prev) return true;
  }
  return false;
}

function calcBollingerBands(closes: number[], period: number): { upper: number | null; lower: number | null } {
  if (closes.length < period) return { upper: null, lower: null };
  const slice = closes.slice(0, period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
  const stddev = Math.sqrt(variance);
  return { upper: mean + 2 * stddev, lower: mean - 2 * stddev };
}
