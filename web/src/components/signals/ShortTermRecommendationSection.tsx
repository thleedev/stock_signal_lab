'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { StockRankItem } from '@/app/api/v1/stock-ranking/route';
import StockActionMenu from '@/components/common/stock-action-menu';
import { getLastNWeekdays } from '@/lib/date-utils';
import { FilterBar } from '@/components/common/filter-bar';
import { usePriceRefresh } from '@/hooks/use-price-refresh';
import type { WatchlistGroup } from '@/types/stock';
import type { SignalMap } from './UnifiedAnalysisSection';

// ── 타입 정의 ─────────────────────────────────────────────────────────────────

interface ShortTermRecommendationSectionProps {
  signalMap: SignalMap;
  favoriteSymbols: string[];
  watchlistSymbols: string[];
  groups?: WatchlistGroup[];
  symbolGroups?: Record<string, string[]>;
}

type SourceFilter = 'all' | 'quant' | 'lassi' | 'stockbot';

interface GapInfo {
  source: string;
  buyPrice: number;
  gap: number; // ((currentPrice - buyPrice) / buyPrice) * 100
  date: string;
}

type SortMode = 'score' | 'name' | 'updated' | 'gap';

interface RankingResponse {
  items: StockRankItem[];
  total: number;
  page: number;
  limit: number;
}

interface MenuState {
  isOpen: boolean;
  symbol: string;
  name: string;
  currentPrice: number | null;
  isFavorite: boolean;
  position: { x: number; y: number };
}

interface Weights {
  momentum: number;   // 기본 45
  supply: number;     // 기본 28
  catalyst: number;   // 기본 22
  valuation: number;  // 기본 5
  risk: number;       // 기본 15 (감산 가중치)
}

// ── 상수 ──────────────────────────────────────────────────────────────────────
const SOURCE_OPTIONS = [
  { key: 'all',      label: '전체'   },
  { key: 'lassi',    label: '라씨'   },
  { key: 'stockbot', label: '스톡봇' },
  { key: 'quant',    label: '퀀트'   },
];

const SORT_OPTIONS_WITH_GAP: { key: SortMode; label: string }[] = [
  { key: 'score',   label: '점수순'    },
  { key: 'name',    label: '이름순'    },
  { key: 'updated', label: '업데이트순' },
  { key: 'gap',     label: 'Gap순'    },
];

// ── 배지 정의 ────────────────────────────────────────────────────────────────
type BadgeVariant = 'green' | 'blue' | 'orange' | 'red' | 'purple' | 'gold';
const BADGE_CLS: Record<BadgeVariant, string> = {
  green:  'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  blue:   'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  red:    'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  gold:   'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
};

// ── 단기추천 성격 분류 ─────────────────────────────────────────────────────────
type ShortTermCharacter = 'volume_surge' | 'dual_buy' | 'foreign_buy' | 'inst_buy' | 'close_strong' | 'overheated' | 'chase_risk';

interface CharacterDef {
  key: ShortTermCharacter;
  label: string;
  icon: string;
  variant: BadgeVariant;
}

const CHARACTER_DEFS: CharacterDef[] = [
  { key: 'volume_surge',  label: '거래량폭발', icon: '🔥', variant: 'red' },
  { key: 'dual_buy',      label: '동반매수',   icon: '⚡', variant: 'orange' },
  { key: 'foreign_buy',   label: '외국인매수', icon: '🌍', variant: 'blue' },
  { key: 'inst_buy',      label: '기관매수',   icon: '🏛️', variant: 'blue' },
  { key: 'close_strong',  label: '종가강세',   icon: '💪', variant: 'green' },
  { key: 'overheated',    label: '과열주의',   icon: '⚠️', variant: 'orange' },
  { key: 'chase_risk',    label: '추격위험',   icon: '⚠️', variant: 'orange' },
];

const CHARACTER_FILTER_OPTIONS = [
  { key: 'all', label: '전체' },
  ...CHARACTER_DEFS.map(d => ({ key: d.key, label: `${d.icon} ${d.label}` })),
];


// ── 단기추천 점수 모델 (5카테고리) ────────────────────────────────────────────
interface ShortTermScores {
  momentum: number;   // 0~100 — 가격x거래량 매트릭스 + 종가위치 + 갭 + 거래대금
  supply: number;     // 0~100 — 외국인/기관 수급
  catalyst: number;   // 0~100 — 신호 신선도 + 복수 소스
  valuation: number;  // 0~100 — Forward PER + 목표주가 + ROE
  risk: number;       // 0~100 — 과열/추격매수 감산 패널티
}

