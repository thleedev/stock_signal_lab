// web/src/lib/unified-scoring/supply-score.ts
import type { ScoreReason } from '@/types/score-reason';
import type { CategoryScore, ScoringInput } from './types';
import { isContrarianStyle } from './presets';
import { getMarketCapTier } from '@/lib/ai-recommendation/market-cap-tier';

/**
 * 수급 카테고리 (0~100)
 *
 * 외국인/기관 순매수, 거래량, 거래대금, 회전율, 공매도, 자사주, 대주주 변동
 */
export function calcSupplyScore(input: ScoringInput, styleId: string): CategoryScore {
  const reasons: ScoreReason[] = [];
  let raw = 0;
  const maxRaw = 100;
  const contrarian = isContrarianStyle(styleId);
  const tier = getMarketCapTier(input.marketCap);

  // 외국인 순매수 당일 (0~15)
  if (input.foreignNetQty !== null) {
    if (input.foreignNetQty > 0) {
      let pts: number;
      if (tier === 'large' && input.marketCap) {
        const ratio = (input.foreignNetQty * (input.currentPrice ?? 0)) / (input.marketCap * 100_000_000);
        pts = ratio > 0.001 ? 15 : ratio > 0.0005 ? 10 : 7;
      } else {
        pts = input.foreignNetQty > 50000 ? 15 : input.foreignNetQty > 10000 ? 10 : 7;
      }
      raw += pts;
      reasons.push({ label: '외국인 순매수', points: pts, detail: `${input.foreignNetQty.toLocaleString()}주`, met: true });
    } else {
      reasons.push({ label: '외국인 순매수', points: 0, detail: `${input.foreignNetQty.toLocaleString()}주`, met: false });
    }
  }

  // 기관 순매수 당일 (0~15)
  if (input.institutionNetQty !== null) {
    if (input.institutionNetQty > 0) {
      let pts: number;
      if (tier === 'large' && input.marketCap) {
        const ratio = (input.institutionNetQty * (input.currentPrice ?? 0)) / (input.marketCap * 100_000_000);
        pts = ratio > 0.001 ? 15 : ratio > 0.0005 ? 10 : 7;
      } else {
        pts = input.institutionNetQty > 30000 ? 15 : input.institutionNetQty > 5000 ? 10 : 7;
      }
      raw += pts;
      reasons.push({ label: '기관 순매수', points: pts, detail: `${input.institutionNetQty.toLocaleString()}주`, met: true });
    } else {
      reasons.push({ label: '기관 순매수', points: 0, detail: `${input.institutionNetQty.toLocaleString()}주`, met: false });
    }
  }

  // 외국인 5일 누적 (0~10)
  if (input.foreignNet5d !== null && input.foreignNet5d > 0) {
    const pts = input.foreignNet5d > 100000 ? 10 : input.foreignNet5d > 30000 ? 7 : 4;
    raw += pts;
    reasons.push({ label: '외국인 5일 누적', points: pts, detail: `${input.foreignNet5d.toLocaleString()}주`, met: true });
  }

  // 기관 5일 누적 (0~10)
  if (input.institutionNet5d !== null && input.institutionNet5d > 0) {
    const pts = input.institutionNet5d > 50000 ? 10 : input.institutionNet5d > 10000 ? 7 : 4;
    raw += pts;
    reasons.push({ label: '기관 5일 누적', points: pts, detail: `${input.institutionNet5d.toLocaleString()}주`, met: true });
  }

  // 연속매수일 (각 0~8)
  if (input.foreignStreak !== null && input.foreignStreak > 0) {
    const pts = input.foreignStreak >= 5 ? 8 : input.foreignStreak >= 3 ? 5 : 2;
    raw += pts;
    reasons.push({ label: '외국인 연속매수', points: pts, detail: `${input.foreignStreak}일째`, met: true });
  }
  if (input.institutionStreak !== null && input.institutionStreak > 0) {
    const pts = input.institutionStreak >= 5 ? 8 : input.institutionStreak >= 3 ? 5 : 2;
    raw += pts;
    reasons.push({ label: '기관 연속매수', points: pts, detail: `${input.institutionStreak}일째`, met: true });
  }

  // 역발상: 매도→매수 전환 보너스
  if (contrarian) {
    if (input.foreignStreak !== null && input.foreignStreak > 0 && input.foreignStreak <= 3) {
      raw += 15;
      reasons.push({ label: '외국인 수급 전환 (역발상)', points: 15, detail: `매도→매수 ${input.foreignStreak}일째`, met: true });
    }
    if (input.institutionStreak !== null && input.institutionStreak > 0 && input.institutionStreak <= 3) {
      raw += 15;
      reasons.push({ label: '기관 수급 전환 (역발상)', points: 15, detail: `매도→매수 ${input.institutionStreak}일째`, met: true });
    }
  }

  // 거래량 활성 (0~8)
  if (input.volumeRatio !== null) {
    if (input.volumeRatio >= 1.5) {
      const pts = input.volumeRatio >= 3 ? 8 : input.volumeRatio >= 2 ? 6 : 4;
      raw += pts;
      reasons.push({ label: '거래량 활성', points: pts, detail: `${input.volumeRatio.toFixed(1)}배`, met: true });
    } else {
      reasons.push({ label: '거래량 활성', points: 0, detail: `${input.volumeRatio?.toFixed(1) ?? 'N/A'}배`, met: false });
    }
  }

  // 거래대금 (0~5) — 억원 단위 기준 (100억+: 활발, 50억+: 보통)
  if (input.tradingValue !== null) {
    const hundredMillion = input.tradingValue / 100_000_000; // 억원 단위
    if (hundredMillion >= 100) {
      raw += 5;
      reasons.push({ label: '거래대금 활발', points: 5, detail: `${hundredMillion.toFixed(0)}억원`, met: true });
    } else if (hundredMillion >= 50) {
      raw += 3;
      reasons.push({ label: '거래대금 보통', points: 3, detail: `${hundredMillion.toFixed(0)}억원`, met: true });
    }
  }

  // 회전율 (0~5)
  if (input.floatShares && input.volume && input.floatShares > 0) {
    const turnover = (input.volume / input.floatShares) * 100;
    if (turnover > 5) {
      raw += 5;
      reasons.push({ label: '높은 회전율', points: 5, detail: `${turnover.toFixed(1)}%`, met: true });
    } else if (turnover > 2) {
      raw += 3;
      reasons.push({ label: '적정 회전율', points: 3, detail: `${turnover.toFixed(1)}%`, met: true });
    }
  }

  // 공매도비율 (±5)
  if (input.shortSellRatio !== null) {
    if (input.shortSellRatio < 3) {
      raw += 5;
      reasons.push({ label: '낮은 공매도', points: 5, detail: `${input.shortSellRatio.toFixed(1)}%`, met: true });
    } else if (input.shortSellRatio > 10) {
      raw -= 5;
      reasons.push({ label: '높은 공매도', points: -5, detail: `${input.shortSellRatio.toFixed(1)}%`, met: false });
    }
  }

  // 자사주 매입 (+5)
  if (input.hasTreasuryBuyback) {
    raw += 5;
    reasons.push({ label: '자사주 매입', points: 5, detail: 'DART 공시 확인', met: true });
  }

  // 대주주 지분 변동 (±3)
  // Note: majorShareholderPct 감점은 risk-score.ts에서 처리
  if (input.majorShareholderDelta !== null) {
    if (input.majorShareholderDelta > 0) {
      raw += 3;
      reasons.push({ label: '대주주 지분 증가', points: 3, detail: `${input.majorShareholderDelta.toFixed(1)}%p`, met: true });
    } else if (input.majorShareholderDelta < -1) {
      raw -= 3;
      reasons.push({ label: '대주주 지분 감소', points: -3, detail: `${input.majorShareholderDelta.toFixed(1)}%p`, met: false });
    }
  }

  const normalized = Math.max(0, Math.min(raw, maxRaw));
  return { raw, maxRaw, normalized, reasons };
}
