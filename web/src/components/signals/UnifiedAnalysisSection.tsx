'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { StockRankItem } from '@/app/api/v1/stock-ranking/route';
import StockActionMenu from '@/components/common/stock-action-menu';
import { GradeTooltip } from '@/components/common/grade-tooltip';
import { getLastNWeekdays } from '@/lib/date-utils';
import { FilterBar } from '@/components/common/filter-bar';
import { usePriceRefresh } from '@/hooks/use-price-refresh';
import { useStockRanking } from '@/hooks/use-stock-ranking';
import type { WatchlistGroup } from '@/types/stock';

// ── 타입 정의 ─────────────────────────────────────────────────────────────────
export type SignalMap = Record<string, Record<string, { buyPrice: number; date: string }>>;

interface UnifiedAnalysisProps {
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

interface MenuState {
  isOpen: boolean;
  symbol: string;
  name: string;
  currentPrice: number | null;
  isFavorite: boolean;
  position: { x: number; y: number };
}

interface Weights {
  signal: number;
  trend: number;
  valuation: number;
  supply: number;
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

// ── 투자 성격 분류 ────────────────────────────────────────────────────────────
type InvestmentCharacter = 'early_rise' | 'value' | 'supply_strong' | 'tech_rebound' | 'multi_signal' | 'top_pick' | 'overheated';

interface CharacterDef {
  key: InvestmentCharacter;
  label: string;
  icon: string;
  variant: BadgeVariant;
}

const CHARACTER_DEFS: CharacterDef[] = [
  { key: 'early_rise',    label: '상승초입',  icon: '🚀', variant: 'red' },
  { key: 'value',         label: '가치주',    icon: '💎', variant: 'purple' },
  { key: 'supply_strong', label: '수급강세',  icon: '🏦', variant: 'blue' },
  { key: 'tech_rebound',  label: '기술반등',  icon: '📈', variant: 'green' },
  { key: 'multi_signal',  label: '다중신호',  icon: '⚡', variant: 'orange' },
  { key: 'top_pick',      label: '종합추천',  icon: '⭐', variant: 'gold' },
  { key: 'overheated',    label: '과열주의',  icon: '⚠️', variant: 'orange' },
];

const CHARACTER_FILTER_OPTIONS = [
  { key: 'all', label: '전체' },
  ...CHARACTER_DEFS.map(d => ({ key: d.key, label: `${d.icon} ${d.label}` })),
];


// ── 점수 정규화 ───────────────────────────────────────────────────────────────
function normScores(item: StockRankItem) {
  const clamp = (v: number) => Math.round(Math.min(100, Math.max(0, v)));
  if (item.ai) {
    // AI 점수는 원점수로 저장됨 → 0~100 변환 (signal:30, trend:0~58, val:25, supply:-10~45)
    return {
      sig: clamp(item.ai.signal_score / 30 * 100),
      tech: clamp(item.ai.trend_score / 58 * 100),
      val: clamp(item.ai.valuation_score / 25 * 100),
      sup: clamp((item.ai.supply_score + 10) / 55 * 100),
    };
  }
  // 서버 calcScore가 이제 0~100 정규화 점수를 반환
  return {
    sig: clamp(item.score_signal),
    tech: clamp(item.score_momentum),
    val: clamp(item.score_valuation),
    sup: clamp(item.score_supply),
  };
}

// ── 가중치 합산 점수 ──────────────────────────────────────────────────────────
function computeWeighted(item: StockRankItem, w: Weights): number {
  const total = w.signal + w.trend + w.valuation + w.supply || 1;
  const scores = normScores(item);
  return (scores.sig * w.signal + scores.tech * w.trend + scores.val * w.valuation + scores.sup * w.supply) / total;
}

function getInvestmentCharacters(item: StockRankItem, weights: Weights): InvestmentCharacter[] {
  const chars: InvestmentCharacter[] = [];
  const { sig, tech, val, sup } = normScores(item);
  const weighted = computeWeighted(item, weights);
  const pct = item.price_change_pct ?? 0;

  // 과열주의: 복합 조건 (단순 등락률이 아닌 기술적 과열 신호)
  // - RSI 70 이상 (과매수) + 등락률 10% 이상
  // - 또는 쌍봉 패턴 감지
  // - 또는 등락률 25% 이상 (극단적 급등)
  const rsi = item.ai?.rsi ?? null;
  const isOverboughtRsi = rsi !== null && rsi >= 70;
  const hasDoubleTop = item.ai?.double_top ?? false;
  if ((isOverboughtRsi && pct >= 10) || hasDoubleTop || pct >= 25) {
    chars.push('overheated');
  }

  // 상승초입: 기술 신호 감지 + 아직 가격 덜 오른 종목 (진입 적기)
  // 조건: 골든크로스/MACD/거래량급증/이격도반등/거래량바닥탈출/하락후반등 + 등락률 5% 미만
  if (item.ai) {
    const hasEarlySignal = item.ai.golden_cross || item.ai.macd_cross || item.ai.volume_surge
      || item.ai.disparity_rebound || item.ai.volume_breakout || item.ai.consecutive_drop_rebound;
    if (hasEarlySignal && pct < 5) {
      chars.push('early_rise');
    }
  } else if (tech >= 50 && pct >= 0 && pct < 5) {
    chars.push('early_rise');
  }

  // 가치주: 밸류점수 70 이상 (PER·PBR·ROE 중 2개 이상 양호)
  if (val >= 70) chars.push('value');

  // 수급강세: 수급점수 60 이상 (외국인+기관 매수세)
  if (sup >= 60) chars.push('supply_strong');

  // 기술반등: 바닥 패턴 감지 (저점 매수 기회)
  if (item.ai) {
    if (item.ai.phoenix_pattern || (item.ai.bollinger_bottom && item.ai.rsi !== null && item.ai.rsi < 40)) {
      chars.push('tech_rebound');
    }
  }

  // 다중신호: 30일내 3회 이상 또는 신호점수 80 이상
  if ((item.signal_count_30d ?? 0) >= 3 || sig >= 80) chars.push('multi_signal');

  // 종합추천: 가중합 70점 이상
  if (weighted >= 70) chars.push('top_pick');

  return chars;
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

  // ── 부정적 근거 (점수가 낮은 이유 투명화) ──
  const { sig, tech, val, sup } = normScores(item);
  if (sup <= 5 && !item.ai?.foreign_buying && !item.ai?.institution_buying) {
    reasons.push('📉 수급 부재');
  }
  if (item.ai && tech <= 5) {
    reasons.push('📊 기술데이터 부족');
  }
  if (val <= 5) {
    reasons.push('💤 밸류 정보 없음');
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
function RankCard({
  item, rank, weighted, favs, gapInfo, onClick, characters,
}: {
  item: StockRankItem;
  rank: number;
  weighted: number;
  favs: Set<string>;
  gapInfo: GapInfo | null;
  onClick: (e: React.MouseEvent) => void;
  characters: InvestmentCharacter[];
}) {
  const hasAi = !!item.ai;
  const isWarning = hasAi && item.ai!.double_top;
  const pct = item.price_change_pct;
  const { sig, tech, val, sup } = normScores(item);
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

        {/* 등급 뱃지 + 툴팁 */}
        <GradeTooltip weighted={weighted} grade={grade} gradeLabel={gradeLabel} gradeCls={gradeCls} scores={[
          { label: '신호', value: sig, color: 'bg-amber-500' },
          { label: '기술', value: tech, color: 'bg-emerald-500' },
          { label: '밸류', value: val, color: 'bg-violet-500' },
          { label: '수급', value: sup, color: 'bg-sky-500' },
        ]} />

        {/* 성격 태그 — 데스크탑만 */}
        {characters.length > 0 && (
          <div className="hidden sm:flex items-center gap-1 shrink-0">
            {characters.slice(0, 3).map(charKey => {
              const def = CHARACTER_DEFS.find(d => d.key === charKey)!;
              return (
                <span key={charKey} className={`px-1 py-0.5 rounded text-[10px] font-bold leading-none ${BADGE_CLS[def.variant]}`}>
                  {def.icon}{def.label}
                </span>
              );
            })}
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
        {/* 모바일 성격태그 */}
        {characters.length > 0 && (
          <div className="sm:hidden flex items-center gap-0.5 shrink-0 pt-px">
            {characters.slice(0, 2).map(charKey => {
              const def = CHARACTER_DEFS.find(d => d.key === charKey)!;
              return (
                <span key={charKey} className={`px-1 py-px rounded text-[9px] font-bold leading-none ${BADGE_CLS[def.variant]}`}>
                  {def.icon}{def.label}
                </span>
              );
            })}
          </div>
        )}
        {/* 모바일 신호경과 */}
        {signalAge && <span className="sm:hidden text-[10px] text-[var(--muted)] shrink-0 pt-px">{signalAge}</span>}

        {/* 추천근거 */}
        <p className="text-[11px] sm:text-xs text-[var(--muted)] leading-relaxed flex-1 min-w-0">{reason}</p>
      </div>

      {/* ── 줄 3 (데스크탑만): 세부 점수 미니바 ── */}
      <div className="hidden sm:flex items-center gap-3 mt-1 pl-8">
        {[
          { label: '기술', value: tech, color: 'bg-emerald-500' },
          { label: '수급', value: sup, color: 'bg-sky-500' },
          { label: '신호', value: sig, color: 'bg-amber-500' },
          { label: '밸류', value: val, color: 'bg-violet-500' },
        ].map(b => (
          <div key={b.label} className="flex items-center gap-1">
            <span className="text-[10px] text-[var(--muted)] w-5">{b.label}</span>
            <div className="w-16 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
              <div className={`h-full rounded-full ${b.color}`} style={{ width: `${Math.max(0, Math.min(100, b.value))}%` }} />
            </div>
            <span className="text-[10px] tabular-nums text-[var(--muted)] w-5">{b.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 가중치 팝업 컴포넌트 ──────────────────────────────────────────────────────
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

  const items = [
    { key: 'signal' as const, label: '신호' },
    { key: 'trend' as const, label: '추세/모멘텀' },
    { key: 'valuation' as const, label: '밸류' },
    { key: 'supply' as const, label: '수급' },
  ];

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 z-50 w-64 rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg p-3 space-y-3"
    >
      <div className="text-xs font-semibold text-[var(--text)] mb-1">가중치 조절 (최대 100)</div>
      {items.map(({ key, label }) => (
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
      <p className="text-[10px] text-[var(--muted)]">비율 기준으로 자동 정규화됩니다</p>
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export function UnifiedAnalysisSection({ signalMap, favoriteSymbols, watchlistSymbols, groups: initialGroups = [], symbolGroups: initialSymbolGroups = {} }: UnifiedAnalysisProps) {
  // 마운트 시마다 날짜 재계산 (모듈 레벨 const는 SPA 내비게이션 시 갱신 안 됨)
  const LAST7 = useMemo(() => getLastNWeekdays(7), []);
  const [selectedDate, setSelectedDate] = useState<string>(() => getLastNWeekdays(7)[0]);
  const { data, loading, doFetch } = useStockRanking();
  const [q, setQ] = useState('');
  const [market, setMarket] = useState<string>('all');
  const [visibleCount, setVisibleCount] = useState(50);
  const [favs, setFavs] = useState<Set<string>>(new Set(favoriteSymbols));
  const [showWeights, setShowWeights] = useState(false);
  const [weights, setWeights] = useState<Weights>({ signal: 10, trend: 40, valuation: 10, supply: 40 });
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
      console.error('[UnifiedAnalysisSection] 가격 갱신 실패:', e);
    } finally {
      priceLoadingRef.current = false;
      setPriceLoading(false);
    }
  }, [liveLoading, refreshLivePrices]);

  // ── 데이터 조회 (모듈 레벨 캐시로 탭 전환 시 즉시 반환) ───────────────────────
  useEffect(() => { doFetch(LAST7[0], 'all'); }, [doFetch]);
  useEffect(() => { setFavs(new Set(favoriteSymbols)); }, [favoriteSymbols]);

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
        const adjTotal = item.score_valuation + item.score_supply + item.score_signal + adjMomentum;
        return { ...item, current_price: cp, price_change_pct: pct, score_momentum: adjMomentum, score_total: adjTotal };
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

      const score_total = item.score_valuation + item.score_supply + item.score_signal + score_momentum;
      return { ...item, current_price: cp, price_change_pct: pct, score_momentum, score_total };
    });
  }, [rawItems, livePrices]);

  // ── 점수 사전 계산 (sort·render에서 중복 호출 제거) ──────────────────────────
  const weightedMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of liveItems) {
      map.set(item.symbol, computeWeighted(item, weights));
    }
    return map;
  }, [liveItems, weights]);

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
    // score (default + fallback for updated) — 캐시된 점수 사용
    return (weightedMap.get(b.symbol) ?? 0) - (weightedMap.get(a.symbol) ?? 0);
  }), [liveItems, sort, weightedMap, sourceFilter, signalMap, livePrices, gapAsc]);

  // ── 투자성격 필터 ────────────────────────────────────────────────────────────
  const filteredByChar = useMemo(() => {
    if (charFilter === 'all') return sortedItems;
    return sortedItems.filter(item => {
      const chars = getInvestmentCharacters(item, weights);
      return chars.includes(charFilter as InvestmentCharacter);
    });
  }, [sortedItems, charFilter, weights]);

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
            {CHARACTER_DEFS.find(d => d.key === charFilter)?.icon} {CHARACTER_DEFS.find(d => d.key === charFilter)?.label} 필터
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
        {displayItems.map((item, idx) => (
            <RankCard
              key={item.symbol}
              item={item}
              rank={idx + 1}
              weighted={weightedMap.get(item.symbol) ?? 0}
              favs={favs}
              gapInfo={getGapInfo(item, signalMap, sourceFilter, livePrices)}
              onClick={(e) => openMenu(e, item.symbol, item.name, item.current_price)}
              characters={getInvestmentCharacters(item, weights)}
            />
        ))}
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