function computeShortTermScores(item: StockRankItem): ShortTermScores {
  // ── 1. 모멘텀 (설계 Section 4.1) ──
  const pct = item.price_change_pct ?? 0;
  const vr = item.volume_ratio ?? 1;

  // A. 등락률 x 거래량 배수 매트릭스 (max ~35)
  let matrixScore = 0;
  if (pct >= 1 && pct < 3) matrixScore = vr >= 2 ? 35 : vr >= 1.5 ? 28 : 18;
  else if (pct >= 3 && pct < 6) matrixScore = vr >= 2 ? 30 : vr >= 1.5 ? 25 : 15;
  else if (pct >= 0.5 && pct < 1) matrixScore = vr >= 2 ? 22 : vr >= 1.5 ? 15 : 8;
  else if (pct >= 6 && pct < 8) matrixScore = vr >= 2 ? 15 : vr >= 1.5 ? 12 : 5;
  else if (pct >= -1 && pct < 0.5) matrixScore = vr >= 2 ? 12 : vr >= 1.5 ? 8 : 3;
  else if (pct >= 8) matrixScore = vr >= 2 ? -5 : vr >= 1.5 ? -8 : -10;
  // pct < -1 → 0

  // B. 종가위치 (max 20)
  const cp = item.close_position;
  let closePosScore = 0;
  if (cp !== null) {
    if (cp >= 0.8) closePosScore = 20;
    else if (cp >= 0.6) closePosScore = 12;
    else if (cp >= 0.4) closePosScore = 3;
    else closePosScore = -10;
  }

  // C. 갭업 (max 15)
  const gap = item.gap_pct;
  let gapScore = 0;
  if (gap !== null) {
    if (gap >= 1 && gap < 3) gapScore = 15;
    else if (gap >= 0 && gap < 1) gapScore = 8;
    else if (gap >= 3) gapScore = 3; // 과도한 갭은 낮게
  }

  // D. 거래대금 (max 15)
  const tv = item.trading_value ?? 0;
  let tvScore = 0;
  if (tv >= 1000_0000_0000) tvScore = 15;       // 1000억 이상
  else if (tv >= 500_0000_0000) tvScore = 10;    // 500억 이상
  else if (tv >= 200_0000_0000) tvScore = 5;     // 200억 이상

  const momentumRaw = matrixScore + closePosScore + gapScore + tvScore; // 범위 약 -10 ~ 85
  const momentum = Math.max(0, Math.min(100, (momentumRaw + 10) / 95 * 100));

  // ── 2. 수급 ──
  const fn = item.foreign_net_qty ?? 0;
  const in_ = item.institution_net_qty ?? 0;
  const fs = item.foreign_streak ?? 0;
  const is_ = item.institution_streak ?? 0;
  let supplyRaw = 0;
  if (fn > 0) supplyRaw += 10;
  if (in_ > 0) supplyRaw += 10;
  if (fn > 0 && in_ > 0) supplyRaw += 12; // 동반매수 보너스
  if (fs >= 2) supplyRaw += 5;  // 외국인 2일 연속
  if (is_ >= 2) supplyRaw += 5; // 기관 2일 연속
  if (fn <= 0 && in_ <= 0 && (fn !== 0 || in_ !== 0)) supplyRaw -= 15; // 둘 다 매도
  if (fs <= -3) supplyRaw -= 10; // 외국인 3일 연속 매도
  if (is_ <= -3) supplyRaw -= 10; // 기관 3일 연속 매도
  const supply = Math.max(0, Math.min(100, (supplyRaw + 25) / 80 * 100));

  // ── 3. 촉매 (신호 신선도 + 복수 소스) ──
  let catalystRaw = 0;
  const sigDate = item.latest_signal_date;
  if (sigDate) {
    const days = Math.floor((Date.now() - new Date(sigDate).getTime()) / 86400000);
    if (days <= 0) catalystRaw += 15;      // 오늘
    else if (days === 1) catalystRaw += 10; // 어제
    else if (days <= 3) catalystRaw += 5;   // 3일 이내
  }
  const cnt = item.signal_count_30d ?? 0;
  if (cnt >= 5) catalystRaw += 10;
  else if (cnt >= 3) catalystRaw += 5;
  const catalyst = Math.max(0, Math.min(100, (catalystRaw + 10) / 35 * 100));

  // ── 4. 밸류에이션 (설계 Section 4.4) ──
  let valRaw = 0;
  const fper = item.forward_per;
  if (fper !== null && fper > 0) {
    if (fper < 8) valRaw += 30;
    else if (fper < 12) valRaw += 20;
    else if (fper < 20) valRaw += 10;
  }
  if (item.target_price && item.current_price && item.current_price > 0) {
    const upside = ((item.target_price - item.current_price) / item.current_price) * 100;
    if (upside >= 30) valRaw += 25;
    else if (upside >= 15) valRaw += 15;
    else if (upside >= 5) valRaw += 5;
  }
  // PBR fallback (Forward PER 없을 때)
  if (fper === null && item.pbr !== null && item.pbr > 0) {
    if (item.pbr < 0.5) valRaw += 30;
    else if (item.pbr < 1.0) valRaw += 15;
    else if (item.pbr < 1.5) valRaw += 5;
  }
  const roe = item.roe ?? 0;
  if (roe > 15) valRaw += 20;
  else if (roe > 10) valRaw += 10;
  else if (roe > 5) valRaw += 5;
  const valuation = Math.max(0, Math.min(100, valRaw / 75 * 100));

  // ── 5. 리스크 패널티 (설계 Section 4.5) ──
  let riskRaw = 0;
  // 과열 신호
  if (pct >= 12) riskRaw += 20;
  const cr3 = item.cum_return_3d ?? 0;
  if (cr3 >= 20) riskRaw += 20;
  if (pct >= 10 && vr < 1) riskRaw += 15; // 거래량 없이 급등 = 위험
  // 종가위치 낮은데 양전 → 윗꼬리 음봉전환 추정
  if (cp !== null && cp < 0.3 && pct > 0) riskRaw += 10;
  // 추격매수 위험
  if (item.latest_signal_price && item.current_price && item.latest_signal_price > 0) {
    const sigGap = ((item.current_price - item.latest_signal_price) / item.latest_signal_price) * 100;
    if (sigGap >= 12) riskRaw += 20;
    else if (sigGap >= 7) riskRaw += 12;
  }
  // 유동성 트랩: 거래대금 적은데 급등
  if (tv > 0 && tv < 100_0000_0000 && pct > 3) riskRaw += 10;
  const risk = Math.min(100, riskRaw);

  return { momentum, supply, catalyst, valuation, risk };
}

// ── 단기추천 가중치 합산 점수 ─────────────────────────────────────────────────
function computeShortTermWeighted(item: StockRankItem, w: Weights): number {
  const s = computeShortTermScores(item);
  const coreSum = w.momentum + w.supply + w.catalyst + w.valuation;
  const base = (s.momentum * w.momentum + s.supply * w.supply + s.catalyst * w.catalyst + s.valuation * w.valuation) / (coreSum || 1);
  return Math.max(0, Math.min(100, base - s.risk * (w.risk / 100)));
}

