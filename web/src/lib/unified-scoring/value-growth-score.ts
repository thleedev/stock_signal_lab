// web/src/lib/unified-scoring/value-growth-score.ts
import type { ScoreReason } from '@/types/score-reason';
import type { CategoryScore, ScoringInput } from './types';
import { getMarketCapTier } from '@/lib/ai-recommendation/market-cap-tier';

/**
 * 가치·성장 카테고리 (0~100)
 *
 * 밸류에이션 파트 (0~55): PER/PBR/ROE/배당/목표가/PEG
 * 이익성장 파트 (0~45): EPS성장/매출성장/영업이익성장/ROE개선
 */
export function calcValueGrowthScore(input: ScoringInput): CategoryScore {
  const reasons: ScoreReason[] = [];
  let raw = 0;
  const maxRaw = 100;
  const tier = getMarketCapTier(input.marketCap);

  // ── 밸류에이션 파트 (0~55) ──

  // Forward PER (0~12)
  if (input.forwardPer !== null && input.forwardPer > 0) {
    if (input.forwardPer < 10) {
      raw += 12;
      reasons.push({ label: 'Forward PER 저평가', points: 12, detail: `${input.forwardPer.toFixed(1)}배`, met: true });
    } else if (input.forwardPer < 15) {
      raw += 8;
      reasons.push({ label: 'PER 적정', points: 8, detail: `Forward ${input.forwardPer.toFixed(1)}배`, met: true });
    } else if (input.forwardPer < 20) {
      raw += 4;
      reasons.push({ label: 'PER 보통', points: 4, detail: `Forward ${input.forwardPer.toFixed(1)}배`, met: true });
    } else {
      reasons.push({ label: 'PER 적정', points: 0, detail: `Forward ${input.forwardPer.toFixed(1)}배`, met: false });
    }
  } else if (input.per !== null && input.per > 0) {
    // Trailing PER 폴백
    if (input.per < 12) {
      raw += 10;
      reasons.push({ label: 'PER 적정', points: 10, detail: `Trailing ${input.per.toFixed(1)}배`, met: true });
    } else if (input.per < 15) {
      raw += 6;
      reasons.push({ label: 'PER 적정', points: 6, detail: `Trailing ${input.per.toFixed(1)}배`, met: true });
    } else {
      reasons.push({ label: 'PER 적정', points: 0, detail: `Trailing ${input.per.toFixed(1)}배`, met: false });
    }
  }

  // PBR (0~8)
  if (input.pbr !== null && input.pbr > 0) {
    if (input.pbr < 1) {
      raw += 8;
      reasons.push({ label: 'PBR 저평가', points: 8, detail: `${input.pbr.toFixed(2)}배`, met: true });
    } else if (input.pbr < 1.5) {
      raw += 5;
      reasons.push({ label: 'PBR 적정', points: 5, detail: `${input.pbr.toFixed(2)}배`, met: true });
    }
  }

  // ROE (0~10)
  if (input.roe !== null) {
    if (input.roe > 15) {
      raw += 10;
      reasons.push({ label: 'ROE 우수', points: 10, detail: `${input.roe.toFixed(1)}%`, met: true });
    } else if (input.roe > 10) {
      raw += 7;
      reasons.push({ label: 'ROE 양호', points: 7, detail: `${input.roe.toFixed(1)}%`, met: true });
    } else {
      reasons.push({ label: 'ROE 양호', points: 0, detail: `${input.roe?.toFixed(1) ?? 'N/A'}%`, met: false });
    }
  }

  // ROE 예상 개선 (0~5) — 신규 활용
  if (input.roeEstimated !== null && input.roe !== null && input.roeEstimated > input.roe) {
    raw += 5;
    reasons.push({ label: 'ROE 개선 전망', points: 5, detail: `현재 ${input.roe.toFixed(1)}% → 예상 ${input.roeEstimated.toFixed(1)}%`, met: true });
  }

  // 배당수익률 (0~8)
  if (input.dividendYield !== null && input.dividendYield > 0) {
    if (input.dividendYield > 5) {
      raw += 8;
      reasons.push({ label: '고배당', points: 8, detail: `${input.dividendYield.toFixed(1)}%`, met: true });
    } else if (input.dividendYield > 3) {
      raw += 5;
      reasons.push({ label: '적정 배당', points: 5, detail: `${input.dividendYield.toFixed(1)}%`, met: true });
    }
  }

  // 목표가 괴리 (0~12)
  if (input.targetPrice && input.currentPrice && input.currentPrice > 0) {
    const upside = ((input.targetPrice - input.currentPrice) / input.currentPrice) * 100;
    if (upside >= 30) {
      raw += 12;
      reasons.push({ label: '목표가 괴리 대', points: 12, detail: `상승여력 ${upside.toFixed(0)}%`, met: true });
    } else if (upside >= 15) {
      raw += 8;
      reasons.push({ label: '목표가 괴리', points: 8, detail: `상승여력 ${upside.toFixed(0)}%`, met: true });
    } else {
      reasons.push({ label: '목표가 괴리', points: 0, detail: `상승여력 ${upside.toFixed(0)}%`, met: false });
    }
  }

  // 투자의견 (±3)
  if (input.investOpinion !== null && input.investOpinion > 0) {
    if (input.investOpinion >= 4) {
      raw += 3;
      reasons.push({ label: '투자의견 매수', points: 3, detail: `${input.investOpinion.toFixed(1)}`, met: true });
    }
  }

  // PEG (0~5, 대형/중형주만)
  if (tier !== 'small' && input.forwardEps && input.eps && input.eps > 0 && input.forwardPer && input.forwardPer > 0) {
    const epsGrowth = ((input.forwardEps / input.eps) - 1) * 100;
    if (epsGrowth > 0) {
      const peg = input.forwardPer / epsGrowth;
      if (peg < 1) {
        raw += 5;
        reasons.push({ label: 'PEG 매력적', points: 5, detail: `PEG ${peg.toFixed(2)}`, met: true });
      }
    }
  }

  // ── 이익성장 파트 (0~45) ──

  // EPS 성장률 (0~12) — forward_eps/eps 활용 (신규)
  if (input.forwardEps && input.eps && input.eps > 0) {
    const epsGrowth = ((input.forwardEps / input.eps) - 1) * 100;
    if (epsGrowth > 20) {
      raw += 12;
      reasons.push({ label: 'EPS 고성장', points: 12, detail: `${epsGrowth.toFixed(0)}% 성장`, met: true });
    } else if (epsGrowth > 10) {
      raw += 8;
      reasons.push({ label: 'EPS 성장', points: 8, detail: `${epsGrowth.toFixed(0)}% 성장`, met: true });
    }
  }

  // 매출 성장률 YoY (0~10) — DART 데이터 실제 연결 (기존 null 제거)
  if (input.revenueGrowthYoy !== null) {
    if (input.revenueGrowthYoy > 15) {
      raw += 10;
      reasons.push({ label: '매출 고성장', points: 10, detail: `YoY ${input.revenueGrowthYoy.toFixed(0)}%`, met: true });
    } else if (input.revenueGrowthYoy > 5) {
      raw += 5;
      reasons.push({ label: '매출 성장', points: 5, detail: `YoY ${input.revenueGrowthYoy.toFixed(0)}%`, met: true });
    }
  }

  // 영업이익 성장률 YoY (0~12) — DART 데이터 실제 연결 (기존 null 제거)
  if (input.operatingProfitGrowthYoy !== null) {
    if (input.operatingProfitGrowthYoy > 20) {
      raw += 12;
      reasons.push({ label: '영업이익 고성장', points: 12, detail: `YoY ${input.operatingProfitGrowthYoy.toFixed(0)}%`, met: true });
    } else if (input.operatingProfitGrowthYoy > 10) {
      raw += 8;
      reasons.push({ label: '영업이익 성장', points: 8, detail: `YoY ${input.operatingProfitGrowthYoy.toFixed(0)}%`, met: true });
    }
  }

  // 목표가 상향 (0~5)
  if (input.investOpinion !== null && input.investOpinion >= 4.5) {
    raw += 5;
    reasons.push({ label: '목표가 상향', points: 5, detail: `의견 ${input.investOpinion.toFixed(1)}`, met: true });
  }

  const normalized = Math.max(0, Math.min(raw, maxRaw));
  return { raw, maxRaw, normalized, reasons };
}
