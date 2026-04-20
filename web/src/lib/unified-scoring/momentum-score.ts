// web/src/lib/unified-scoring/momentum-score.ts
import type { ScoreReason } from '@/types/score-reason';
import type { CategoryScore, ScoringInput } from './types';
import { isContrarianStyle } from './presets';

/**
 * 모멘텀 카테고리 (0~100)
 *
 * 일반: 일간 등락률, 3일 누적, 거래량비율, 종가위치, 캔들패턴, 박스돌파, 섹터강도 (최대 100)
 * 역발상: 망치형 캔들, 낙폭 감소/반전, 52주 저점 근접 신호 추가
 */
export function calcMomentumScore(input: ScoringInput, styleId = 'balanced'): CategoryScore {
  const reasons: ScoreReason[] = [];
  let raw = 0;
  const maxRaw = 100;
  const contrarian = isContrarianStyle(styleId);

  // 일간 등락률 (0~15)
  if (input.priceChangePct !== null) {
    const pct = input.priceChangePct;
    if (pct >= 3) {
      raw += 15;
      reasons.push({ label: '일간 상승', points: 15, detail: `${pct.toFixed(1)}%`, met: true });
    } else if (pct >= 1) {
      raw += 10;
      reasons.push({ label: '일간 상승', points: 10, detail: `${pct.toFixed(1)}%`, met: true });
    } else if (pct >= 0) {
      raw += 5;
      reasons.push({ label: '일간 상승', points: 5, detail: `${pct.toFixed(1)}%`, met: false });
    } else {
      reasons.push({ label: '일간 상승', points: 0, detail: `${pct.toFixed(1)}%`, met: false });
    }
  }

  // 3일 누적 수익률 (0~12)
  if (input.cumReturn3d !== null) {
    if (input.cumReturn3d > 5) {
      raw += 12;
      reasons.push({ label: '3일 강세', points: 12, detail: `${input.cumReturn3d.toFixed(1)}%`, met: true });
    } else if (input.cumReturn3d > 2) {
      raw += 8;
      reasons.push({ label: '3일 상승', points: 8, detail: `${input.cumReturn3d.toFixed(1)}%`, met: true });
    }
  }

  // 거래량 비율 (0~15)
  if (input.volumeRatio !== null) {
    if (input.volumeRatio > 3) {
      raw += 15;
      reasons.push({ label: '거래량 폭발', points: 15, detail: `${input.volumeRatio.toFixed(1)}배`, met: true });
    } else if (input.volumeRatio > 2) {
      raw += 10;
      reasons.push({ label: '거래량 급증', points: 10, detail: `${input.volumeRatio.toFixed(1)}배`, met: true });
    } else if (input.volumeRatio > 1.5) {
      raw += 7;
      reasons.push({ label: '거래량 증가', points: 7, detail: `${input.volumeRatio.toFixed(1)}배`, met: true });
    }
  }

  // 종가 위치 (0~10)
  if (input.closePosition !== null) {
    if (input.closePosition >= 0.7) {
      raw += 10;
      reasons.push({ label: '종가 상위', points: 10, detail: `위치 ${(input.closePosition * 100).toFixed(0)}%`, met: true });
    } else if (input.closePosition >= 0.5) {
      raw += 5;
      reasons.push({ label: '종가 중상위', points: 5, detail: `위치 ${(input.closePosition * 100).toFixed(0)}%`, met: true });
    }
  }

  // 캔들 패턴 (양봉 + 갭업) (0~10)
  const prices = input.dailyPrices;
  if (prices.length >= 1) {
    const today = prices[0];
    const isBullish = today.close > today.open;
    if (isBullish) raw += 5;
    reasons.push({ label: '양봉', points: isBullish ? 5 : 0, detail: `시${today.open} → 종${today.close}`, met: isBullish });
  }
  if (input.gapPct !== null && input.gapPct > 1) {
    raw += 5;
    reasons.push({ label: '갭업', points: 5, detail: `${input.gapPct.toFixed(1)}%`, met: true });
  }

  // 박스 돌파 (0~10)
  if (prices.length >= 20) {
    const recent20High = Math.max(...prices.slice(1, 21).map(p => p.high));
    const isBreakout = prices[0].close > recent20High;
    if (isBreakout) raw += 10;
    reasons.push({ label: '박스 돌파', points: isBreakout ? 10 : 0, detail: `종가 ${prices[0].close} / 20일고가 ${recent20High}`, met: isBreakout });
  }

  // 섹터 상대 강도 (0~10)
  if (input.sectorRank !== null && input.sectorTotal !== null && input.sectorTotal > 0) {
    const pctRank = input.sectorRank / input.sectorTotal;
    if (pctRank <= 0.2) {
      raw += 10;
      reasons.push({ label: '섹터 강세 (상위 20%)', points: 10, detail: `${input.sectorRank}/${input.sectorTotal}위`, met: true });
    } else if (pctRank <= 0.5) {
      raw += 5;
      reasons.push({ label: '섹터 중상위', points: 5, detail: `${input.sectorRank}/${input.sectorTotal}위`, met: true });
    }
  }

  // 섹터 초과수익 (0~8)
  if (input.sectorAvgChangePct !== null && input.priceChangePct !== null) {
    const excess = input.priceChangePct - input.sectorAvgChangePct;
    if (excess > 2) {
      raw += 8;
      reasons.push({ label: '섹터 초과수익', points: 8, detail: `+${excess.toFixed(1)}%p`, met: true });
    }
  }

  // 거래량·가격 동시 급등 시너지 (0~10)
  // 거래량 폭증과 가격 급등이 동시에 발생 = 매집 후 폭발 패턴
  if (input.volumeRatio !== null && input.priceChangePct !== null) {
    if (input.volumeRatio > 2.0 && input.priceChangePct >= 3) {
      raw += 10;
      reasons.push({ label: '거래량·가격 동시 급등', points: 10, detail: `거래량 ${input.volumeRatio.toFixed(1)}배 × 등락 +${input.priceChangePct.toFixed(1)}%`, met: true });
    }
  }

  // 연속 상승 (0~5): 2일 연속 양봉 (실제 최대 합계 90→100 보정)
  if (prices.length >= 3) {
    const isConsecutiveUp = prices[0].close > prices[1].close && prices[1].close > prices[2].close;
    if (isConsecutiveUp) {
      raw += 5;
      reasons.push({ label: '연속 상승', points: 5, detail: '2일 연속 종가 상승', met: true });
    }
  }

  // 중기 모멘텀 20일 (0~5): 20일 수익률 > 10%
  if (prices.length >= 20) {
    const return20d = ((prices[0].close - prices[19].close) / prices[19].close) * 100;
    if (return20d > 10) {
      raw += 5;
      reasons.push({ label: '중기 모멘텀', points: 5, detail: `20일 ${return20d.toFixed(1)}%`, met: true });
    }
  }

  // ── 역발상 전용 신호 (0~34) ──
  // 역발상은 하락 추세에서 반전 신호를 포착하는 것이 핵심
  // 일반 상승 신호들이 0점에 가깝지만, 아래 신호들로 변별력 확보
  if (contrarian) {
    // 망치형 캔들 (0~12): 아래꼬리가 몸통의 2배 이상 + 전체 범위의 40% 이상
    // 하락 추세에서 매도 압력 소진을 나타내는 강한 반전 신호
    if (prices.length >= 1) {
      const c = prices[0];
      const body = Math.abs(c.close - c.open);
      const lowerShadow = Math.min(c.open, c.close) - c.low;
      const range = c.high - c.low;
      if (range > 0 && lowerShadow >= body * 2 && lowerShadow >= range * 0.4) {
        raw += 12;
        reasons.push({ label: '망치형 캔들 (역발상)', points: 12, detail: `아래꼬리 ${lowerShadow.toFixed(0)} / 몸통 ${body.toFixed(0)}`, met: true });
      }
    }

    // 낙폭 감소 / 반전 첫날 (0~10): 어제보다 오늘 낙폭이 줄거나 반등
    // 매도세 약화 = 하락 추세 종료 가능성
    if (prices.length >= 3) {
      const d0 = prices[0].close - prices[1].close; // 오늘 가격 변화
      const d1 = prices[1].close - prices[2].close; // 어제 가격 변화
      if (d1 < 0 && d0 > d1) {
        // 어제 하락했는데 오늘 덜 하락하거나 반등
        const pts = d0 >= 0 ? 10 : 6; // 반등이면 10점, 낙폭 감소만이면 6점
        raw += pts;
        reasons.push({ label: '낙폭 감소 (역발상)', points: pts, detail: `어제 ${d1.toFixed(0)} → 오늘 ${d0.toFixed(0)}원`, met: true });
      }
    }

    // 52주 저점 근접 (0~12): 저점 대비 5% / 15% 이내
    // 강한 지지 구간에서 매수 = 리스크 대비 기대수익 좋음
    if (input.low52w && input.currentPrice && input.low52w > 0) {
      const distPct = ((input.currentPrice - input.low52w) / input.low52w) * 100;
      if (distPct <= 5) {
        raw += 12;
        reasons.push({ label: '52주 저점 근접 (역발상)', points: 12, detail: `저점 대비 +${distPct.toFixed(1)}%`, met: true });
      } else if (distPct <= 15) {
        raw += 6;
        reasons.push({ label: '52주 저점 인근 (역발상)', points: 6, detail: `저점 대비 +${distPct.toFixed(1)}%`, met: true });
      }
    }
  }

  const normalized = Math.max(0, Math.min(raw, maxRaw));
  return { raw, maxRaw, normalized, reasons };
}
