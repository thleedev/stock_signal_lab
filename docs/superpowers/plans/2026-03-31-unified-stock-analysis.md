# 종목분석 통합 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 종목추천+단기추천+체크리스트 3개 탭을 "종목분석" 단일 탭으로 통합하고, 트레이딩 스타일 프리셋 기반의 통합 스코어링 엔진을 구축한다.

**Architecture:** 백엔드에 통합 스코어링 엔진(`unified-scoring/`)을 신규 생성하여 기존 3개 스코어링 시스템을 교체한다. 프론트엔드는 탭 통합 + 스타일 셀렉터 + 호버 툴팁 + 상세 패널 `UnifiedScoreCard`를 구현한다. API는 기존 `/api/v1/stock-ranking` 엔드포인트에 `style` 파라미터를 추가하여 호환성을 유지한다.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase, Recharts (RadarChart + LineChart), Tailwind CSS v4

**설계 문서:** `docs/superpowers/specs/2026-03-31-unified-stock-analysis-design.md`

---

## 파일 구조

### 신규 생성

| 파일 | 역할 |
|---|---|
| `web/src/lib/unified-scoring/types.ts` | 통합 스코어링 타입 정의 |
| `web/src/lib/unified-scoring/presets.ts` | 5개 프리셋 가중치 + 스타일별 보정 로직 |
| `web/src/lib/unified-scoring/signal-tech-score.ts` | 신호·기술 카테고리 (0~100) |
| `web/src/lib/unified-scoring/supply-score.ts` | 수급 카테고리 (0~100) |
| `web/src/lib/unified-scoring/value-growth-score.ts` | 가치·성장 카테고리 (0~100) |
| `web/src/lib/unified-scoring/momentum-score.ts` | 모멘텀 카테고리 (0~100) |
| `web/src/lib/unified-scoring/risk-score.ts` | 리스크 감점 (0~100) |
| `web/src/lib/unified-scoring/engine.ts` | 통합 엔진 (카테고리 조합 + 총점 계산) |
| `web/src/hooks/use-unified-ranking.ts` | 통합 랭킹 데이터 훅 |
| `web/src/hooks/use-score-history.ts` | 점수 추이 데이터 훅 |
| `web/src/components/signals/StockAnalysisSection.tsx` | 종목분석 탭 메인 |
| `web/src/components/signals/StyleSelector.tsx` | 스타일 드롭다운 + 슬라이더 |
| `web/src/components/signals/AnalysisHoverCard.tsx` | 호버 툴팁 |
| `web/src/components/stock-modal/UnifiedScoreCard.tsx` | 상세 패널 점수 카드 |

### 수정 대상

| 파일 | 변경 |
|---|---|
| `web/src/app/api/v1/stock-ranking/route.ts` | `calcScore` → `calcUnifiedScore` 교체, `style` 파라미터 추가 |
| `web/src/components/signals/RecommendationView.tsx` | 3탭 → 2탭 (AI신호 + 종목분석) |
| `web/src/app/signals/page.tsx` | 탭 구조 변경, 데이터 fetch 정리 |
| `web/src/components/stock-modal/StockDetailPanel.tsx` | AiOpinionCard/SupplyDemand/TechnicalSignal 제거 → UnifiedScoreCard |
| `web/src/contexts/stock-modal-context.tsx` | scoreMode/shortTermScores 제거, categories 데이터 전달 |

### 삭제 (마지막 태스크)

| 파일 | 이유 |
|---|---|
| `web/src/components/signals/ShortTermRecommendationSection.tsx` | 통합 완료 |
| `web/src/components/signals/ChecklistSection.tsx` | 통합 완료 |
| `web/src/hooks/use-checklist-ranking.ts` | 대체됨 |

---

## Task 1: 통합 스코어링 타입 정의

**Files:**
- Create: `web/src/lib/unified-scoring/types.ts`

- [ ] **Step 1: 타입 파일 생성**

```typescript
// web/src/lib/unified-scoring/types.ts
import type { ScoreReason } from '@/types/score-reason';
import type { ConditionResult } from '@/lib/checklist-recommendation/types';
import type { MarketCapTier } from '@/lib/ai-recommendation/market-cap-tier';

/** 4대 카테고리 + 리스크 */
export type CategoryKey = 'signalTech' | 'supply' | 'valueGrowth' | 'momentum' | 'risk';

/** 트레이딩 스타일 ID */
export type StyleId = 'balanced' | 'supply' | 'value' | 'momentum' | 'contrarian';

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
  grade: string;       // A+, A, B+, B, C, D
  categories: Record<CategoryKey, CategoryScore>;
  checklist: ConditionResult[];
  checklistMet: number;
  checklistTotal: number;
  tier: MarketCapTier;
  style: StyleId | string; // 커스텀이면 커스텀 ID
  weights: StyleWeights;
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
  dailyPrices: { date: string; open: number; high: number; low: number; close: number; volume: number }[];
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
export function calcGrade(score: number): string {
  if (score >= 85) return 'A+';
  if (score >= 70) return 'A';
  if (score >= 55) return 'B+';
  if (score >= 40) return 'B';
  if (score >= 25) return 'C';
  return 'D';
}
```

- [ ] **Step 2: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/lib/unified-scoring/types.ts
git commit -m "feat: 통합 스코어링 타입 정의 추가"
```

---

## Task 2: 프리셋 정의

**Files:**
- Create: `web/src/lib/unified-scoring/presets.ts`

- [ ] **Step 1: 프리셋 파일 생성**

```typescript
// web/src/lib/unified-scoring/presets.ts
import type { StylePreset, StyleId, StyleWeights, CustomPreset } from './types';

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'balanced',
    name: '균형형',
    description: '모든 요소를 골고루 평가',
    weights: { signalTech: 22, supply: 22, valueGrowth: 22, momentum: 19, risk: 15 },
  },
  {
    id: 'supply',
    name: '수급 추종형',
    description: '외국인·기관 매수 흐름 추종',
    weights: { signalTech: 15, supply: 35, valueGrowth: 10, momentum: 25, risk: 15 },
  },
  {
    id: 'value',
    name: '가치투자형',
    description: '저평가 + 이익성장 중심',
    weights: { signalTech: 10, supply: 12, valueGrowth: 53, momentum: 10, risk: 15 },
  },
  {
    id: 'momentum',
    name: '단기 모멘텀형',
    description: '단타/스윙 트레이딩',
    weights: { signalTech: 20, supply: 20, valueGrowth: 5, momentum: 40, risk: 15 },
  },
  {
    id: 'contrarian',
    name: '역발상 과매도형',
    description: '바닥 포착 + 수급 전환',
    weights: { signalTech: 35, supply: 25, valueGrowth: 15, momentum: 10, risk: 15 },
  },
];

export function getPreset(id: StyleId): StylePreset {
  return STYLE_PRESETS.find(p => p.id === id) ?? STYLE_PRESETS[0];
}

/** 역발상 과매도형인지 확인 */
export function isContrarianStyle(styleId: string): boolean {
  return styleId === 'contrarian';
}

/** 가중치 유효성 검증 */
export function validateWeights(w: StyleWeights): boolean {
  const sum = w.signalTech + w.supply + w.valueGrowth + w.momentum + w.risk;
  return sum === 100 && w.risk >= 10 && w.risk <= 20;
}

// ── localStorage 커스텀 프리셋 관리 ──

const STORAGE_KEY = 'unified-analysis-custom-presets';
const MAX_PRESETS = 10;