// ── 단기추천 성격 태그 판별 ──────────────────────────────────────────────────
function getShortTermCharacters(item: StockRankItem): ShortTermCharacter[] {
  const chars: ShortTermCharacter[] = [];
  const vr = item.volume_ratio ?? 0;
  const fn = item.foreign_net_qty ?? 0;
  const in_ = item.institution_net_qty ?? 0;
  const pct = item.price_change_pct ?? 0;

  // 거래량 폭발
  if (vr >= 2) chars.push('volume_surge');

  // 수급 배지
  if (fn > 0 && in_ > 0) {
    chars.push('dual_buy');
  } else {
    if (in_ > 0) chars.push('inst_buy');
    if (fn > 0) chars.push('foreign_buy');
  }

  // 추격매수 위험
  if (item.latest_signal_price && item.current_price && item.latest_signal_price > 0) {
    const sigGap = ((item.current_price - item.latest_signal_price) / item.latest_signal_price) * 100;
    if (sigGap >= 7) chars.push('chase_risk');
  }

  // 과열 주의
  if (pct >= 12 || (item.cum_return_3d ?? 0) >= 20) chars.push('overheated');

  // 종가 강세
  const cp = item.close_position;
  if (cp !== null && cp >= 0.8) chars.push('close_strong');

  return chars;
}

// ── 단기추천 배지 생성 ────────────────────────────────────────────────────────
function getShortTermBadges(item: StockRankItem): { label: string; variant: BadgeVariant }[] {
  const badges: { label: string; variant: BadgeVariant }[] = [];
  const vr = item.volume_ratio ?? 0;
  const fn = item.foreign_net_qty ?? 0;
  const in_ = item.institution_net_qty ?? 0;
  const pct = item.price_change_pct ?? 0;

  if (vr >= 2) badges.push({ label: `거래량${vr.toFixed(1)}배`, variant: 'red' });
  if (fn > 0 && in_ > 0) {
    badges.push({ label: '동반매수', variant: 'orange' });
  } else {
    if (in_ > 0) badges.push({ label: '기관매수', variant: 'blue' });
    if (fn > 0) badges.push({ label: '외국인매수', variant: 'blue' });
  }

  // 추격 주의
  if (item.latest_signal_price && item.current_price && item.latest_signal_price > 0) {
    const sigGap = ((item.current_price - item.latest_signal_price) / item.latest_signal_price) * 100;
    if (sigGap >= 7) badges.push({ label: `추격+${sigGap.toFixed(0)}%`, variant: 'orange' });
  }

  // 과열
  if (pct >= 12 || (item.cum_return_3d ?? 0) >= 20) badges.push({ label: '과열주의', variant: 'orange' });

  // 종가 강세
  const cp = item.close_position;
  if (cp !== null && cp >= 0.8) badges.push({ label: '종가강세', variant: 'green' });

  // 저평가
  if (item.forward_per !== null && item.forward_per > 0 && item.forward_per < 8) {
    badges.push({ label: `PER${item.forward_per.toFixed(0)}`, variant: 'purple' });
  }

  return badges.slice(0, 4); // 최대 4개
}

// ── 추천 근거 한줄 요약 ───────────────────────────────────────────────────────
function getRecommendReason(item: StockRankItem): string {
  const reasons: string[] = [];
  const pct = item.price_change_pct ?? 0;

  // ── 차트 패턴 (타이밍 정보 포함) ──
  if (item.ai) {
    if (item.ai.golden_cross) {
      reasons.push(pct < 5 ? '골든크로스 초기' : `골든크로스(+${pct.toFixed(1)}%)`);
    }
    if (item.ai.macd_cross) {
      reasons.push(pct < 5 ? 'MACD돌파 초기' : `MACD돌파(+${pct.toFixed(1)}%)`);
    }
    if (item.ai.phoenix_pattern) reasons.push('V자반등');
    if (item.ai.bollinger_bottom) reasons.push('볼린저하단 반등');
    if (item.ai.volume_surge) reasons.push('거래량급증');
    if (item.ai.disparity_rebound) reasons.push('이격도반등');
    if (item.ai.volume_breakout) reasons.push('거래량바닥탈출');
    if (item.ai.consecutive_drop_rebound) reasons.push('하락후반등');
    if (item.ai.week52_low_near) reasons.push('52주저점 근접');
    if (item.ai.rsi !== null && item.ai.rsi < 30) reasons.push(`RSI${item.ai.rsi.toFixed(0)} 과매도`);
    if (item.ai.double_top) reasons.push('⚠️ 쌍봉 주의');
  }

  // ── 수급 동향 (5일 누적 + 연속성 기반) ──
  const foreignBuy = item.ai?.foreign_buying ?? (item.foreign_net_qty != null && item.foreign_net_qty > 0);
  const instBuy = item.ai?.institution_buying ?? (item.institution_net_qty != null && item.institution_net_qty > 0);
  const fStreak = item.foreign_streak ?? 0;
  const iStreak = item.institution_streak ?? 0;
  const f5d = item.foreign_net_5d ?? 0;
  const i5d = item.institution_net_5d ?? 0;

  // 동반매수 (5일 누적 기준)
  if (f5d > 0 && i5d > 0) {
    const streakInfo = [];
    if (fStreak >= 2) streakInfo.push(`외국인${fStreak}일연속`);
    if (iStreak >= 2) streakInfo.push(`기관${iStreak}일연속`);
    reasons.push(streakInfo.length > 0 ? `외국인+기관 동반매수(${streakInfo.join(', ')})` : '외국인+기관 동반매수');
  } else {
    if (foreignBuy) {
      reasons.push(fStreak >= 3 ? `외국인 ${fStreak}일 연속매수` : fStreak >= 2 ? `외국인 ${fStreak}일연속 순매수` : '외국인 순매수');
    }
    if (instBuy) {
      reasons.push(iStreak >= 3 ? `기관 ${iStreak}일 연속매수` : iStreak >= 2 ? `기관 ${iStreak}일연속 순매수` : '기관 순매수');
    }
  }
  if (item.ai?.volume_vs_sector) reasons.push('섹터대비 거래량↑');
  if (item.ai?.low_short_sell) reasons.push('공매도↓');

  // ── 밸류에이션 ──
  const valReasons: string[] = [];
  if (item.forward_per !== null && item.forward_per > 0) {
    valReasons.push(`추정PER ${item.forward_per.toFixed(1)}`);
  } else if (item.per !== null && item.per > 0 && item.per < 10) {
    valReasons.push(`PER ${item.per.toFixed(1)}`);
  }
  if (item.pbr !== null && item.pbr > 0 && item.pbr < 1) valReasons.push(`PBR ${item.pbr.toFixed(2)}`);
  if (item.roe !== null && item.roe > 10) valReasons.push(`ROE ${item.roe.toFixed(0)}%`);
  // 목표주가 상승여력
  if (item.target_price && item.current_price && item.current_price > 0) {
    const upside = ((item.target_price - item.current_price) / item.current_price) * 100;
    if (upside >= 5) valReasons.push(`목표↑${upside.toFixed(0)}%`);
  }
  if (valReasons.length >= 2) {
    reasons.push(`저평가(${valReasons.join(', ')})`);
  } else if (valReasons.length === 1) {
    reasons.push(valReasons[0]);
  }
  // 섹터 정보
  if (item.sector) reasons.push(item.sector);

  // ── 신호 빈도 ──
  const cnt = item.signal_count_30d ?? 0;
  if (cnt >= 5) reasons.push(`30일 ${cnt}회 반복추천`);
  else if (cnt >= 3) reasons.push(`30일 ${cnt}회 추천`);

  // ── 과열/모멘텀 상태 ──
  const itemRsi = item.ai?.rsi ?? null;
  if (itemRsi !== null && itemRsi >= 70 && pct >= 10) {
    reasons.push(`⚠️ RSI${itemRsi.toFixed(0)} 과매수 + ${pct.toFixed(1)}% 상승`);
  } else if (pct >= 25) {
    reasons.push(`⚠️ +${pct.toFixed(1)}% 급등, 추격매수 주의`);
  } else if (pct >= 5) {
    reasons.push(`+${pct.toFixed(1)}% 상승 진행중`);
  }

  // ── 부정적 근거 (단기 점수 기반 투명화) ──
  const stScoresForReason = computeShortTermScores(item);
  if (stScoresForReason.supply <= 10 && !item.ai?.foreign_buying && !item.ai?.institution_buying) {
    reasons.push('📉 수급 부재');
  }
  if (stScoresForReason.momentum <= 10) {
    reasons.push('📊 모멘텀 약세');
  }
  if (stScoresForReason.valuation <= 5) {
    reasons.push('💤 밸류 정보 없음');
  }
  if (stScoresForReason.risk >= 40) {
    reasons.push('⚠️ 리스크 높음');
  }

  // 매수가 대비 갭
  if (item.latest_signal_price && item.current_price && item.latest_signal_price > 0) {
    const gap = ((item.current_price - item.latest_signal_price) / item.latest_signal_price) * 100;
    if (gap <= -10) reasons.push(`매수가 대비 ${gap.toFixed(0)}%`);
    else if (gap >= 20) reasons.push(`⚠️ 매수가 대비 +${gap.toFixed(0)}%`);
  }

  if (reasons.length === 0) {
    const signalDate = item.latest_signal_date;
    if (signalDate) reasons.push(`최근신호 ${signalDate.slice(5)}`);
    if (item.signal_count_30d) reasons.push(`${item.signal_count_30d}회 추천`);
  }
  return reasons.join(' · ') || 'AI 분석 대기중';
}

