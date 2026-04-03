// web/src/lib/unified-scoring/momentum-score.ts
import type { ScoreReason } from '@/types/score-reason';
import type { CategoryScore, ScoringInput } from './types';

/**
 * 모멘텀 카테고리 (0~100)
 *
 * 일간 등락률, 3일 누적, 거래량비율, 종가위치, 캔들패턴, 박스돌파, 섹터강도
 */
export function calcMomentumScore(input: ScoringInput): CategoryScore {
  const reasons: ScoreReason[] = [];
  let raw = 0;
  const maxRaw = 100;

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

  const normalized = Math.max(0, Math.min(raw, maxRaw));
  return { raw, maxRaw, normalized, reasons };
}
