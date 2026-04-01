// web/src/lib/scoring/valuation-attractiveness.ts
// 가치매력 점수 모듈 — 목표주가 괴리율(1순위), PBR/ROE·배당·PER 보조

import type { ScoreReason, NormalizedScoreBase } from '@/types/score-reason';

/** 가치매력 점수 계산에 필요한 입력값 */
export interface ValuationAttractivenessInput {
  /** 현재주가 */
  currentPrice: number | null;
  /** 애널리스트 목표주가 */
  targetPrice: number | null;
  /** 예상 PER (Forward PER) */
  forwardPer: number | null;
  /** 12개월 Trailing PER */
  per: number | null;
  /** 주가순자산비율 */
  pbr: number | null;
  /** 자기자본이익률 (%) */
  roe: number | null;
  /** 배당수익률 (%) */
  dividendYield: number | null;
  /** 투자의견 수치 (예: 4 = Strong Buy) */
  investOpinion: number | null;
}

/** 가치매력 점수 결과 */
export interface ValuationAttractivenessResult extends NormalizedScoreBase {
  /** 목표주가 대비 현재주가 상승여력 (%) — 데이터 없으면 null */
  upside_pct: number | null;
}

/** 원점수 최대값 (정규화 기준) */
const MAX_RAW = 80;

/**
 * 가치매력 점수를 계산한다.
 *
 * 배점 구조:
 *  - 목표주가 괴리율 (1순위): 최대 +35점
 *  - Forward PER < Trailing PER: +20점
 *  - PBR < 1.0 + ROE > 10%: +20점
 *  - PBR < 0.7 극저평가: +15점
 *  - 배당수익률 3%+: +10점
 *  - 애널리스트 Strong Buy: +10점
 *  - 감점: PER > 50 → -10점
 *
 * 최종 점수 = clamp(rawScore, -20, 80) / 80 × 100, 최솟값 0
 */
