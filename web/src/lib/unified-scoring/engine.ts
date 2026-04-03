// web/src/lib/unified-scoring/engine.ts
import type { ScoringInput, UnifiedScoreResult, StyleWeights, CategoryKey } from './types';
import { calcGrade } from './types';
import { getPreset } from './presets';
import type { StyleId } from './types';
import { calcSignalTechScore } from './signal-tech-score';
import { calcSupplyScore } from './supply-score';
import { calcValueGrowthScore } from './value-growth-score';
import { calcMomentumScore } from './momentum-score';
import { calcRiskScore } from './risk-score';
import { getMarketCapTier } from '@/lib/ai-recommendation/market-cap-tier';
import type { ConditionResult } from '@/lib/checklist-recommendation/types';
import { ALL_CONDITIONS } from '@/lib/checklist-recommendation/types';

/**
 * 통합 스코어링 엔진
 *
 * 4대 카테고리 + 리스크 감점으로 최종 점수 산출.
 * 체크리스트 12조건은 각 카테고리 reasons에서 매핑하여 추출.
 */
export function calcUnifiedScore(
  input: ScoringInput,
  styleId: string,
  weights?: StyleWeights,
  disabledConditionIds?: string[],
): UnifiedScoreResult {
  const w = weights ?? getPreset(styleId as StyleId).weights;
  const tier = getMarketCapTier(input.marketCap);

  // 각 카테고리 점수 산출
  const signalTech = calcSignalTechScore(input, styleId);
  const supply = calcSupplyScore(input, styleId);
  const valueGrowth = calcValueGrowthScore(input);
  const momentum = calcMomentumScore(input);
  const risk = calcRiskScore(input);

  const categories = { signalTech, supply, valueGrowth, momentum, risk };

  // 최종 점수 계산
  const positiveWeightSum = w.signalTech + w.supply + w.valueGrowth + w.momentum;
  const positiveBase = positiveWeightSum > 0
    ? (
        signalTech.normalized * w.signalTech +
        supply.normalized * w.supply +
        valueGrowth.normalized * w.valueGrowth +
        momentum.normalized * w.momentum
      ) / positiveWeightSum
    : 0;

  const riskPenalty = risk.normalized * (w.risk / 100);
  const totalScore = Math.max(0, Math.min(Math.round(positiveBase - riskPenalty), 100));
  const grade = calcGrade(totalScore);

  // 체크리스트 매핑: reasons에서 12개 조건 추출
  const checklist = extractChecklist(categories, disabledConditionIds);
  const judgeable = checklist.filter(c => !c.na);
  const checklistMet = judgeable.filter(c => c.met).length;

  return {
    totalScore,
    grade,
    categories,
    checklist,
    checklistMet,
    checklistTotal: judgeable.length,
    tier,
    style: styleId,
    weights: w,
  };
}

/** 체크리스트 12조건 → 카테고리 reasons에서 매핑 */
function extractChecklist(
  categories: Record<CategoryKey, { reasons: { label: string; met: boolean; detail: string; points: number }[] }>,
  disabledConditionIds?: string[],
): ConditionResult[] {
  const disabledSet = new Set(disabledConditionIds ?? []);
  // 조건 ID → { 카테고리, 레이블 패턴 } 매핑
  const conditionMap: Record<string, { category: CategoryKey; labelPattern: string }> = {
    ma_aligned:      { category: 'signalTech', labelPattern: '이평 정배열' },
    rsi_buy_zone:    { category: 'signalTech', labelPattern: 'RSI 매수구간' },
    macd_golden:     { category: 'signalTech', labelPattern: 'MACD 골든크로스' },
    foreign_buy:     { category: 'supply',     labelPattern: '외국인 순매수' },
    institution_buy: { category: 'supply',     labelPattern: '기관 순매수' },
    volume_active:   { category: 'supply',     labelPattern: '거래량 활성' },
    per_fair:        { category: 'valueGrowth', labelPattern: 'PER 적정' },
    target_upside:   { category: 'valueGrowth', labelPattern: '목표가 괴리' },
    roe_good:        { category: 'valueGrowth', labelPattern: 'ROE 양호' },
    no_overbought:   { category: 'risk',       labelPattern: '과매수 없음' },
    no_surge:        { category: 'risk',       labelPattern: '급등 없음' },
    no_smart_exit:   { category: 'risk',       labelPattern: '스마트머니 이탈 없음' },
    price_up:        { category: 'momentum',   labelPattern: '일간 상승' },
    bullish_candle:  { category: 'momentum',   labelPattern: '양봉' },
    box_breakout:    { category: 'momentum',   labelPattern: '박스 돌파' },
  };

  return ALL_CONDITIONS.map(cond => {
    const mapping = conditionMap[cond.id];
    if (!mapping || disabledSet.has(cond.id)) {
      return { id: cond.id, label: cond.label, category: cond.category, met: false, detail: '', na: true };
    }

    const reasons = categories[mapping.category].reasons;
    const matched = reasons.find(r => r.label.includes(mapping.labelPattern));

    if (!matched) {
      return { id: cond.id, label: cond.label, category: cond.category, met: false, detail: '데이터 없음', na: true };
    }

    const met = matched.met;
    return { id: cond.id, label: cond.label, category: cond.category, met, detail: matched.detail, na: false };
  });
}
