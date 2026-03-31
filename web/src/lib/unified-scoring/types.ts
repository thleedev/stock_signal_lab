// web/src/lib/unified-scoring/types.ts
import type { ScoreReason } from '@/types/score-reason';
import type { ConditionResult } from '@/lib/checklist-recommendation/types';
import type { MarketCapTier } from '@/lib/ai-recommendation/market-cap-tier';

/** 4대 카테고리 + 리스크 */
export type CategoryKey = 'signalTech' | 'supply' | 'valueGrowth' | 'momentum' | 'risk';

/** 트레이딩 스타일 ID */
export type StyleId = 'balanced' | 'supply' | 'value' | 'momentum' | 'contrarian';

/** 종목 등급 */
export type Grade = 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D';

/** 카테고리별 가중치 (합계 = 100) */
export interface StyleWeights {
  signalTech: number;
  supply: number;
  valueGrowth: number;
  momentum: number;
  risk: number; // 10~20 범위
}

/** 프리셋 정의 */
export interface StylePreset {
  id: StyleId;
  name: string;
  description: string;
  weights: StyleWeights;
}

/** 커스텀 프리셋 (localStorage) */
export interface CustomPreset {
  id: string;
  name: string;
  weights: StyleWeights;
}

/** 개별 카테고리 스코어 결과 */
export interface CategoryScore {
  raw: number;         // 원점수 (카테고리별 고유 범위)
  maxRaw: number;      // 최대 가능 원점수
  normalized: number;  // 정규화 (0~100)
  reasons: ScoreReason[];
}

/** 통합 스코어링 전체 결과 */
export interface UnifiedScoreResult {
  totalScore: number;  // 0~100
  grade: Grade;        // A+, A, B+, B, C, D
  categories: Record<CategoryKey, CategoryScore>;
  checklist: ConditionResult[];
  checklistMet: number;
  checklistTotal: number;
  tier: MarketCapTier;
  style: StyleId | (string & {}); // 커스텀이면 커스텀 ID
  weights: StyleWeights;
}

/** 일봉 캔들 데이터 */
export interface DailyCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** 스코어링 엔진에 전달할 종목 입력 데이터 */
export interface ScoringInput {
  symbol: string;
  name: string;
  market: string;
  // 가격
  currentPrice: number | null;
  priceChangePct: number | null;
  high52w: number | null;
  low52w: number | null;
  marketCap: number | null;
  // 밸류에이션
  per: number | null;
  forwardPer: number | null;
  forwardEps: number | null;
  eps: number | null;
  pbr: number | null;
  bps: number | null;
  roe: number | null;
  roeEstimated: number | null;
  dividendYield: number | null;
  targetPrice: number | null;
  investOpinion: number | null;
  // 수급
  foreignNetQty: number | null;
  institutionNetQty: number | null;
  foreignNet5d: number | null;
  institutionNet5d: number | null;
  foreignStreak: number | null;
  institutionStreak: number | null;
  shortSellRatio: number | null;
  volume: number | null;
  floatShares: number | null;
  // AI 신호
  signalCount30d: number | null;
  latestSignalPrice: number | null;
  latestSignalDate: string | null;
  signalSources: string[];      // 30일 내 BUY 신호 소스 목록
  latestSignalDaysAgo: number | null;
  // DART
  isManaged: boolean;
  hasRecentCbw: boolean;
  auditOpinion: string | null;
  majorShareholderPct: number | null;
  majorShareholderDelta: number | null;
  hasTreasuryBuyback: boolean;
  revenueGrowthYoy: number | null;
  operatingProfitGrowthYoy: number | null;
  // 일봉 기반 파생 (daily_prices에서 미리 계산)
  dailyPrices: DailyCandle[];
  // 모멘텀 파생
  volumeRatio: number | null;      // 당일거래량 / 20일평균
  closePosition: number | null;    // (종가-저가)/(고가-저가)
  gapPct: number | null;           // 갭 %
  cumReturn3d: number | null;      // 3일 누적 수익률
  tradingValue: number | null;     // 거래대금
  // 섹터
  sectorAvgChangePct: number | null;
  sectorRank: number | null;       // 섹터 내 순위 (1=최고)
  sectorTotal: number | null;      // 섹터 내 총 종목 수
}

/** 등급 계산 */
export function calcGrade(score: number): Grade {
  if (score >= 85) return 'A+';
  if (score >= 70) return 'A';
  if (score >= 55) return 'B+';
  if (score >= 40) return 'B';
  if (score >= 25) return 'C';
  return 'D';
}
