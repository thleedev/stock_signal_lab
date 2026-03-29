import { type MarketCapTier } from './market-cap-tier';
import { type ScoreReason, type NormalizedScoreBase } from '@/types/score-reason';

export interface ValuationScoreResult extends NormalizedScoreBase {
  score: number; // 0~25
  per: number | null;
  pbr: number | null;
  roe: number | null;
}

export interface ForwardData {
  forwardPer: number | null;    // 추정 PER
  targetPrice: number | null;   // 목표주가
  investOpinion: number | null; // 투자의견 (1~5, 5=강력매수)
  currentPrice: number | null;  // 현재가 (상승여력 계산용)
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
}

/**
 * PEG 기반 점수 (대형주/중형주용)
 * PEG = PER / EPS성장률
 * EPS 성장률은 Forward PER과 Trailing PER의 차이에서 추정
 */
function calcPegScore(
  forwardPer: number | null,
  trailingPer: number | null,
): number {
  if (!forwardPer || !trailingPer || forwardPer <= 0 || trailingPer <= 0) return 0;

  // 암묵적 EPS 성장률: (Trailing / Forward - 1) * 100
  const epsGrowth = ((trailingPer / forwardPer) - 1) * 100;
  if (epsGrowth <= 0) return 0;  // 역성장이면 PEG 무의미

  const peg = forwardPer / epsGrowth;
  if (peg < 0.5) return 8;    // 성장 대비 극심한 저평가
  if (peg < 0.8) return 7;
  if (peg < 1.0) return 5;
  if (peg < 1.5) return 3;
  if (peg < 2.0) return 1;
  return 0;
}

const MAX_RAW = 25;