function fmtNum(v: number | null, d = 1) { return v == null ? '-' : v.toFixed(d); }

// ── 점수 → 등급 변환 ──────────────────────────────────────────────────────────
function getGrade(score: number): { grade: string; label: string; cls: string } {
  if (score >= 90) return { grade: 'A+', label: '적극매수', cls: 'bg-red-600 text-white' };
  if (score >= 80) return { grade: 'A', label: '매수', cls: 'bg-red-500 text-white' };
  if (score >= 65) return { grade: 'B+', label: '관심', cls: 'bg-orange-400 text-white' };
  if (score >= 50) return { grade: 'B', label: '보통', cls: 'bg-yellow-400 text-gray-900' };
  if (score >= 35) return { grade: 'C', label: '관망', cls: 'bg-gray-300 text-gray-700 dark:bg-gray-600 dark:text-gray-200' };
  return { grade: 'D', label: '주의', cls: 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400' };
}


// ── Gap 계산 유틸 ─────────────────────────────────────────────────────────────
function getGapInfo(
  item: StockRankItem,
  signalMap: SignalMap,
  sourceFilter: SourceFilter,
  livePrices: Record<string, { current_price: number | null; price_change_pct?: number | null }>,
): GapInfo | null {
  const currentPrice = livePrices[item.symbol]?.current_price ?? item.current_price;
  if (!currentPrice) return null;

  const sigs = signalMap[item.symbol];
  if (!sigs) return null;

  if (sourceFilter === 'all') {
    // 가장 낮은 gap (biggest discount) 선택
    let best: GapInfo | null = null;
    for (const [source, sig] of Object.entries(sigs)) {
      const gap = ((currentPrice - sig.buyPrice) / sig.buyPrice) * 100;
      if (!best || gap < best.gap) best = { source, buyPrice: sig.buyPrice, gap, date: sig.date };
    }
    return best;
  }

  const sig = sigs[sourceFilter];
  if (!sig) return null;
  const gap = ((currentPrice - sig.buyPrice) / sig.buyPrice) * 100;
  return { source: sourceFilter, buyPrice: sig.buyPrice, gap, date: sig.date };
}

// ── 신호 경과일 텍스트 ──────────────────────────────────────────────────────────
function getSignalAge(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (diff <= 0) return '오늘 신호';
  if (diff === 1) return '어제 신호';
  return `${diff}일전 신호`;
}

// ── RankCard 컴포넌트 (모바일 2줄 / 데스크탑 2줄+점수바) ──────────────────────
// 단기추천 전용: 점수바 라벨이 모멘텀/수급/촉매/밸류
function RankCard({
  item, rank, weighted, favs, gapInfo, onClick, characters, stScores, badges,
}: {
  item: StockRankItem;
  rank: number;
  weighted: number;
  favs: Set<string>;
  gapInfo: GapInfo | null;
  onClick: (e: React.MouseEvent) => void;
  characters: ShortTermCharacter[];
  stScores: ShortTermScores;
  badges: { label: string; variant: BadgeVariant }[];
}) {
  const hasAi = !!item.ai;
  const isWarning = hasAi && item.ai!.double_top;
  const pct = item.price_change_pct;
  const reason = getRecommendReason(item);
  const { grade, label: gradeLabel, cls: gradeCls } = getGrade(weighted);
  const signalAge = getSignalAge(item.latest_signal_date);
  const pctCls = pct != null && pct > 0 ? 'text-red-500' : pct != null && pct < 0 ? 'text-blue-500' : 'text-[var(--muted)]';

  return (
    <div
      onClick={onClick}
      className={`px-3 sm:px-4 py-2 sm:py-2.5 cursor-pointer hover:bg-[var(--card-hover)] transition-colors select-none ${
        isWarning ? 'bg-orange-50/60 dark:bg-orange-950/10' : ''
      }`}
    >
      {/* ── 줄 1: 순위 · 종목명 · 등급 · 등락률 ── */}
      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
        {/* 순위 */}
        <span className={`text-sm font-bold tabular-nums w-6 shrink-0 text-right ${hasAi ? 'text-blue-500' : 'text-[var(--muted)]'}`}>
          {rank}
        </span>

        {/* 종목명 + 즐겨찾기 */}
        <span className="font-semibold text-sm sm:text-[15px] truncate max-w-[6rem] sm:max-w-[10rem]">{item.name}</span>
        {favs.has(item.symbol) && <span className="text-yellow-400 text-xs shrink-0">★</span>}

        {/* 등급 뱃지 (등급 + 라벨) */}
        <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold leading-none shrink-0 ${gradeCls}`} title={`${weighted.toFixed(0)}pt`}>
          {grade} {gradeLabel}
        </span>

        {/* 성격 배지 — 데스크탑만 */}
        {badges.length > 0 && (
          <div className="hidden sm:flex items-center gap-1 shrink-0">
            {badges.slice(0, 3).map((b, i) => (
              <span key={i} className={`px-1 py-0.5 rounded text-[10px] font-bold leading-none ${BADGE_CLS[b.variant]}`}>
                {b.label}
              </span>
            ))}
          </div>
        )}

        <div className="flex-1 min-w-0" />

        {/* 신호 경과 */}
        {signalAge && <span className="hidden sm:inline text-[11px] text-[var(--muted)] shrink-0">{signalAge}</span>}

        {/* 등락률 */}
        <span className={`text-sm font-bold tabular-nums shrink-0 ${pctCls}`}>
          {pct != null ? `${pct > 0 ? '+' : ''}${fmtNum(pct)}%` : '-'}
        </span>

        {/* 현재가 — 데스크탑만 */}
        <span className="hidden sm:inline text-xs text-[var(--muted)] tabular-nums shrink-0">
          {item.current_price?.toLocaleString() ?? '-'}원
        </span>

        {/* Gap — 신호가 대비 */}
        {gapInfo && (
          <span className={`text-[11px] font-semibold tabular-nums shrink-0 ${gapInfo.gap >= 0 ? 'text-red-400' : 'text-blue-400'}`}
            title={`신호가 ${gapInfo.buyPrice.toLocaleString()}원 대비`}>
            Gap{gapInfo.gap >= 0 ? '+' : ''}{gapInfo.gap.toFixed(1)}%
          </span>
        )}
      </div>

      {/* ── 줄 2: 추천근거 + 모바일 성격태그 + 신호경과 ── */}
      <div className="flex items-start gap-1.5 mt-0.5 pl-8">
        {/* 모바일 성격배지 */}
        {badges.length > 0 && (
          <div className="sm:hidden flex items-center gap-0.5 shrink-0 pt-px">
            {badges.slice(0, 2).map((b, i) => (
              <span key={i} className={`px-1 py-px rounded text-[9px] font-bold leading-none ${BADGE_CLS[b.variant]}`}>
                {b.label}
              </span>
            ))}
          </div>
        )}
        {/* 모바일 신호경과 */}
        {signalAge && <span className="sm:hidden text-[10px] text-[var(--muted)] shrink-0 pt-px">{signalAge}</span>}

        {/* 추천근거 */}
        <p className="text-[11px] sm:text-xs text-[var(--muted)] leading-relaxed flex-1 min-w-0">{reason}</p>
      </div>

      {/* ── 줄 3 (데스크탑만): 단기 5카테고리 점수 미니바 ── */}
      <div className="hidden sm:flex items-center gap-3 mt-1 pl-8">
        {[
          { label: '모멘텀', value: stScores.momentum, color: 'bg-emerald-500' },
          { label: '수급', value: stScores.supply, color: 'bg-sky-500' },
          { label: '촉매', value: stScores.catalyst, color: 'bg-amber-500' },
          { label: '밸류', value: stScores.valuation, color: 'bg-violet-500' },
          { label: '리스크', value: stScores.risk, color: 'bg-red-400' },
        ].map(b => (
          <div key={b.label} className="flex items-center gap-1">
            <span className="text-[10px] text-[var(--muted)] w-8">{b.label}</span>
            <div className="w-16 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
              <div className={`h-full rounded-full ${b.color}`} style={{ width: `${Math.max(0, Math.min(100, b.value))}%` }} />
            </div>
            <span className="text-[10px] tabular-nums text-[var(--muted)] w-5">{Math.round(b.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 가중치 팝업 컴포넌트 ──────────────────────────────────────────────────────
// 단기추천 전용: 촉매/모멘텀/밸류/수급 라벨 사용
function WeightPopup({
  weights,
  onChange,
  onClose,
}: {
  weights: Weights;
  onChange: (w: Weights) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  // 핵심 4 가중치 (합계 100 기준)
  const coreItems = [
    { key: 'momentum' as const, label: '모멘텀' },
    { key: 'supply' as const, label: '수급' },
    { key: 'catalyst' as const, label: '촉매' },
    { key: 'valuation' as const, label: '밸류' },
  ];

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 z-50 w-64 rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg p-3 space-y-3"
    >
      <div className="text-xs font-semibold text-[var(--text)] mb-1">핵심 가중치 (합계 기준 정규화)</div>
      {coreItems.map(({ key, label }) => (
        <div key={key} className="space-y-1">
          <div className="flex justify-between text-xs text-[var(--muted)]">
            <span>{label}</span>
            <span className="tabular-nums font-medium">{weights[key]}</span>
          </div>
          <input
            type="range" min={0} max={100} value={weights[key]}
            onChange={(e) => onChange({ ...weights, [key]: Number(e.target.value) })}
            className="w-full accent-[var(--accent)]"
          />
        </div>
      ))}
      <hr className="border-[var(--border)]" />
      <div className="text-xs font-semibold text-[var(--text)] mb-1">리스크 감산 강도</div>
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-[var(--muted)]">
          <span>리스크 패널티</span>
          <span className="tabular-nums font-medium">{weights.risk}</span>
        </div>
        <input
          type="range" min={0} max={30} value={weights.risk}
          onChange={(e) => onChange({ ...weights, risk: Number(e.target.value) })}
          className="w-full accent-red-500"
        />
      </div>
      <p className="text-[10px] text-[var(--muted)]">핵심 가중치는 비율 기준 정규화, 리스크는 별도 감산</p>
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function ShortTermRecommendationSection({ signalMap, favoriteSymbols, watchlistSymbols, groups: initialGroups = [], symbolGroups: initialSymbolGroups = {} }: ShortTermRecommendationSectionProps) {
  // 마운트 시마다 날짜 재계산 (모듈 레벨 const는 SPA 내비게이션 시 갱신 안 됨)
  const LAST7 = useMemo(() => getLastNWeekdays(7), []);
  const [selectedDate, setSelectedDate] = useState<string>(() => getLastNWeekdays(7)[0]);
  const [data, setData] = useState<RankingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [market, setMarket] = useState<string>('all');
  const [visibleCount, setVisibleCount] = useState(50);
  const [favs, setFavs] = useState<Set<string>>(new Set(favoriteSymbols));
  const [showWeights, setShowWeights] = useState(false);
  // 단기추천 전용 가중치: 모멘텀 45, 수급 28, 촉매 22, 밸류 5, 리스크 감산 15
  const [weights, setWeights] = useState<Weights>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('short-term-weights');
        if (saved) return JSON.parse(saved) as Weights;
      } catch { /* ignore */ }
    }
    return { momentum: 45, supply: 28, catalyst: 22, valuation: 5, risk: 15 };
  });
  const [sort, setSort] = useState<SortMode>('score');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [charFilter, setCharFilter] = useState<string>('all');
  const [gapAsc, setGapAsc] = useState(true);
  const portSet = useMemo(() => new Set(watchlistSymbols), [watchlistSymbols]);
  const [groups] = useState<WatchlistGroup[]>(initialGroups);
  const [symGroups, setSymGroups] = useState<Record<string, string[]>>(initialSymbolGroups);
  const [menu, setMenu] = useState<MenuState>({
    isOpen: false, symbol: '', name: '', currentPrice: null, isFavorite: false,
    position: { x: 0, y: 0 },
  });
  const PAGE_SIZE = 50;
  const sentinelRef = useRef<HTMLDivElement>(null);

  // ── 실시간 가격 ──────────────────────────────────────────────────────────────
  const allSymbols = useMemo(() => (data?.items ?? []).map((s) => s.symbol), [data]);
  const { prices: livePrices, refresh: refreshLivePrices, loading: liveLoading } = usePriceRefresh(allSymbols);
  const [priceLoading, setPriceLoading] = useState(false);
  const priceLoadingRef = useRef(false);

  const refreshPrices = useCallback(async () => {
    if (priceLoadingRef.current || liveLoading) return;
    priceLoadingRef.current = true;
    setPriceLoading(true);
    try {
      await fetch('/api/v1/prices', { method: 'POST' });
      await refreshLivePrices();
    } catch (e) {
      console.error('[ShortTermRecommendationSection] 가격 갱신 실패:', e);
    } finally {
      priceLoadingRef.current = false;
      setPriceLoading(false);
    }
  }, [liveLoading, refreshLivePrices]);

  // ── 데이터 조회 ───────────────────────────────────────────────────────────────
  const doFetch = useCallback(async (date: string, mkt: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ date });
      if (mkt !== 'all') params.set('market', mkt);
      const res = await window.fetch(`/api/v1/stock-ranking?${params}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { doFetch(LAST7[0], 'all'); }, [doFetch]);
  useEffect(() => { setFavs(new Set(favoriteSymbols)); }, [favoriteSymbols]);
  // 가중치 변경 시 localStorage 저장
  useEffect(() => {
    try { localStorage.setItem('short-term-weights', JSON.stringify(weights)); } catch { /* ignore */ }
  }, [weights]);

  const resetScroll = () => setVisibleCount(PAGE_SIZE);
  const handleDate = (date: string) => {
    setSelectedDate(date); resetScroll(); setQ(''); setMarket('all');
    doFetch(date, 'all');
  };
  const handleSearch = (v: string) => { setQ(v); resetScroll(); };
  const handleMarket = (mkt: string) => { setMarket(mkt); resetScroll(); doFetch(selectedDate, mkt); };

  const openMenu = (e: React.MouseEvent, symbol: string, name: string, currentPrice: number | null) => {
    e.stopPropagation();
    setMenu({ isOpen: true, symbol, name, currentPrice, isFavorite: favs.has(symbol), position: { x: e.clientX, y: e.clientY } });
  };
  const closeMenu = () => setMenu((m) => ({ ...m, isOpen: false }));
  const handleToggleFavorite = useCallback(async () => {
    const { symbol, name } = menu;
    const isFav = favs.has(symbol);

    if (isFav) {
      // 모든 그룹에서 제거
      const groupIds = symGroups[symbol] ?? [];
      groupIds.forEach((gid) => {
        fetch(`/api/v1/watchlist-groups/${gid}/stocks/${symbol}`, { method: 'DELETE' });
      });
      setFavs((prev) => { const n = new Set(prev); n.delete(symbol); return n; });
      setSymGroups((prev) => { const next = { ...prev }; delete next[symbol]; return next; });
    } else {
      const defaultGroup = groups.find((g) => g.is_default);
      if (defaultGroup) {
        fetch(`/api/v1/watchlist-groups/${defaultGroup.id}/stocks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, name }),
        });
        setSymGroups((prev) => ({ ...prev, [symbol]: [defaultGroup.id] }));
      }
      setFavs((prev) => new Set([...prev, symbol]));
    }
    setMenu((m) => ({ ...m, isFavorite: !isFav }));
  }, [menu, favs, symGroups, groups]);

  const handleGroupToggle = useCallback(async (group: WatchlistGroup) => {
    const { symbol, name } = menu;
    const currentGroups = symGroups[symbol] ?? [];
    const inGroup = currentGroups.includes(group.id);

    // 낙관적 업데이트
    if (inGroup) {
      const newGroups = currentGroups.filter((id) => id !== group.id);
      setSymGroups((prev) => ({ ...prev, [symbol]: newGroups }));
      if (newGroups.length === 0) {
        setFavs((prev) => { const n = new Set(prev); n.delete(symbol); return n; });
      }
    } else {
      setSymGroups((prev) => ({ ...prev, [symbol]: [...currentGroups, group.id] }));
      setFavs((prev) => new Set([...prev, symbol]));
    }

    try {
      if (inGroup) {
        const res = await fetch(`/api/v1/watchlist-groups/${group.id}/stocks/${symbol}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('DELETE 실패');
      } else {
        const res = await fetch(`/api/v1/watchlist-groups/${group.id}/stocks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, name }),
        });
        if (!res.ok && res.status !== 409) throw new Error('POST 실패');
      }
    } catch (e) {
      console.error('[handleGroupToggle] 실패, 롤백:', e);
      setSymGroups((prev) => ({ ...prev, [symbol]: currentGroups }));
      if (!inGroup) {
        if (currentGroups.length === 0) setFavs((prev) => { const n = new Set(prev); n.delete(symbol); return n; });
      } else {
        setFavs((prev) => new Set([...prev, symbol]));
      }
    }
  }, [menu, symGroups]);

  const rawItems = data?.items ?? [];

  // ── 실시간 가격 반영 ─────────────────────────────────────────────────────────
  const liveItems = useMemo(() => {
    if (Object.keys(livePrices).length === 0) return rawItems;
    return rawItems.map(item => {
      const live = livePrices[item.symbol];
      if (!live?.current_price) return item;

      const pct = live.price_change_pct ?? item.price_change_pct;
      const cp = live.current_price;

      // 초단기 필드 실시간 보정: cum_return_3d를 현재가 기준으로 재계산
      // stock_cache의 close와 live price 차이로 보정
      let adjCumReturn3d = item.cum_return_3d;
      if (adjCumReturn3d != null && item.current_price && item.current_price > 0) {
        // 원래 3일전 종가 역산: close_3d_ago = current_price / (1 + cum/100)
        const close3dAgo = item.current_price / (1 + adjCumReturn3d / 100);
        adjCumReturn3d = close3dAgo > 0 ? ((cp - close3dAgo) / close3dAgo) * 100 : adjCumReturn3d;
      }

      // AI 종목: 서버 기술점수 유지하되, 실시간 등락률로 모멘텀 보정
      if (item.ai) {
        let momBonus = 0;
        if (pct !== null && pct !== undefined) {
          if (pct >= 5) momBonus = 15;          // 급등: 강한 모멘텀
          else if (pct >= 3) momBonus = 10;     // 상승 초입
          else if (pct >= 1) momBonus = 5;      // 완만 상승
          else if (pct <= -5) momBonus = -10;   // 급락
          else if (pct <= -3) momBonus = -5;    // 조정
        }
        const adjMomentum = Math.max(0, Math.min(100, item.score_momentum + momBonus));
        const adjTotal = (item.score_valuation ?? 0) + item.score_supply + item.score_signal + adjMomentum;
        return { ...item, current_price: cp, price_change_pct: pct, cum_return_3d: adjCumReturn3d, score_momentum: adjMomentum, score_total: adjTotal };
      }

      let score_momentum = 0;
      if (cp && item.high_52w && item.low_52w && item.high_52w > item.low_52w) {
        const range = item.high_52w - item.low_52w;
        const position = (cp - item.low_52w) / range;
        if (position <= 0.15) score_momentum += 40;
        else if (position <= 0.30) score_momentum += 35;
        else if (position <= 0.50) score_momentum += 25;
        else if (position <= 0.70) score_momentum += 15;
        else if (position <= 0.85) score_momentum += 8;
        else score_momentum += 3;
      }
      if (pct !== null && pct !== undefined) {
        if (pct >= 1 && pct < 3) score_momentum += 30;
        else if (pct >= 3 && pct < 5) score_momentum += 40;
        else if (pct >= 5 && pct < 10) score_momentum += 25;
        else if (pct >= 10 && pct < 15) score_momentum += 10;
        else if (pct >= 15 && pct < 25) score_momentum -= 5;
        else if (pct >= 25) score_momentum -= 20;
        else if (pct >= 0 && pct < 1) score_momentum += 15;
        else if (pct < 0 && pct > -3) score_momentum += 5;
      }
      score_momentum = Math.max(0, Math.min(100, score_momentum));

      const score_total = (item.score_valuation ?? 0) + item.score_supply + item.score_signal + score_momentum;
      return { ...item, current_price: cp, price_change_pct: pct, cum_return_3d: adjCumReturn3d, score_momentum, score_total };
    });
  }, [rawItems, livePrices]);

  // ── 정렬 ──────────────────────────────────────────────────────────────────────
  const sortedItems = useMemo(() => [...liveItems].sort((a, b) => {
    if (sort === 'gap') {
      const ga = getGapInfo(a, signalMap, sourceFilter, livePrices)?.gap ?? (gapAsc ? Infinity : -Infinity);
      const gb = getGapInfo(b, signalMap, sourceFilter, livePrices)?.gap ?? (gapAsc ? Infinity : -Infinity);
      return gapAsc ? ga - gb : gb - ga;
    }
    if (sort === 'name') return (a.name ?? '').localeCompare(b.name ?? '', 'ko');
    if (sort === 'updated') {
      const da = a.latest_signal_date ?? '';
      const db = b.latest_signal_date ?? '';
      if (da !== db) return db.localeCompare(da);
    }
    // score (default + fallback for updated) — 순수 가중합 점수 순위
    return computeShortTermWeighted(b, weights) - computeShortTermWeighted(a, weights);
  }), [liveItems, sort, weights, sourceFilter, signalMap, livePrices, gapAsc]);

  // ── 투자성격 필터 ────────────────────────────────────────────────────────────
  const filteredByChar = useMemo(() => {
    if (charFilter === 'all') return sortedItems;
    return sortedItems.filter(item => {
      const chars = getShortTermCharacters(item);
      return chars.includes(charFilter as ShortTermCharacter);
    });
  }, [sortedItems, charFilter]);

  // ── 검색 필터 (클라이언트 사이드) ──────────────────────────────────────────
  const filteredBySearch = useMemo(() => {
    if (!q) return filteredByChar;
    const lower = q.toLowerCase();
    return filteredByChar.filter(
      (s) => s.name?.toLowerCase().includes(lower) || s.symbol?.toLowerCase().includes(lower)
    );
  }, [filteredByChar, q]);

  const total = data?.total ?? 0;
  const displayTotal = filteredBySearch.length;
  const displayItems = filteredBySearch.slice(0, visibleCount);
  const hasMore = visibleCount < displayTotal;
  const aiCount = rawItems.filter((i) => i.ai).length;

  // ── 무한스크롤: IntersectionObserver ──
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !loading) {
          setVisibleCount(prev => prev + PAGE_SIZE);
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading]);

  return (
    <div className="space-y-3">
      {/* ── 필터 바 ── */}
      <div className="relative">
        <FilterBar
          date={{ dates: LAST7, selected: selectedDate, onChange: handleDate, extraAll: { value: 'signal_all', label: '신호전체' }, allLabel: '종목전체', label: '날짜' }}
          source={{ options: SOURCE_OPTIONS, selected: sourceFilter, onChange: (s) => setSourceFilter(s as SourceFilter), label: '소스' }}
          character={{ options: CHARACTER_FILTER_OPTIONS, selected: charFilter, onChange: (c) => { setCharFilter(c); resetScroll(); }, label: '성격' }}
          market={{ selected: market, onChange: handleMarket, label: '시장' }}
          search={{ value: q, onChange: handleSearch, placeholder: '종목명 / 코드' }}
          sort={{
            options: SORT_OPTIONS_WITH_GAP,
            selected: sort,
            onChange: (s) => setSort(s as SortMode),
            gapAsc,
            onGapToggle: () => setGapAsc((v) => !v),
            label: '정렬',
          }}
          onWeightClick={() => setShowWeights((v) => !v)}
          onRefresh={refreshPrices}
          refreshing={priceLoading || liveLoading}
        />
        {showWeights && (
          <WeightPopup
            weights={weights}
            onChange={setWeights}
            onClose={() => setShowWeights(false)}
          />
        )}
      </div>

      {/* ── 종목수 표시 ── */}
      <div className="text-xs text-[var(--muted)] flex flex-wrap items-center gap-2">
        <span>{displayTotal.toLocaleString()}종목{charFilter !== 'all' && total !== displayTotal ? ` / ${total.toLocaleString()}전체` : ''}</span>
        {aiCount > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            AI분석 {aiCount}
          </span>
        )}
        {charFilter !== 'all' && (
          <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            {CHARACTER_DEFS.find(d => d.key === charFilter)?.icon ?? ''} {CHARACTER_DEFS.find(d => d.key === charFilter)?.label ?? charFilter} 필터
          </span>
        )}
      </div>

      {/* ── 리스트 ── */}
      {loading && displayItems.length === 0 && (
        <div className="py-16 text-center text-[var(--muted)] text-sm">로딩 중...</div>
      )}
      {!loading && displayItems.length === 0 && (
        <div className="py-16 text-center text-[var(--muted)] text-sm">
          {selectedDate === 'all' || selectedDate === 'signal_all' || selectedDate === 'week' ? '검색 결과가 없습니다' : '해당 날짜에 BUY 신호가 없습니다'}
        </div>
      )}

      <div className={`rounded-xl border border-[var(--border)] bg-[var(--card)] divide-y divide-[var(--border)] overflow-hidden ${loading ? 'opacity-60' : ''}`}>
        {displayItems.map((item, idx) => {
          const w = computeShortTermWeighted(item, weights);
          const gapInfo = getGapInfo(item, signalMap, sourceFilter, livePrices);
          const characters = getShortTermCharacters(item);
          const stScores = computeShortTermScores(item);
          const badges = getShortTermBadges(item);
          return (
            <RankCard
              key={item.symbol}
              item={item}
              rank={idx + 1}
              weighted={w}
              favs={favs}
              gapInfo={gapInfo}
              onClick={(e) => openMenu(e, item.symbol, item.name ?? '', item.current_price)}
              characters={characters}
              stScores={stScores}
              badges={badges}
            />
          );
        })}
      </div>

      {/* ── 무한스크롤 sentinel ── */}
      <div ref={sentinelRef} className="py-4 text-center text-xs text-[var(--muted)]">
        {hasMore ? `${displayItems.length} / ${displayTotal}종목 표시 중...` : displayTotal > 0 ? `전체 ${displayTotal}종목` : ''}
      </div>

      <StockActionMenu
        symbol={menu.symbol}
        name={menu.name}
        currentPrice={menu.currentPrice}
        isOpen={menu.isOpen}
        onClose={closeMenu}
        position={menu.position}
        isFavorite={menu.isFavorite}
        isInPortfolio={portSet.has(menu.symbol)}
        onToggleFavorite={handleToggleFavorite}
        groups={groups}
        symbolGroupIds={symGroups[menu.symbol] ?? []}
        onGroupToggle={handleGroupToggle}
      />
    </div>
  );
}
