// web/src/lib/unified-scoring/risk-score.ts
import type { ScoreReason } from '@/types/score-reason';
import type { CategoryScore, ScoringInput } from './types';

/**
 * 리스크 감점 카테고리 (0~100)
 *
 * 기술적 과열 (최대 40), 수급 이탈 (최대 25), DART 리스크 (최대 35)
 * normalized 값이 높을수록 리스크가 높음 (감점이 큼)
 */
export function calcRiskScore(input: ScoringInput): CategoryScore {
  const reasons: ScoreReason[] = [];
  let raw = 0;
  const maxRaw = 100;

  const prices = input.dailyPrices;
  const closes = prices.map(p => p.close);

  // ── 기술적 과열 (최대 40) ──

  // RSI > 70: -15
  if (closes.length >= 15) {
    const rsi = calcRSI14(closes);
    if (rsi !== null && rsi > 70) {
      raw += 15;
      reasons.push({ label: '과매수 (RSI>70)', points: -15, detail: `RSI ${rsi.toFixed(1)}`, met: false });
    } else {
      reasons.push({ label: '과매수 없음', points: 0, detail: `RSI ${rsi?.toFixed(1) ?? 'N/A'}`, met: true });
    }
  }

  // 5일 수익률 > 15%: -15
  if (closes.length >= 6) {
    const return5d = ((closes[0] - closes[5]) / closes[5]) * 100;
    if (return5d > 15) {
      raw += 15;
      reasons.push({ label: '급등 (5일 >15%)', points: -15, detail: `${return5d.toFixed(1)}%`, met: false });
    } else {
      reasons.push({ label: '급등 없음', points: 0, detail: `5일 ${return5d.toFixed(1)}%`, met: true });
    }
  }

  // 이격도 과열 (20일 SMA 대비 > 10%): -10
  if (closes.length >= 20) {
    const sma20 = closes.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
    if (sma20 > 0) {
      const disparity = ((closes[0] - sma20) / sma20) * 100;
      if (disparity > 10) {
        raw += 10;
        reasons.push({ label: '이격도 과열', points: -10, detail: `${disparity.toFixed(1)}%`, met: false });
      }
    }
  }

  // 볼린저 상단 이탈: -5
  if (closes.length >= 20) {
    const slice = closes.slice(0, 20);
    const mean = slice.reduce((a, b) => a + b, 0) / 20;
    const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / 20;
    const upper = mean + 2 * Math.sqrt(variance);
    if (closes[0] > upper) {
      raw += 5;
      reasons.push({ label: '볼린저 상단 이탈', points: -5, detail: `종가 ${closes[0]} > 상단 ${upper.toFixed(0)}`, met: false });
    }
  }

  // ── 수급 이탈 (최대 25) ──

  // 외국인+기관 동시 순매도: -15
  const foreignSelling = (input.foreignNetQty ?? 0) < 0;
  const instSelling = (input.institutionNetQty ?? 0) < 0;
  if (foreignSelling && instSelling) {
    raw += 15;
    reasons.push({ label: '스마트머니 이탈', points: -15, detail: '외국인+기관 동시 순매도', met: false });
  } else {
    reasons.push({ label: '스마트머니 이탈 없음', points: 0, detail: '', met: true });
  }

  // 외국인 5일 연속 매도: -10
  if (input.foreignStreak !== null && input.foreignStreak <= -5) {
    raw += 10;
    reasons.push({ label: '외국인 연속 매도', points: -10, detail: `${Math.abs(input.foreignStreak)}일 연속`, met: false });
  }

  // ── DART 리스크 (최대 35) ──

  // 관리종목: -20
  if (input.isManaged) {
    raw += 20;
    reasons.push({ label: '관리종목', points: -20, detail: '관리종목 지정', met: false });
  }

  // CB/BW 발행: -15
  if (input.hasRecentCbw) {
    raw += 15;
    reasons.push({ label: 'CB/BW 발행', points: -15, detail: '최근 전환사채/신주인수권 발행', met: false });
  }

  // 감사의견 비적정: -30
  if (input.auditOpinion && input.auditOpinion !== '적정') {
    raw += 30;
    reasons.push({ label: '감사의견 비적정', points: -30, detail: `의견: ${input.auditOpinion}`, met: false });
  }

  // 대주주 지분율 낮음: -5 (0%는 데이터 없음으로 간주하여 패널티 제외)
  if (input.majorShareholderPct !== null && input.majorShareholderPct > 0 && input.majorShareholderPct < 20) {
    raw += 5;
    reasons.push({ label: '대주주 지분율 낮음', points: -5, detail: `${input.majorShareholderPct.toFixed(1)}%`, met: false });
  }

  const normalized = Math.max(0, Math.min(raw, maxRaw));
  return { raw, maxRaw, normalized, reasons };
}

function calcRSI14(closes: number[]): number | null {
  if (closes.length < 15) return null;
  let gains = 0, losses = 0;
  for (let i = 0; i < 14; i++) {
    const diff = closes[i] - closes[i + 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  return 100 - (100 / (1 + gains / losses));
}
