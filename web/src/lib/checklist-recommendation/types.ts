export type ConditionCategory = 'trend' | 'supply' | 'valuation' | 'risk' | 'momentum';

export interface ConditionDef {
  id: string;
  label: string;
  category: ConditionCategory;
}

export interface ConditionResult {
  id: string;
  label: string;
  category: ConditionCategory;
  met: boolean;
  detail: string;
  na: boolean;
}

export type ChecklistGrade = 'A' | 'B' | 'C' | 'D';

export interface ChecklistItem {
  symbol: string;
  name: string;
  currentPrice: number | null;
  grade: ChecklistGrade;
  gradeLabel: string;
  metCount: number;
  activeCount: number;
  metRatio: number;
  conditions: ConditionResult[];
}

export const ALL_CONDITIONS: ConditionDef[] = [
  { id: 'ma_aligned',       label: '이동평균 정배열',    category: 'trend' },
  { id: 'rsi_buy_zone',     label: 'RSI 매수구간',      category: 'trend' },
  { id: 'macd_golden',      label: 'MACD/골든크로스',   category: 'trend' },
  { id: 'foreign_buy',      label: '외국인 순매수',      category: 'supply' },
  { id: 'institution_buy',  label: '기관 순매수',        category: 'supply' },
  { id: 'volume_active',    label: '거래량 활성',        category: 'supply' },
  { id: 'per_fair',         label: 'PER 적정',          category: 'valuation' },
  { id: 'target_upside',    label: '목표주가 괴리',      category: 'valuation' },
  { id: 'roe_good',         label: 'ROE 양호',          category: 'valuation' },
  { id: 'no_overbought',    label: '과매수 없음',        category: 'risk' },
  { id: 'no_surge',         label: '급등 없음',          category: 'risk' },
  { id: 'no_smart_exit',    label: '스마트머니 이탈 없음', category: 'risk' },
  { id: 'price_up',         label: '일간 상승',          category: 'momentum' },
  { id: 'bullish_candle',   label: '양봉',               category: 'momentum' },
  { id: 'box_breakout',     label: '박스 돌파',          category: 'momentum' },
];