export function calcValuationScore(
  per: number | null,
  pbr: number | null,
  roe: number | null,
  dividendYield: number | null = null,
  forward: ForwardData | null = null,
  marketCapTier: MarketCapTier = 'small',
): ValuationScoreResult {
  let score = 0;
  const reasons: ScoreReason[] = [];

  // ── Forward 데이터가 있으면 forward 기준 채점 ──
  if (forward && (forward.forwardPer || forward.targetPrice || forward.investOpinion)) {
    const usePeg = marketCapTier !== 'small' && forward.forwardPer && per && per > 0;

    if (usePeg) {
      // 대형주/중형주: PEG 기반 밸류에이션 (성장 대비 저평가 측정)
      const pegPoints = calcPegScore(forward.forwardPer, per);
      score += pegPoints;

      if (forward.forwardPer && per) {
        const epsGrowth = ((per / forward.forwardPer) - 1) * 100;
        const peg = forward.forwardPer / Math.max(epsGrowth, 0.0001);
        const normalizedPoints = Math.round((pegPoints / MAX_RAW) * 100 * 10) / 10;
        reasons.push({
          label: 'PEG',
          points: normalizedPoints,
          detail: `PEG ${Math.round(peg * 100) / 100} (Forward PER ${Math.round(forward.forwardPer * 10) / 10} / EPS성장률 ${Math.round(epsGrowth * 10) / 10}%)`,
          met: pegPoints > 0,
        });
      }
    } else {
      // 소형주 또는 PEG 계산 불가: Forward PER 절대값 기준
      if (forward.forwardPer !== null && forward.forwardPer > 0) {
        let perPoints = 0;
        if (forward.forwardPer < 5) perPoints = 8;
        else if (forward.forwardPer < 8) perPoints = 6;
        else if (forward.forwardPer < 12) perPoints = 4;
        else if (forward.forwardPer < 15) perPoints = 2;
        else if (forward.forwardPer < 20) perPoints = 1;
        score += perPoints;
        const normalizedPoints = Math.round((perPoints / MAX_RAW) * 100 * 10) / 10;
        reasons.push({
          label: 'Forward PER',
          points: normalizedPoints,
          detail: `Forward PER ${Math.round(forward.forwardPer * 10) / 10}`,
          met: perPoints > 0,
        });
      } else if (per !== null && per > 0) {
        let perPoints = 0;
        if (per < 5) perPoints = 7;
        else if (per < 8) perPoints = 5;
        else if (per < 12) perPoints = 3;
        else if (per < 15) perPoints = 1;
        score += perPoints;
        const normalizedPoints = Math.round((perPoints / MAX_RAW) * 100 * 10) / 10;
        reasons.push({
          label: 'Trailing PER',
          points: normalizedPoints,
          detail: `Trailing PER ${Math.round(per * 10) / 10}`,
          met: perPoints > 0,
        });
      }
    }

    // 목표주가 상승여력 (0~8) — 핵심 forward 지표
    if (forward.targetPrice && forward.currentPrice && forward.currentPrice > 0) {
      const upside = ((forward.targetPrice - forward.currentPrice) / forward.currentPrice) * 100;
      let upsidePoints = 0;
      if (upside >= 50) upsidePoints = 8;
      else if (upside >= 30) upsidePoints = 6;
      else if (upside >= 15) upsidePoints = 4;
      else if (upside >= 5) upsidePoints = 2;
      score += upsidePoints;
      const normalizedPoints = Math.round((upsidePoints / MAX_RAW) * 100 * 10) / 10;
      reasons.push({
        label: '목표주가 상승여력',
        points: normalizedPoints,
        detail: `목표 ${fmt(forward.targetPrice)} vs 현재 ${fmt(forward.currentPrice)} (상승여력 ${Math.round(upside * 10) / 10}%)`,
        met: upsidePoints > 0,
      });
    }

    // 투자의견 (0~4) — 애널리스트 합의
    if (forward.investOpinion !== null && forward.investOpinion > 0) {
      let opinionPoints = 0;
      if (forward.investOpinion >= 4.5) opinionPoints = 4;
      else if (forward.investOpinion >= 3.5) opinionPoints = 3;
      else if (forward.investOpinion >= 2.5) opinionPoints = 1;
      score += opinionPoints;
      const normalizedPoints = Math.round((opinionPoints / MAX_RAW) * 100 * 10) / 10;
      reasons.push({
        label: '투자의견',
        points: normalizedPoints,
        detail: `애널리스트 합의 ${Math.round(forward.investOpinion * 10) / 10}/5`,
        met: opinionPoints > 0,
      });
    }
  } else {
    // ── Forward 없으면 trailing 기준 (기존 로직) ──
    if (pbr !== null && pbr > 0) {
      let pbrPoints = 0;
      if (pbr < 0.5) pbrPoints = 7;
      else if (pbr < 0.8) pbrPoints = 5;
      else if (pbr < 1.0) pbrPoints = 3;
      score += pbrPoints;
      const normalizedPoints = Math.round((pbrPoints / MAX_RAW) * 100 * 10) / 10;
      reasons.push({
        label: 'PBR',
        points: normalizedPoints,
        detail: `PBR ${Math.round(pbr * 100) / 100}`,
        met: pbrPoints > 0,
      });
    }
    if (per !== null && per > 0) {
      let perPoints = 0;
      if (per < 5) perPoints = 7;
      else if (per < 8) perPoints = 5;
      else if (per < 12) perPoints = 3;
      else if (per < 15) perPoints = 1;
      score += perPoints;
      const normalizedPoints = Math.round((perPoints / MAX_RAW) * 100 * 10) / 10;
      reasons.push({
        label: 'Trailing PER',
        points: normalizedPoints,
        detail: `Trailing PER ${Math.round(per * 10) / 10}`,
        met: perPoints > 0,
      });
    }
  }

  // ── 공통: ROE (0~6) — forward/trailing 무관하게 수익성 평가 ──
  if (roe !== null) {
    let roePoints = 0;
    if (roe > 20) roePoints = 6;
    else if (roe > 15) roePoints = 5;
    else if (roe > 10) roePoints = 3;
    else if (roe > 5) roePoints = 1;
    score += roePoints;
    const normalizedPoints = Math.round((roePoints / MAX_RAW) * 100 * 10) / 10;
    reasons.push({
      label: 'ROE',
      points: normalizedPoints,
      detail: `ROE ${Math.round(roe * 10) / 10}%`,
      met: roePoints > 0,
    });
  }

  // ── 공통: 배당수익률 (0~5) ──
  if (dividendYield !== null && dividendYield > 0) {
    let divPoints = 0;
    if (dividendYield >= 5) divPoints = 5;
    else if (dividendYield >= 3) divPoints = 3;
    else if (dividendYield >= 1.5) divPoints = 1;
    score += divPoints;
    const normalizedPoints = Math.round((divPoints / MAX_RAW) * 100 * 10) / 10;
    reasons.push({
      label: '배당수익률',
      points: normalizedPoints,
      detail: `배당수익률 ${Math.round(dividendYield * 10) / 10}%`,
      met: divPoints > 0,
    });
  }

  const rawScore = Math.min(score, MAX_RAW);
  const normalizedScore = Math.round((rawScore / MAX_RAW) * 1000) / 10;

  return { score: rawScore, per, pbr, roe, rawScore, normalizedScore, reasons };
}