export function calcValuationAttractiveness(
  input: ValuationAttractivenessInput,
): ValuationAttractivenessResult {
  const { currentPrice, targetPrice, forwardPer, per, pbr, roe, dividendYield, investOpinion } =
    input;

  let rawScore = 0;
  const reasons: ScoreReason[] = [];
  let upsidePct: number | null = null;

  // ── 1순위: 목표주가 괴리율 ──────────────────────────────────────────────
  if (targetPrice !== null && currentPrice !== null && currentPrice > 0) {
    upsidePct = ((targetPrice - currentPrice) / currentPrice) * 100;

    let upsideScore = 0;
    let upsideDetail = '';

    if (upsidePct >= 30) {
      upsideScore = 35;
      upsideDetail = `목표주가 ${Math.round(targetPrice).toLocaleString('ko-KR')} (+${upsidePct.toFixed(1)}%) — 강한 저평가`;
    } else if (upsidePct >= 20) {
      upsideScore = 25;
      upsideDetail = `목표주가 ${Math.round(targetPrice).toLocaleString('ko-KR')} (+${upsidePct.toFixed(1)}%) — 유의미한 상승여력`;
    } else if (upsidePct >= 10) {
      upsideScore = 15;
      upsideDetail = `목표주가 ${Math.round(targetPrice).toLocaleString('ko-KR')} (+${upsidePct.toFixed(1)}%) — 소폭 상승여력`;
    } else if (upsidePct < 0) {
      upsideScore = -10;
      upsideDetail = `목표주가 ${Math.round(targetPrice).toLocaleString('ko-KR')} (${upsidePct.toFixed(1)}%) — 하향 조정`;
    } else {
      upsideScore = 0;
      upsideDetail = `목표주가 ${Math.round(targetPrice).toLocaleString('ko-KR')} (+${upsidePct.toFixed(1)}%) — 상승여력 미미`;
    }

    rawScore += upsideScore;
    reasons.push({
      label: '목표주가 괴리',
      points: Math.round((upsideScore / MAX_RAW) * 100),
      detail: upsideDetail,
      met: upsideScore > 0,
    });
  } else {
    reasons.push({
      label: '목표주가 괴리',
      points: 0,
      detail: '목표주가 없음',
      met: false,
    });
  }

  // ── Forward PER < Trailing PER (이익 성장) ─────────────────────────────
  if (forwardPer !== null && per !== null && forwardPer > 0 && per > 0 && forwardPer < per) {
    rawScore += 20;
    reasons.push({
      label: 'Forward PER',
      points: Math.round((20 / MAX_RAW) * 100),
      detail: `Forward PER ${forwardPer.toFixed(1)} < Trailing ${per.toFixed(1)} (이익 성장)`,
      met: true,
    });
  } else {
    const detail =
      forwardPer !== null && per !== null
        ? `Forward PER ${forwardPer.toFixed(1)} vs PER ${per.toFixed(1)}`
        : 'Forward PER 없음';
    reasons.push({ label: 'Forward PER', points: 0, detail, met: false });
  }

  // ── PBR < 1.0 + ROE > 10% 복합 ─────────────────────────────────────────
  if (pbr !== null && pbr > 0 && pbr < 1.0 && roe !== null && roe > 10) {
    rawScore += 20;
    reasons.push({
      label: 'PBR+ROE 복합',
      points: Math.round((20 / MAX_RAW) * 100),
      detail: `PBR ${pbr.toFixed(2)} + ROE ${roe.toFixed(1)}% (저평가 우량)`,
      met: true,
    });
  } else {
    const detail =
      pbr !== null && roe !== null
        ? `PBR ${pbr.toFixed(2)}, ROE ${roe.toFixed(1)}%`
        : '데이터 부족';
    reasons.push({ label: 'PBR+ROE 복합', points: 0, detail, met: false });
  }

  // ── PBR < 0.7 자산가치 극저평가 ────────────────────────────────────────
  if (pbr !== null && pbr > 0 && pbr < 0.7) {
    rawScore += 15;
    reasons.push({
      label: 'PBR 극저평가',
      points: Math.round((15 / MAX_RAW) * 100),
      detail: `PBR ${pbr.toFixed(2)} (순자산 대비 극저평가)`,
      met: true,
    });
  } else {
    reasons.push({
      label: 'PBR 극저평가',
      points: 0,
      detail: pbr !== null ? `PBR ${pbr.toFixed(2)}` : 'PBR 없음',
      met: false,
    });
  }

  // ── 배당수익률 3%+ (하방 지지선) ──────────────────────────────────────
  if (dividendYield !== null && dividendYield >= 3) {
    rawScore += 10;
    reasons.push({
      label: '배당수익률',
      points: Math.round((10 / MAX_RAW) * 100),
      detail: `배당 ${dividendYield.toFixed(1)}% (하방 지지선)`,
      met: true,
    });
  } else {
    reasons.push({
      label: '배당수익률',
      points: 0,
      detail: dividendYield !== null ? `배당 ${dividendYield.toFixed(1)}%` : '배당 없음',
      met: false,
    });
  }

  // ── 애널리스트 Strong Buy ──────────────────────────────────────────────
  if (investOpinion !== null && investOpinion >= 4) {
    rawScore += 10;
    reasons.push({
      label: '애널리스트 의견',
      points: Math.round((10 / MAX_RAW) * 100),
      detail: `투자의견 ${investOpinion.toFixed(1)} (Strong Buy)`,
      met: true,
    });
  } else {
    reasons.push({
      label: '애널리스트 의견',
      points: 0,
      detail: investOpinion !== null ? `투자의견 ${investOpinion.toFixed(1)}` : '의견 없음',
      met: false,
    });
  }

  // ── 감점: PER > 50 (밸류 부담) ────────────────────────────────────────
  const activePer = forwardPer ?? per;
  if (activePer !== null && activePer > 50) {
    rawScore -= 10;
    reasons.push({
      label: 'PER 과대',
      points: -Math.round((10 / MAX_RAW) * 100),
      detail: `PER ${activePer.toFixed(1)} > 50 (밸류 부담)`,
      met: false,
    });
  }

  // ── 최종 정규화 ───────────────────────────────────────────────────────
  const clampedRaw = Math.max(-20, Math.min(rawScore, MAX_RAW));
  const normalizedScore = Math.round(Math.max(0, (clampedRaw / MAX_RAW) * 100) * 10) / 10;

  return {
    rawScore: clampedRaw,
    normalizedScore,
    reasons,
    upside_pct: upsidePct,
  };
}