export function loadCustomPresets(): CustomPreset[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCustomPreset(preset: CustomPreset): CustomPreset[] {
  const presets = loadCustomPresets();
  const idx = presets.findIndex(p => p.id === preset.id);
  if (idx >= 0) {
    presets[idx] = preset;
  } else {
    if (presets.length >= MAX_PRESETS) throw new Error('최대 10개까지 저장 가능합니다');
    presets.push(preset);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  return presets;
}

export function deleteCustomPreset(id: string): CustomPreset[] {
  const presets = loadCustomPresets().filter(p => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  return presets;
}
```

- [ ] **Step 2: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/lib/unified-scoring/presets.ts
git commit -m "feat: 트레이딩 스타일 프리셋 정의"
```

---

## Task 3: 신호·기술 스코어 모듈

**Files:**
- Create: `web/src/lib/unified-scoring/signal-tech-score.ts`

- [ ] **Step 1: 모듈 생성**

기존 `web/src/lib/ai-recommendation/technical-score.ts`와 `signal-score.ts`의 로직을 참고하되, 설계 문서 섹션 2.2의 "신호·기술" 스펙대로 새로 작성한다.

```typescript
// web/src/lib/unified-scoring/signal-tech-score.ts
import type { ScoreReason } from '@/types/score-reason';
import type { CategoryScore, ScoringInput } from './types';
import { isContrarianStyle } from './presets';

/**
 * 신호·기술 카테고리 (0~100)
 *
 * AI 신호 파트 (0~40): 신호 수, 소스 다양성, 갭, 최근성
 * 기술 트렌드 파트 (0~60): SMA정배열, RSI, MACD, 볼린저, 52주위치, 봉패턴 등
 */
export function calcSignalTechScore(input: ScoringInput, styleId: string): CategoryScore {
  const reasons: ScoreReason[] = [];
  let raw = 0;
  const maxRaw = 100;
  const contrarian = isContrarianStyle(styleId);

  // ── AI 신호 파트 (0~40) ──

  // 30일 BUY 신호 수 (0~20)
  const sigCount = input.signalCount30d ?? 0;
  if (sigCount >= 3) {
    raw += 20;
    reasons.push({ label: `30일 BUY ${sigCount}건`, points: 20, detail: `${sigCount}건 매수 신호`, met: true });
  } else if (sigCount === 2) {
    raw += 12;
    reasons.push({ label: `30일 BUY ${sigCount}건`, points: 12, detail: `${sigCount}건 매수 신호`, met: true });
  } else if (sigCount === 1) {
    raw += 6;
    reasons.push({ label: `30일 BUY ${sigCount}건`, points: 6, detail: `${sigCount}건 매수 신호`, met: true });
  } else {
    reasons.push({ label: '30일 BUY 신호 없음', points: 0, detail: '매수 신호 없음', met: false });
  }

  // 소스 다양성 (0~10)
  const sourceCount = input.signalSources.length;
  if (sourceCount >= 3) {
    raw += 10;
    reasons.push({ label: '멀티소스 (3+)', points: 10, detail: input.signalSources.join(', '), met: true });
  } else if (sourceCount === 2) {
    raw += 5;
    reasons.push({ label: '멀티소스 (2)', points: 5, detail: input.signalSources.join(', '), met: true });
  }

  // 현재가 vs 신호가 갭 (-5~+10)
  if (input.latestSignalPrice && input.currentPrice && input.currentPrice > 0) {
    const gap = ((input.currentPrice - input.latestSignalPrice) / input.latestSignalPrice) * 100;
    if (gap <= -5) {
      raw += 10;
      reasons.push({ label: '신호가 대비 저평가', points: 10, detail: `갭 ${gap.toFixed(1)}%`, met: true });
    } else if (gap <= 5) {
      raw += 5;
      reasons.push({ label: '신호가 근접', points: 5, detail: `갭 ${gap.toFixed(1)}%`, met: true });
    } else if (gap > 15) {
      raw -= 5;
      reasons.push({ label: '신호가 대비 과열', points: -5, detail: `갭 ${gap.toFixed(1)}%`, met: false });
    }
  }

  // 신호 최근성 (0~5)
  if (input.latestSignalDaysAgo !== null) {
    if (input.latestSignalDaysAgo <= 3) {
      raw += 5;
      reasons.push({ label: '최근 신호 (3일내)', points: 5, detail: `${input.latestSignalDaysAgo}일 전`, met: true });
    } else if (input.latestSignalDaysAgo <= 7) {
      raw += 3;
      reasons.push({ label: '최근 신호 (7일내)', points: 3, detail: `${input.latestSignalDaysAgo}일 전`, met: true });
    }
  }

  // ── 기술 트렌드 파트 (0~60) ──
  // daily_prices 기반 기술적 지표 계산
  const prices = input.dailyPrices;
  if (prices.length >= 20) {
    const closes = prices.map(p => p.close);
    const volumes = prices.map(p => p.volume);

    // SMA 계산
    const sma = (arr: number[], period: number) => {
      if (arr.length < period) return null;
      return arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    };
    const sma5 = sma(closes, 5);
    const sma20 = sma(closes, 20);
    const sma60 = prices.length >= 60 ? sma(closes, 60) : null;

    // SMA 정배열 (5>20>60): +12
    if (sma5 !== null && sma20 !== null && sma60 !== null && sma5 > sma20 && sma20 > sma60) {
      raw += 12;
      reasons.push({ label: '이평 정배열', points: 12, detail: `5일 ${sma5.toFixed(0)} > 20일 ${sma20.toFixed(0)} > 60일 ${sma60.toFixed(0)}`, met: true });
    } else if (sma5 !== null && sma20 !== null && sma60 !== null) {
      reasons.push({ label: '이평 정배열', points: 0, detail: '정배열 아님', met: false });
    }

    // RSI 계산 (14일)
    const rsi = calcRSI(closes, 14);
    if (rsi !== null) {
      if (contrarian && rsi < 30) {
        // 역발상: 과매도 가점
        raw += 15;
        reasons.push({ label: 'RSI 과매도 (역발상)', points: 15, detail: `RSI ${rsi.toFixed(1)}`, met: true });
      } else if (rsi >= 30 && rsi <= 50) {
        raw += 10;
        reasons.push({ label: 'RSI 매수구간', points: 10, detail: `RSI ${rsi.toFixed(1)}`, met: true });
      } else if (rsi > 50 && rsi <= 70) {
        raw += 5;
        reasons.push({ label: 'RSI 중립', points: 5, detail: `RSI ${rsi.toFixed(1)}`, met: true });
      } else {
        reasons.push({ label: 'RSI 매수구간', points: 0, detail: `RSI ${rsi?.toFixed(1) ?? 'N/A'}`, met: false });
      }
    }

    // MACD 골든크로스: 5일/20일 SMA 교차 (최근 3일 내) +10
    if (closes.length >= 23) {
      const macdGolden = checkMacdGoldenCross(closes);
      if (macdGolden) {
        raw += 10;
        reasons.push({ label: 'MACD 골든크로스', points: 10, detail: '최근 3일 내 교차', met: true });
      } else {
        reasons.push({ label: 'MACD 골든크로스', points: 0, detail: '교차 없음', met: false });
      }
    }

    // 볼린저 밴드 하단 근접: +8 (역발상: +12)
    if (closes.length >= 20) {
      const { lower } = calcBollingerBands(closes, 20);
      if (lower !== null && closes[0] <= lower * 1.02) {
        const pts = contrarian ? 12 : 8;
        raw += pts;
        reasons.push({ label: '볼린저 하단 근접', points: pts, detail: `종가 ${closes[0]} ≤ 하단 ${lower.toFixed(0)}`, met: true });
      }
    }

    // 52주 위치
    if (input.high52w && input.low52w && input.currentPrice) {
      const range = input.high52w - input.low52w;
      if (range > 0) {
        const position = ((input.currentPrice - input.low52w) / range) * 100;
        if (position <= 30) {
          raw += 8;
          reasons.push({ label: '52주 하위 30%', points: 8, detail: `위치 ${position.toFixed(0)}%`, met: true });
        } else if (position <= 50) {
          raw += 4;
          reasons.push({ label: '52주 하위 50%', points: 4, detail: `위치 ${position.toFixed(0)}%`, met: true });
        }
      }
    }

    // 이격도 (역발상 보정)
    if (sma20 !== null && input.currentPrice && sma20 > 0) {
      const disparity = ((input.currentPrice - sma20) / sma20) * 100;
      if (contrarian && disparity < -5) {
        raw += 10;
        reasons.push({ label: '이격도 과매도 (역발상)', points: 10, detail: `이격도 ${disparity.toFixed(1)}%`, met: true });
      } else if (disparity > -5 && disparity < 0) {
        raw += 5;
        reasons.push({ label: '이격도 반등', points: 5, detail: `이격도 ${disparity.toFixed(1)}%`, met: true });
      }
    }

    // 거래량 돌파
    const avgVol20 = sma(volumes, 20);
    if (avgVol20 && volumes[0] > avgVol20 * 2.5) {
      raw += 5;
      reasons.push({ label: '거래량 돌파', points: 5, detail: `${(volumes[0] / avgVol20).toFixed(1)}배`, met: true });
    }

    // 연속하락 반등 (역발상: +8)
    if (contrarian && closes.length >= 6) {
      let consecDown = 0;
      for (let i = 1; i < 6; i++) {
        if (closes[i] > closes[i - 1]) consecDown++;
        else break;
      }
      if (consecDown >= 5 && closes[0] > closes[1]) {
        raw += 8;
        reasons.push({ label: '연속하락 후 반등 (역발상)', points: 8, detail: `${consecDown}일 하락 후 반등`, met: true });
      }
    }
  }

  const normalized = Math.max(0, Math.min(raw, maxRaw));
  return { raw, maxRaw, normalized, reasons };
}

// ── 보조 함수 ──

function calcRSI(closes: number[], period: number): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 0; i < period; i++) {
    const diff = closes[i] - closes[i + 1]; // 최신이 앞
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function checkMacdGoldenCross(closes: number[]): boolean {
  const sma = (start: number, period: number) => {
    let sum = 0;
    for (let i = start; i < start + period; i++) sum += closes[i];
    return sum / period;
  };
  // 최근 3일 체크
  for (let d = 0; d < 3; d++) {
    if (closes.length < d + 21) break;
    const sma5Now = sma(d, 5);
    const sma20Now = sma(d, 20);
    const sma5Prev = sma(d + 1, 5);
    const sma20Prev = sma(d + 1, 20);
    if (sma5Now > sma20Now && sma5Prev <= sma20Prev) return true;
  }
  return false;
}

function calcBollingerBands(closes: number[], period: number): { upper: number | null; lower: number | null } {
  if (closes.length < period) return { upper: null, lower: null };
  const slice = closes.slice(0, period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
  const stddev = Math.sqrt(variance);
  return { upper: mean + 2 * stddev, lower: mean - 2 * stddev };
}
```

- [ ] **Step 2: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/lib/unified-scoring/signal-tech-score.ts
git commit -m "feat: 신호·기술 스코어 모듈 구현"
```

---

## Task 4: 수급 스코어 모듈

**Files:**
- Create: `web/src/lib/unified-scoring/supply-score.ts`

- [ ] **Step 1: 모듈 생성**

기존 `web/src/lib/ai-recommendation/supply-score.ts`와 `web/src/lib/scoring/supply-score-additions.ts`를 참고하되, 설계 문서 섹션 2.2 "수급" 스펙대로 새로 작성한다.

```typescript
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
      // 대형주: 시총 대비 비율, 중소형: 절대량
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
    // 외국인 streak: 이전 음수 → 현재 양수 1~2일
    if (input.foreignStreak !== null && input.foreignStreak > 0 && input.foreignStreak <= 3) {
      // 전환 초기로 판단 (streak 1~3은 전환 시점)
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

  // 거래대금 (0~5)
  if (input.tradingValue !== null) {
    const billionWon = input.tradingValue / 1_000_000_000;
    if (billionWon >= 100) {
      raw += 5;
      reasons.push({ label: '거래대금 활발', points: 5, detail: `${billionWon.toFixed(0)}억원`, met: true });
    } else if (billionWon >= 50) {
      raw += 3;
      reasons.push({ label: '거래대금 보통', points: 3, detail: `${billionWon.toFixed(0)}억원`, met: true });
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
```

- [ ] **Step 2: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/lib/unified-scoring/supply-score.ts
git commit -m "feat: 수급 스코어 모듈 구현"
```

---

## Task 5: 가치·성장 스코어 모듈

**Files:**
- Create: `web/src/lib/unified-scoring/value-growth-score.ts`

- [ ] **Step 1: 모듈 생성**

기존 `web/src/lib/ai-recommendation/valuation-score.ts`, `earnings-momentum-score.ts`, `web/src/lib/scoring/valuation-score-additions.ts`를 참고하되, 설계 문서 섹션 2.2 "가치·성장" 스펙대로 새로 작성. 특히 `roe_estimated`, `forward_eps`, DART 성장률 데이터를 실제 활용.

```typescript
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

  // ROE 개선 (이미 위에서 처리 — 중복 방지)

  const normalized = Math.max(0, Math.min(raw, maxRaw));
  return { raw, maxRaw, normalized, reasons };
}
```

- [ ] **Step 2: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/lib/unified-scoring/value-growth-score.ts
git commit -m "feat: 가치·성장 스코어 모듈 구현 (roe_estimated, forward_eps, DART 성장률 활용)"
```

---

## Task 6: 모멘텀 스코어 모듈

**Files:**
- Create: `web/src/lib/unified-scoring/momentum-score.ts`

- [ ] **Step 1: 모듈 생성**

기존 `web/src/lib/ai-recommendation/short-term/momentum-score.ts`를 참고하되, 설계 문서 섹션 2.2 "모멘텀" 스펙대로 새로 작성.

```typescript
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
    if (input.priceChangePct >= 3) {
      raw += 15;
      reasons.push({ label: '강한 상승', points: 15, detail: `${input.priceChangePct.toFixed(1)}%`, met: true });
    } else if (input.priceChangePct >= 1) {
      raw += 10;
      reasons.push({ label: '상승', points: 10, detail: `${input.priceChangePct.toFixed(1)}%`, met: true });
    } else if (input.priceChangePct >= 0) {
      raw += 5;
      reasons.push({ label: '보합/소폭 상승', points: 5, detail: `${input.priceChangePct.toFixed(1)}%`, met: true });
    } else {
      reasons.push({ label: '하락', points: 0, detail: `${input.priceChangePct.toFixed(1)}%`, met: false });
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
    if (today.close > today.open) {
      raw += 5;
      reasons.push({ label: '양봉', points: 5, detail: `시${today.open} → 종${today.close}`, met: true });
    }
  }
  if (input.gapPct !== null && input.gapPct > 1) {
    raw += 5;
    reasons.push({ label: '갭업', points: 5, detail: `${input.gapPct.toFixed(1)}%`, met: true });
  }

  // 박스 돌파 (0~10)
  if (prices.length >= 20) {
    const recent20High = Math.max(...prices.slice(1, 21).map(p => p.high));
    if (prices[0].close > recent20High) {
      raw += 10;
      reasons.push({ label: '박스 돌파', points: 10, detail: `종가 ${prices[0].close} > 20일고가 ${recent20High}`, met: true });
    }
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
```

- [ ] **Step 2: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/lib/unified-scoring/momentum-score.ts
git commit -m "feat: 모멘텀 스코어 모듈 구현"
```

---

## Task 7: 리스크 감점 모듈

**Files:**
- Create: `web/src/lib/unified-scoring/risk-score.ts`

- [ ] **Step 1: 모듈 생성**

기존 `web/src/lib/ai-recommendation/risk-score.ts`와 `web/src/lib/scoring/risk-score.ts`를 통합. DART 리스크(관리종목, CB/BW, 감사의견)도 포함.

```typescript
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

  // 대주주 지분율 낮음: -5
  if (input.majorShareholderPct !== null && input.majorShareholderPct < 20) {
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
```

- [ ] **Step 2: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/lib/unified-scoring/risk-score.ts
git commit -m "feat: 리스크 감점 모듈 구현 (기술과열 + 수급이탈 + DART 통합)"
```

---

## Task 8: 통합 스코어링 엔진

**Files:**
- Create: `web/src/lib/unified-scoring/engine.ts`

- [ ] **Step 1: 엔진 생성**

5개 카테고리 모듈을 조합하고, 체크리스트 조건 평가를 reasons에서 추출하며, 최종 점수를 계산한다.

```typescript
// web/src/lib/unified-scoring/engine.ts
import type { ScoringInput, UnifiedScoreResult, StyleWeights, CategoryKey } from './types';
import { calcGrade } from './types';
import { getPreset, type StyleId } from './presets';
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
  const checklist = extractChecklist(categories);
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
): ConditionResult[] {
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
  };

  return ALL_CONDITIONS.map(cond => {
    const mapping = conditionMap[cond.id];
    if (!mapping) {
      return { id: cond.id, label: cond.label, category: cond.category, met: false, detail: '', na: true };
    }

    const reasons = categories[mapping.category].reasons;
    const matched = reasons.find(r => r.label.includes(mapping.labelPattern));

    if (!matched) {
      return { id: cond.id, label: cond.label, category: cond.category, met: false, detail: '데이터 없음', na: true };
    }

    // 리스크 조건은 met 의미가 반대: reason.met=true면 "위험 없음" = 체크리스트 충족
    const met = mapping.category === 'risk' ? matched.met : matched.met;
    return { id: cond.id, label: cond.label, category: cond.category, met, detail: matched.detail, na: false };
  });
}
```

- [ ] **Step 2: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/lib/unified-scoring/engine.ts
git commit -m "feat: 통합 스코어링 엔진 구현 (4카테고리 + 리스크 + 체크리스트 매핑)"
```

---

## Task 9: API 라우트 수정

**Files:**
- Modify: `web/src/app/api/v1/stock-ranking/route.ts`

- [ ] **Step 1: stock-ranking API에 통합 스코어링 연결**

기존 `calcScore()` 인라인 함수(약 300줄)를 `calcUnifiedScore()` 호출로 교체한다. `style` 쿼리 파라미터를 추가하고, 응답에 `categories`, `reasons`, `checklist` 필드를 포함한다.

주요 변경점:
1. import 추가: `import { calcUnifiedScore } from '@/lib/unified-scoring/engine'`와 관련 타입
2. GET 핸들러에서 `searchParams.get('style')` 읽기 (기본값 `'balanced'`)
3. `mode=checklist` 분기 제거 (체크리스트가 기본 응답에 포함됨)
4. 기존 `calcScore()` 함수 호출 부분을 `calcUnifiedScore()` 호출로 교체
5. `stock_dart_info` 테이블 조인 추가하여 DART 데이터를 `ScoringInput`에 전달
6. 응답 `StockRankItem`에 `categories`, `checklist` 필드 추가

기존 `calcScore()` 함수는 삭제하지 않고 주석으로 보존한다 (롤백 대비).

이 파일은 428줄로 크므로, 실제 구현 시 에이전트가 파일 전체를 읽고 정확한 편집 위치를 결정해야 한다.

핵심 변경:
- `stock_dart_info` 테이블을 `stock_cache`와 LEFT JOIN하여 DART 데이터 로드
- `signals` 테이블에서 30일 BUY 신호 소스 목록(`signalSources`)과 최근 신호 일수(`latestSignalDaysAgo`) 계산
- `daily_prices` 테이블에서 최근 65일 가격 데이터 로드
- 위 데이터를 `ScoringInput`으로 변환 후 `calcUnifiedScore(input, style)` 호출
- 결과를 기존 `StockRankItem` 호환 형태로 매핑 (score_total, score_signal → signalTech 등)

`StockRankItem` 인터페이스에 추가할 필드:

```typescript
// StockRankItem에 추가
categories?: {
  signalTech: { normalized: number; reasons: ScoreReason[] };
  supply: { normalized: number; reasons: ScoreReason[] };
  valueGrowth: { normalized: number; reasons: ScoreReason[] };
  momentum: { normalized: number; reasons: ScoreReason[] };
  risk: { normalized: number; reasons: ScoreReason[] };
};
checklist?: ConditionResult[];
checklistMet?: number;
checklistTotal?: number;
appliedStyle?: string;
```

- [ ] **Step 2: 빌드 확인**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web && npm run build 2>&1 | head -50
```

Expected: 빌드 성공 (타입 에러 없음)

- [ ] **Step 3: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/app/api/v1/stock-ranking/route.ts
git commit -m "feat: stock-ranking API에 통합 스코어링 엔진 연결 + style 파라미터 추가"
```

---

## Task 10: 프론트엔드 훅 (use-unified-ranking, use-score-history)

**Files:**
- Create: `web/src/hooks/use-unified-ranking.ts`
- Create: `web/src/hooks/use-score-history.ts`

- [ ] **Step 1: use-unified-ranking 생성**

기존 `use-stock-ranking.ts`를 참고하되 `style` 파라미터를 추가한다.

```typescript
// web/src/hooks/use-unified-ranking.ts
'use client';

import { useState, useCallback } from 'react';
import type { StockRankItem } from '@/app/api/v1/stock-ranking/route';

export interface UnifiedRankingResponse {
  items: StockRankItem[];
  total: number;
  snapshot_time?: string | null;
  updating?: boolean;
}

const cache = new Map<string, { data: UnifiedRankingResponse; ts: number }>();
const inflight = new Map<string, Promise<UnifiedRankingResponse | null>>();
const CACHE_TTL = 15_000;

export function useUnifiedRanking() {
  const [data, setData] = useState<UnifiedRankingResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const doFetch = useCallback(async (style: string, date: string, market: string) => {
    const key = `${style}:${date}:${market}`;

    const cached = cache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setData(cached.data);
      return;
    }

    setLoading(true);
    try {
      let promise = inflight.get(key);
      if (!promise) {
        promise = (async () => {
          const params = new URLSearchParams({ style, date });
          if (market !== 'all') params.set('market', market);
          const res = await window.fetch(`/api/v1/stock-ranking?${params}`);
          if (!res.ok) return null;
          const result: UnifiedRankingResponse = await res.json();
          cache.set(key, { data: result, ts: Date.now() });
          return result;
        })();
        inflight.set(key, promise);
      }

      const result = await promise;
      if (result) setData(result);
    } finally {
      inflight.delete(key);
      setLoading(false);
    }
  }, []);

  /** 캐시 무효화 (스타일 변경 시) */
  const invalidate = useCallback(() => {
    cache.clear();
  }, []);

  return { data, loading, doFetch, invalidate };
}
```

- [ ] **Step 2: use-score-history 생성**

스냅샷 세션에서 최근 7일 점수 추이를 가져온다.

```typescript
// web/src/hooks/use-score-history.ts
'use client';

import { useState, useCallback } from 'react';

export interface ScoreHistoryPoint {
  date: string;
  score: number;
}

const historyCache = new Map<string, { data: ScoreHistoryPoint[]; ts: number }>();
const CACHE_TTL = 60_000; // 1분

export function useScoreHistory() {
  const [history, setHistory] = useState<ScoreHistoryPoint[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchHistory = useCallback(async (symbol: string) => {
    const cached = historyCache.get(symbol);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setHistory(cached.data);
      return;
    }

    setLoading(true);
    try {
      const res = await window.fetch(`/api/v1/stock-ranking/sessions?symbol=${symbol}&limit=7`);
      if (!res.ok) { setHistory([]); return; }
      const data: { date: string; score: number }[] = await res.json();
      historyCache.set(symbol, { data, ts: Date.now() });
      setHistory(data);
    } catch {
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return { history, loading, fetchHistory };
}
```

- [ ] **Step 3: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/hooks/use-unified-ranking.ts web/src/hooks/use-score-history.ts
git commit -m "feat: 통합 랭킹 + 점수 추이 프론트엔드 훅"
```

---

## Task 11: StyleSelector 컴포넌트

**Files:**
- Create: `web/src/components/signals/StyleSelector.tsx`

- [ ] **Step 1: 컴포넌트 생성**

5개 기본 프리셋 드롭다운 + 커스텀 목록 + 슬라이더 편집 UI.

```typescript
// web/src/components/signals/StyleSelector.tsx
'use client';

import { useState, useCallback } from 'react';
import {
  STYLE_PRESETS,
  loadCustomPresets,
  saveCustomPreset,
  deleteCustomPreset,
  validateWeights,
} from '@/lib/unified-scoring/presets';
import type { StyleWeights, CustomPreset } from '@/lib/unified-scoring/types';

interface Props {
  currentStyleId: string;
  onStyleChange: (styleId: string, weights?: StyleWeights) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  signalTech: '신호·기술',
  supply: '수급',
  valueGrowth: '가치·성장',
  momentum: '모멘텀',
  risk: '리스크',
};

const CATEGORY_COLORS: Record<string, string> = {
  signalTech: 'bg-blue-500',
  supply: 'bg-green-500',
  valueGrowth: 'bg-yellow-500',
  momentum: 'bg-red-500',
  risk: 'bg-gray-500',
};

export function StyleSelector({ currentStyleId, onStyleChange }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editWeights, setEditWeights] = useState<StyleWeights>({ signalTech: 22, supply: 22, valueGrowth: 22, momentum: 19, risk: 15 });
  const [editName, setEditName] = useState('');
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>(() => loadCustomPresets());

  const currentPreset = STYLE_PRESETS.find(p => p.id === currentStyleId);
  const currentCustom = customPresets.find(p => p.id === currentStyleId);
  const displayName = currentPreset?.name ?? currentCustom?.name ?? '커스텀';

  const handleSelect = (id: string, weights?: StyleWeights) => {
    onStyleChange(id, weights);
    setIsOpen(false);
    setEditing(false);
  };

  const handleSliderChange = (key: keyof StyleWeights, value: number) => {
    if (key === 'risk') {
      // 리스크 10~20 범위 제한
      const clamped = Math.max(10, Math.min(20, value));
      const diff = clamped - editWeights.risk;
      const others = ['signalTech', 'supply', 'valueGrowth', 'momentum'] as const;
      const otherSum = others.reduce((sum, k) => sum + editWeights[k], 0);
      if (otherSum - diff <= 0) return;

      const newWeights = { ...editWeights, risk: clamped };
      // 나머지를 비례 조정
      others.forEach(k => {
        newWeights[k] = Math.round(editWeights[k] * ((otherSum - diff) / otherSum));
      });
      // 반올림 오차 보정
      const newOtherSum = others.reduce((sum, k) => sum + newWeights[k], 0);
      const target = 100 - clamped;
      if (newOtherSum !== target) {
        newWeights[others[0]] += target - newOtherSum;
      }
      setEditWeights(newWeights);
    } else {
      const maxForKey = 100 - editWeights.risk;
      const clamped = Math.max(0, Math.min(maxForKey, value));
      const others = (['signalTech', 'supply', 'valueGrowth', 'momentum'] as const).filter(k => k !== key);
      const oldOtherSum = others.reduce((sum, k) => sum + editWeights[k], 0);
      const newOtherTarget = maxForKey - clamped;

      const newWeights = { ...editWeights, [key]: clamped };
      if (oldOtherSum > 0) {
        others.forEach(k => {
          newWeights[k] = Math.round(editWeights[k] * (newOtherTarget / oldOtherSum));
        });
        const sum = others.reduce((s, k) => s + newWeights[k], 0);
        if (sum !== newOtherTarget) newWeights[others[0]] += newOtherTarget - sum;
      }
      setEditWeights(newWeights);
    }
  };

  const handleSave = () => {
    if (!editName.trim() || !validateWeights(editWeights)) return;
    const id = `custom_${Date.now()}`;
    const preset: CustomPreset = { id, name: editName.trim(), weights: editWeights };
    const updated = saveCustomPreset(preset);
    setCustomPresets(updated);
    handleSelect(id, editWeights);
    setEditing(false);
  };

  const handleDelete = (id: string) => {
    const updated = deleteCustomPreset(id);
    setCustomPresets(updated);
    if (currentStyleId === id) handleSelect('balanced');
  };

  return (
    <div className="relative">
      {/* 드롭다운 트리거 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--card-hover)] transition-colors"
      >
        <span>{displayName}</span>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* 드롭다운 메뉴 */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-64 rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg">
          {/* 기본 프리셋 */}
          {STYLE_PRESETS.map(preset => (
            <button
              key={preset.id}
              onClick={() => handleSelect(preset.id)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--card-hover)] ${currentStyleId === preset.id ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : ''}`}
            >
              <div className="font-medium">{preset.name}</div>
              <div className="text-xs text-[var(--muted)]">{preset.description}</div>
            </button>
          ))}

          {/* 구분선 */}
          {customPresets.length > 0 && <div className="border-t border-[var(--border)] my-1" />}

          {/* 커스텀 프리셋 */}
          {customPresets.map(preset => (
            <div key={preset.id} className="flex items-center justify-between px-3 py-2 hover:bg-[var(--card-hover)]">
              <button
                onClick={() => handleSelect(preset.id, preset.weights)}
                className={`text-left text-sm flex-1 ${currentStyleId === preset.id ? 'text-[var(--accent)]' : ''}`}
              >
                {preset.name}
              </button>
              <button onClick={() => handleDelete(preset.id)} className="text-xs text-[var(--muted)] hover:text-red-500 ml-2">삭제</button>
            </div>
          ))}

          {/* 새 스타일 만들기 */}
          <div className="border-t border-[var(--border)] mt-1">
            <button
              onClick={() => { setEditing(true); setIsOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm font-medium text-[var(--accent)] hover:bg-[var(--card-hover)]"
            >
              + 새 스타일 만들기
            </button>
          </div>
        </div>
      )}

      {/* 슬라이더 편집 UI */}
      {editing && (
        <div className="mt-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--card)] space-y-3">
          <input
            type="text"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            placeholder="스타일 이름"
            className="w-full px-2 py-1 text-sm rounded border border-[var(--border)] bg-transparent"
          />
          {(Object.keys(CATEGORY_LABELS) as (keyof StyleWeights)[]).map(key => (
            <div key={key} className="flex items-center gap-2">
              <span className="text-xs w-16 text-[var(--muted)]">{CATEGORY_LABELS[key]}</span>
              <div className={`w-2 h-2 rounded-full ${CATEGORY_COLORS[key]}`} />
              <input
                type="range"
                min={key === 'risk' ? 10 : 0}
                max={key === 'risk' ? 20 : 60}
                value={editWeights[key]}
                onChange={e => handleSliderChange(key, Number(e.target.value))}
                className="flex-1"
              />
              <span className="text-xs w-8 text-right font-mono">{editWeights[key]}</span>
            </div>
          ))}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setEditing(false)} className="px-3 py-1 text-xs rounded border border-[var(--border)]">취소</button>
            <button onClick={handleSave} className="px-3 py-1 text-xs rounded bg-[var(--accent)] text-white">저장</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/components/signals/StyleSelector.tsx
git commit -m "feat: 트레이딩 스타일 셀렉터 컴포넌트"
```

---

## Task 12: AnalysisHoverCard 컴포넌트

**Files:**
- Create: `web/src/components/signals/AnalysisHoverCard.tsx`

- [ ] **Step 1: 호버 카드 생성**

4축 레이더 차트 + 7일 추이 미니차트 + 체크리스트 요약. recharts의 `RadarChart`와 `LineChart` 사용.

```typescript
// web/src/components/signals/AnalysisHoverCard.tsx
'use client';

import { useMemo } from 'react';
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer,
  LineChart, Line, YAxis,
} from 'recharts';
import type { StockRankItem } from '@/app/api/v1/stock-ranking/route';
import type { ScoreHistoryPoint } from '@/hooks/use-score-history';
import type { ConditionResult } from '@/lib/checklist-recommendation/types';

interface Props {
  item: StockRankItem;
  history: ScoreHistoryPoint[];
}

const CATEGORY_LABELS = {
  signalTech: '신호·기술',
  supply: '수급',
  valueGrowth: '가치·성장',
  momentum: '모멘텀',
};

export function AnalysisHoverCard({ item, history }: Props) {
  const radarData = useMemo(() => {
    if (!item.categories) return [];
    return [
      { category: '신호·기술', value: item.categories.signalTech.normalized },
      { category: '수급', value: item.categories.supply.normalized },
      { category: '가치·성장', value: item.categories.valueGrowth.normalized },
      { category: '모멘텀', value: item.categories.momentum.normalized },
    ];
  }, [item.categories]);

  const riskScore = item.categories?.risk?.normalized ?? 0;
  const checklist = item.checklist ?? [];
  const checklistMet = item.checklistMet ?? 0;
  const checklistTotal = item.checklistTotal ?? 0;

  return (
    <div className="w-[380px] p-3 rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-xl text-sm">
      {/* 상단: 레이더 + 추이 */}
      <div className="flex gap-3 mb-2">
        {/* 레이더 차트 */}
        <div className="w-[170px] h-[140px]">
          <ResponsiveContainer>
            <RadarChart data={radarData}>
              <PolarGrid stroke="var(--border)" />
              <PolarAngleAxis dataKey="category" tick={{ fontSize: 10, fill: 'var(--muted)' }} />
              <Radar dataKey="value" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* 추이 + 리스크 */}
        <div className="flex-1 flex flex-col justify-between">
          {history.length > 1 ? (
            <div className="h-[80px]">
              <ResponsiveContainer>
                <LineChart data={history}>
                  <YAxis domain={[0, 100]} hide />
                  <Line type="monotone" dataKey="score" stroke="var(--accent)" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
              <div className="text-xs text-[var(--muted)] text-center">7일 추이</div>
            </div>
          ) : (
            <div className="h-[80px] flex items-center justify-center text-xs text-[var(--muted)]">추이 데이터 없음</div>
          )}
          <div className="text-xs mt-1">
            리스크: <span className="text-red-400 font-medium">-{Math.round(riskScore * 0.15)}점</span>
          </div>
        </div>
      </div>

      {/* 하단: 체크리스트 */}
      <div className="border-t border-[var(--border)] pt-2">
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          {checklist.map(c => (
            <span key={c.id} className={`text-xs ${c.na ? 'text-[var(--muted)]' : c.met ? 'text-green-400' : 'text-red-400'}`}>
              {c.na ? '·' : c.met ? '✓' : '✗'}{c.label.replace(/\s/g, '')}
            </span>
          ))}
        </div>
        <div className="text-xs text-[var(--muted)] mt-1">{checklistMet}/{checklistTotal} 충족</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/components/signals/AnalysisHoverCard.tsx
git commit -m "feat: 종목 호버 카드 (레이더차트 + 추이 + 체크리스트)"
```

---

## Task 13: StockAnalysisSection 메인 컴포넌트

**Files:**
- Create: `web/src/components/signals/StockAnalysisSection.tsx`

- [ ] **Step 1: 메인 컴포넌트 생성**

종목분석 탭의 최상위 컴포넌트. StyleSelector + 필터 + 종목 리스트 + 호버 카드 통합.

이 컴포넌트는 기존 `UnifiedAnalysisSection.tsx`의 레이아웃 패턴(리스트 렌더링, 정렬, 검색, 시장 필터)을 따르되 다음이 다름:
- `useUnifiedRanking` 훅 사용 (style 파라미터 포함)
- 각 행에 4대분류 미니바 + 등급 배지
- 호버 시 `AnalysisHoverCard` 표시 (300ms 딜레이, `useScoreHistory`로 추이 로드)
- 클릭 시 `openStockModal` 호출 (기존 동작 유지)

이 파일은 크므로 (200~300줄 예상), 에이전트가 기존 `UnifiedAnalysisSection.tsx`를 참고하여 리스트 렌더링/필터/정렬/검색 패턴을 재사용한다.

핵심 구조:

```typescript
// web/src/components/signals/StockAnalysisSection.tsx
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useUnifiedRanking } from '@/hooks/use-unified-ranking';
import { useScoreHistory } from '@/hooks/use-score-history';
import { StyleSelector } from './StyleSelector';
import { AnalysisHoverCard } from './AnalysisHoverCard';
import { useStockModal } from '@/contexts/stock-modal-context';
import type { StockRankItem } from '@/app/api/v1/stock-ranking/route';
import type { StyleWeights } from '@/lib/unified-scoring/types';
// ... 추가 import

interface Props {
  initialDateMode?: 'today' | 'signal_all';
  favoriteSymbols: string[];
  watchlistSymbols: string[];
  groups: WatchlistGroup[];
  symbolGroups: Record<string, string[]>;
}

export function StockAnalysisSection({ initialDateMode = 'today', ...props }: Props) {
  const [styleId, setStyleId] = useState('balanced');
  const [customWeights, setCustomWeights] = useState<StyleWeights | undefined>();
  const [dateMode, setDateMode] = useState(initialDateMode);
  const [market, setMarket] = useState('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'score' | 'name' | 'change'>('score');

  const { data, loading, doFetch } = useUnifiedRanking();
  const { history, fetchHistory } = useScoreHistory();
  const { openStockModal } = useStockModal();

  // 호버 상태
  const [hoveredItem, setHoveredItem] = useState<StockRankItem | null>(null);
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // 데이터 로드
  useEffect(() => {
    doFetch(styleId, dateMode, market);
  }, [styleId, dateMode, market, doFetch]);

  const handleStyleChange = useCallback((id: string, weights?: StyleWeights) => {
    setStyleId(id);
    setCustomWeights(weights);
  }, []);

  // 필터 + 정렬
  const filteredItems = /* data?.items 필터/정렬 로직 - UnifiedAnalysisSection 패턴 참고 */;

  // 호버 핸들러
  const handleMouseEnter = (item: StockRankItem, e: React.MouseEvent) => {
    hoverTimerRef.current = setTimeout(() => {
      setHoveredItem(item);
      setHoverPosition({ x: e.clientX, y: e.clientY });
      fetchHistory(item.symbol);
    }, 300);
  };

  const handleMouseLeave = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHoveredItem(null);
  };

  // 클릭 → 모달
  const handleClick = (item: StockRankItem) => {
    openStockModal(item.symbol, item.name, item);
  };

  return (
    <div className="space-y-4">
      {/* 상단 컨트롤 */}
      <div className="flex flex-wrap items-center gap-3">
        <StyleSelector currentStyleId={styleId} onStyleChange={handleStyleChange} />
        {/* 시장 필터, 날짜모드, 검색 — UnifiedAnalysisSection 패턴 참고 */}
      </div>

      {/* 종목 리스트 */}
      <div className="space-y-1">
        {filteredItems?.map((item, idx) => (
          <div
            key={item.symbol}
            onMouseEnter={e => handleMouseEnter(item, e)}
            onMouseLeave={handleMouseLeave}
            onClick={() => handleClick(item)}
            className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--card-hover)] cursor-pointer transition-colors"
          >
            {/* 순위 */}
            <span className="w-8 text-center text-sm text-[var(--muted)] font-mono">{idx + 1}</span>

            {/* 종목명 */}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{item.name}</div>
              <div className="text-xs text-[var(--muted)]">{item.symbol}</div>
            </div>

            {/* 현재가 + 등락률 */}
            <div className="text-right">
              <div className="text-sm font-mono">{item.current_price?.toLocaleString()}</div>
              <div className={`text-xs ${(item.price_change_pct ?? 0) >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                {(item.price_change_pct ?? 0) >= 0 ? '+' : ''}{item.price_change_pct?.toFixed(2)}%
              </div>
            </div>

            {/* 총점 바 */}
            <div className="w-24">
              <div className="flex items-center gap-1">
                <div className="flex-1 h-2 rounded-full bg-[var(--border)] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${item.score_total}%`,
                      backgroundColor: getGradeColor(item.grade ?? 'D'),
                    }}
                  />
                </div>
                <span className="text-xs font-mono w-8 text-right">{item.score_total}</span>
              </div>
            </div>

            {/* 4대분류 미니바 */}
            {item.categories && (
              <div className="flex gap-0.5 w-16">
                <MiniBar value={item.categories.signalTech.normalized} color="#3b82f6" />
                <MiniBar value={item.categories.supply.normalized} color="#22c55e" />
                <MiniBar value={item.categories.valueGrowth.normalized} color="#eab308" />
                <MiniBar value={item.categories.momentum.normalized} color="#ef4444" />
              </div>
            )}

            {/* 등급 뱃지 */}
            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${getGradeBadgeClass(item.grade ?? 'D')}`}>
              {item.grade ?? 'D'}
            </span>
          </div>
        ))}
      </div>

      {/* 호버 카드 */}
      {hoveredItem && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{ left: hoverPosition.x + 16, top: hoverPosition.y - 100 }}
        >
          <AnalysisHoverCard item={hoveredItem} history={history} />
        </div>
      )}
    </div>
  );
}

function MiniBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex-1 h-3 rounded-sm bg-[var(--border)] overflow-hidden">
      <div className="h-full rounded-sm" style={{ width: `${value}%`, backgroundColor: color }} />
    </div>
  );
}

function getGradeColor(grade: string): string {
  switch (grade) {
    case 'A+': return '#8b5cf6';
    case 'A': return '#3b82f6';
    case 'B+': return '#22c55e';
    case 'B': return '#22c55e';
    case 'C': return '#eab308';
    default: return '#6b7280';
  }
}

function getGradeBadgeClass(grade: string): string {
  switch (grade) {
    case 'A+': return 'bg-purple-500/20 text-purple-400';
    case 'A': return 'bg-blue-500/20 text-blue-400';
    case 'B+': case 'B': return 'bg-green-500/20 text-green-400';
    case 'C': return 'bg-yellow-500/20 text-yellow-400';
    default: return 'bg-gray-500/20 text-gray-400';
  }
}
```

에이전트는 기존 `UnifiedAnalysisSection.tsx`의 필터/정렬/검색 로직, StockActionMenu 연동, 즐겨찾기/관심종목 UI 패턴을 그대로 재사용해야 한다.

- [ ] **Step 2: 빌드 확인**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web && npm run build 2>&1 | head -50
```

- [ ] **Step 3: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/components/signals/StockAnalysisSection.tsx
git commit -m "feat: 종목분석 메인 컴포넌트 (스타일 셀렉터 + 리스트 + 호버카드)"
```

---

## Task 14: UnifiedScoreCard 컴포넌트 (상세 패널)

**Files:**
- Create: `web/src/components/stock-modal/UnifiedScoreCard.tsx`

- [ ] **Step 1: 점수 카드 생성**

기존 `AiOpinionCard.tsx`의 레이아웃 패턴을 참고하되, 4대 카테고리 아코디언 + 체크리스트 섹션으로 재구성.

```typescript
// web/src/components/stock-modal/UnifiedScoreCard.tsx
'use client';

import { useState, useMemo } from 'react';
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer,
  LineChart, Line, YAxis,
} from 'recharts';
import type { StockRankItem } from '@/app/api/v1/stock-ranking/route';
import type { ScoreReason } from '@/types/score-reason';
import type { ConditionResult } from '@/lib/checklist-recommendation/types';
import type { ScoreHistoryPoint } from '@/hooks/use-score-history';

interface Props {
  data: StockRankItem;
  history: ScoreHistoryPoint[];
}

const CATEGORIES = [
  { key: 'signalTech', label: '신호·기술', color: '#3b82f6' },
  { key: 'supply', label: '수급', color: '#22c55e' },
  { key: 'valueGrowth', label: '가치·성장', color: '#eab308' },
  { key: 'momentum', label: '모멘텀', color: '#ef4444' },
  { key: 'risk', label: '리스크', color: '#6b7280' },
] as const;

const CHECKLIST_GROUPS = [
  { label: '트렌드', ids: ['ma_aligned', 'rsi_buy_zone', 'macd_golden'] },
  { label: '수급', ids: ['foreign_buy', 'institution_buy', 'volume_active'] },
  { label: '밸류에이션', ids: ['per_fair', 'target_upside', 'roe_good'] },
  { label: '리스크', ids: ['no_overbought', 'no_surge', 'no_smart_exit'] },
];

export function UnifiedScoreCard({ data, history }: Props) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const categories = data.categories;
  const checklist = data.checklist ?? [];
  const weights = data.categories ? {
    signalTech: 22, supply: 22, valueGrowth: 22, momentum: 19, risk: 15
  } : null;

  const radarData = useMemo(() => {
    if (!categories) return [];
    return [
      { category: '신호·기술', value: categories.signalTech.normalized },
      { category: '수급', value: categories.supply.normalized },
      { category: '가치·성장', value: categories.valueGrowth.normalized },
      { category: '모멘텀', value: categories.momentum.normalized },
    ];
  }, [categories]);

  if (!categories) return null;

  const riskPenalty = Math.round(categories.risk.normalized * 0.15);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
      {/* 총점 헤더 */}
      <div className="p-4 border-b border-[var(--border)]">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold">{data.score_total}점</span>
            <span className={`text-sm font-bold px-2 py-0.5 rounded ${getGradeBadgeClass(data.grade ?? 'D')}`}>
              {data.grade}
            </span>
          </div>
          <span className="text-xs text-[var(--muted)]">스타일: {data.appliedStyle ?? '균형형'}</span>
        </div>
        <div className="h-2 rounded-full bg-[var(--border)] overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{ width: `${data.score_total}%`, backgroundColor: getGradeColor(data.grade ?? 'D') }}
          />
        </div>
      </div>

      {/* 레이더 + 추이 */}
      <div className="flex gap-2 p-4 border-b border-[var(--border)]">
        <div className="w-1/2 h-[160px]">
          <ResponsiveContainer>
            <RadarChart data={radarData}>
              <PolarGrid stroke="var(--border)" />
              <PolarAngleAxis dataKey="category" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <Radar dataKey="value" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <div className="w-1/2 flex flex-col">
          {history.length > 1 ? (
            <div className="flex-1">
              <ResponsiveContainer>
                <LineChart data={history}>
                  <YAxis domain={[0, 100]} hide />
                  <Line type="monotone" dataKey="score" stroke="var(--accent)" strokeWidth={1.5} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
              <div className="text-xs text-[var(--muted)] text-center">7일 추이</div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-[var(--muted)]">추이 데이터 없음</div>
          )}
          <div className="text-sm mt-2">
            리스크 감점: <span className="text-red-400 font-bold">-{riskPenalty}점</span>
          </div>
        </div>
      </div>

      {/* 카테고리별 아코디언 */}
      <div className="divide-y divide-[var(--border)]">
        {CATEGORIES.map(({ key, label, color }) => {
          const cat = categories[key as keyof typeof categories];
          const isRisk = key === 'risk';
          const weightPct = weights ? weights[key as keyof typeof weights] : 0;
          const contribution = isRisk
            ? -riskPenalty
            : Math.round(cat.normalized * weightPct / (100 - (weights?.risk ?? 15)) * 100) / 100;

          return (
            <div key={key}>
              <button
                onClick={() => setExpandedCategory(expandedCategory === key ? null : key)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--card-hover)] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-sm font-medium">{label}</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className={isRisk ? 'text-red-400' : ''}>{isRisk ? `-${cat.normalized}` : cat.normalized}점</span>
                  <span className="text-xs text-[var(--muted)]">
                    (×{weightPct}% = {contribution > 0 ? '+' : ''}{contribution.toFixed(1)})
                  </span>
                  <svg className={`w-4 h-4 transition-transform ${expandedCategory === key ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {expandedCategory === key && (
                <div className="px-4 pb-3 space-y-1">
                  {cat.reasons.map((reason, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className={reason.met ? 'text-green-400' : 'text-red-400'}>
                        {reason.met ? '✓' : '✗'}
                      </span>
                      <span className="flex-1 text-[var(--text)]">{reason.label}</span>
                      <span className={`font-mono ${reason.points > 0 ? 'text-green-400' : reason.points < 0 ? 'text-red-400' : 'text-[var(--muted)]'}`}>
                        {reason.points > 0 ? '+' : ''}{reason.points}점
                      </span>
                      <span className="text-[var(--muted)] max-w-[120px] truncate">{reason.detail}</span>
                    </div>
                  ))}
                  <div className="text-xs text-[var(--muted)] pt-1 border-t border-[var(--border)]">
                    원점수: {cat.normalized}/100
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 체크리스트 */}
      <div className="p-4 border-t border-[var(--border)]">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium">체크리스트</span>
          <span className="text-xs text-[var(--muted)]">{data.checklistMet}/{data.checklistTotal} 충족</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {CHECKLIST_GROUPS.map(group => (
            <div key={group.label} className="rounded-lg border border-[var(--border)] p-2">
              <div className="text-xs font-medium text-[var(--muted)] mb-1">{group.label}</div>
              {group.ids.map(id => {
                const cond = checklist.find(c => c.id === id);
                if (!cond) return null;
                return (
                  <div key={id} className="flex items-center gap-1 text-xs">
                    <span className={cond.na ? 'text-[var(--muted)]' : cond.met ? 'text-green-400' : 'text-red-400'}>
                      {cond.na ? '·' : cond.met ? '✓' : '✗'}
                    </span>
                    <span>{cond.label}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* 최종 계산 */}
        <div className="mt-3 p-2 rounded-lg bg-[var(--background)] text-xs font-mono text-[var(--muted)]">
          ({CATEGORIES.filter(c => c.key !== 'risk').map(c => `${categories[c.key as keyof typeof categories].normalized}×${weights?.[c.key as keyof typeof weights] ?? 0}`).join(' + ')}) / {100 - (weights?.risk ?? 15)} − {riskPenalty} = {data.score_total}
        </div>
      </div>
    </div>
  );
}

function getGradeColor(grade: string): string {
  const map: Record<string, string> = { 'A+': '#8b5cf6', A: '#3b82f6', 'B+': '#22c55e', B: '#22c55e', C: '#eab308', D: '#6b7280' };
  return map[grade] ?? '#6b7280';
}

function getGradeBadgeClass(grade: string): string {
  const map: Record<string, string> = {
    'A+': 'bg-purple-500/20 text-purple-400',
    A: 'bg-blue-500/20 text-blue-400',
    'B+': 'bg-green-500/20 text-green-400',
    B: 'bg-green-500/20 text-green-400',
    C: 'bg-yellow-500/20 text-yellow-400',
    D: 'bg-gray-500/20 text-gray-400',
  };
  return map[grade] ?? 'bg-gray-500/20 text-gray-400';
}
```

- [ ] **Step 2: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/components/stock-modal/UnifiedScoreCard.tsx
git commit -m "feat: 상세 패널 UnifiedScoreCard (레이더+추이+아코디언+체크리스트)"
```

---

## Task 15: StockDetailPanel 수정

**Files:**
- Modify: `web/src/components/stock-modal/StockDetailPanel.tsx`

- [ ] **Step 1: import 변경**

```diff
- import { AiOpinionCard } from "./AiOpinionCard";
- import { SupplyDemandSection } from "./SupplyDemandSection";
- import { TechnicalSignalSection } from "./TechnicalSignalSection";
+ import { UnifiedScoreCard } from "./UnifiedScoreCard";
+ import { useScoreHistory } from "@/hooks/use-score-history";
```

- [ ] **Step 2: useScoreHistory 훅 추가**

컴포넌트 내부에 추가:

```typescript
const { history: scoreHistory, fetchHistory: fetchScoreHistory } = useScoreHistory();

// 종목 변경 시 점수 추이 로드
useEffect(() => {
  if (modal?.symbol) {
    fetchScoreHistory(modal.symbol);
  }
}, [modal?.symbol, fetchScoreHistory]);
```

- [ ] **Step 3: 좌측 컬럼 렌더링 교체**

기존 `AiOpinionCard`, `SupplyDemandSection`, `TechnicalSignalSection` 렌더링을 `UnifiedScoreCard`로 교체:

```diff
- {data && <AiOpinionCard data={data} scoreMode={modal?.scoreMode} shortTermScores={modal?.shortTermScores} />}
- <SupplyDemandSection data={data} />
- <TechnicalSignalSection data={data} signals={signals} />
+ {data && <UnifiedScoreCard data={data} history={scoreHistory} />}
```

- [ ] **Step 4: 빌드 확인**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web && npm run build 2>&1 | head -50
```

- [ ] **Step 5: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/components/stock-modal/StockDetailPanel.tsx
git commit -m "refactor: StockDetailPanel에서 AiOpinionCard/SupplyDemand/TechnicalSignal → UnifiedScoreCard 교체"
```

---

## Task 16: stock-modal-context 정리

**Files:**
- Modify: `web/src/contexts/stock-modal-context.tsx`

- [ ] **Step 1: scoreMode/shortTermScores 제거**

```diff
  interface StockModalState {
    symbol: string;
    name: string;
    initialData?: StockRankItem;
-   scoreMode?: 'standard' | 'short_term';
-   shortTermScores?: ShortTermDisplayScores;
  }

  interface StockModalContextValue {
    modal: StockModalState | null;
-   openStockModal: (symbol: string, name?: string, initialData?: StockRankItem, scoreMode?: 'standard' | 'short_term', shortTermScores?: ShortTermDisplayScores) => void;
+   openStockModal: (symbol: string, name?: string, initialData?: StockRankItem) => void;
    closeStockModal: () => void;
  }
```

`ShortTermDisplayScores` import도 제거.

- [ ] **Step 2: openStockModal 시그니처 정리**

```diff
  const openStockModal = useCallback(
-   (symbol: string, name = "", initialData?: StockRankItem, scoreMode?: 'standard' | 'short_term', shortTermScores?: ShortTermDisplayScores) => {
-     setModal({ symbol, name, initialData, scoreMode, shortTermScores });
+   (symbol: string, name = "", initialData?: StockRankItem) => {
+     setModal({ symbol, name, initialData });
    },
    []
  );
```

- [ ] **Step 3: 빌드 확인 — 호출부 확인**

`openStockModal` 호출부(`StockActionMenu`, `UnifiedAnalysisSection`, `ShortTermRecommendationSection` 등)에서 추가 파라미터 전달을 제거해야 한다. 에이전트가 `grep`으로 모든 호출부를 찾아 수정한다.

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/contexts/stock-modal-context.tsx web/src/components/common/stock-action-menu.tsx
git commit -m "refactor: stock-modal-context에서 scoreMode/shortTermScores 제거"
```

---

## Task 17: 탭 구조 변경 (RecommendationView + signals/page.tsx)

**Files:**
- Modify: `web/src/components/signals/RecommendationView.tsx`
- Modify: `web/src/app/signals/page.tsx`

- [ ] **Step 1: RecommendationView 수정**

3탭(종목추천/단기추천/체크리스트) → 1탭(종목분석)으로 변경:

```diff
- import { UnifiedAnalysisSection, type SignalMap } from './UnifiedAnalysisSection';
- import ShortTermRecommendationSection from './ShortTermRecommendationSection';
- import ChecklistSection from './ChecklistSection';
+ import { StockAnalysisSection } from './StockAnalysisSection';

  interface Props {
-   initialTab: 'analysis' | 'short-term' | 'checklist';
+   initialTab: 'analysis';
    initialDateMode?: 'today' | 'signal_all';
-   signalMap: SignalMap;
    favoriteSymbols: string[];
    watchlistSymbols: string[];
    groups: WatchlistGroup[];
    symbolGroups: Record<string, string[]>;
  }
```

탭 스위처에서 단기추천/체크리스트 버튼 제거, 종목추천 → 종목분석으로 레이블 변경:

```tsx
<button onClick={() => handleTabChange('analysis')} className={tabCls('analysis')}>
  종목분석
</button>
```

렌더링 부분:

```tsx
{activeTab === 'analysis' && (
  <StockAnalysisSection
    initialDateMode={initialDateMode}
    favoriteSymbols={favoriteSymbols}
    watchlistSymbols={watchlistSymbols}
    groups={groups}
    symbolGroups={symbolGroups}
  />
)}
```

- [ ] **Step 2: signals/page.tsx 수정**

`searchParams.tab`에서 `short-term`/`checklist` → `analysis`로 리다이렉트. `signalMap` fetch 로직 정리 (종목분석 탭은 자체적으로 stock-ranking API를 호출하므로 서버에서 signalMap을 불필요하게 fetch하지 않음).

- [ ] **Step 3: 빌드 확인**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web && npm run build 2>&1 | head -50
```

- [ ] **Step 4: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/components/signals/RecommendationView.tsx web/src/app/signals/page.tsx
git commit -m "refactor: 3탭(종목추천/단기추천/체크리스트) → 종목분석 단일 탭 통합"
```

---

## Task 18: 전체 빌드 검증 + 불필요 파일 정리

**Files:**
- Delete: `web/src/components/signals/ShortTermRecommendationSection.tsx`
- Delete: `web/src/components/signals/ChecklistSection.tsx`
- Delete: `web/src/hooks/use-checklist-ranking.ts`

- [ ] **Step 1: 사용되지 않는 import 확인**

삭제 대상 파일이 다른 곳에서 참조되는지 확인:

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web
grep -r "ShortTermRecommendationSection" src/ --include="*.tsx" --include="*.ts" | grep -v "ShortTermRecommendationSection.tsx"
grep -r "ChecklistSection" src/ --include="*.tsx" --include="*.ts" | grep -v "ChecklistSection.tsx"
grep -r "use-checklist-ranking" src/ --include="*.tsx" --include="*.ts" | grep -v "use-checklist-ranking.ts"
```

참조가 없는 것을 확인한 후 삭제.

- [ ] **Step 2: 파일 삭제**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
rm web/src/components/signals/ShortTermRecommendationSection.tsx
rm web/src/components/signals/ChecklistSection.tsx
rm web/src/hooks/use-checklist-ranking.ts
```

- [ ] **Step 3: 전체 빌드 + 린트**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web && npm run build && npm run lint
```

Expected: 성공

- [ ] **Step 4: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add -A
git commit -m "chore: 통합 완료 후 불필요 파일 정리 (ShortTermRecommendation, ChecklistSection, use-checklist-ranking)"
```

---

## 의존성 그래프

```
Task 1 (types)
  ├── Task 2 (presets) → Task 3, 4 의존
  ├── Task 3 (signal-tech) ─┐
  ├── Task 4 (supply) ──────┤
  ├── Task 5 (value-growth) ┼── Task 8 (engine) → Task 9 (API)
  ├── Task 6 (momentum) ────┤
  └── Task 7 (risk) ────────┘
                                  │
Task 10 (hooks) ──────────────────┤
Task 11 (StyleSelector) ─────────┤
Task 12 (HoverCard) ─────────────┼── Task 13 (StockAnalysisSection) → Task 17 (탭 구조)
                                  │
Task 14 (UnifiedScoreCard) ───── Task 15 (StockDetailPanel 수정)
                                  │
Task 16 (context 정리) ───────── Task 17 → Task 18 (정리)
```

병렬 실행 가능: Task 3~7 (5개 스코어 모듈), Task 10~12 (프론트엔드 훅/컴포넌트)
