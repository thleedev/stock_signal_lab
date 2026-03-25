'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Search, ChevronLeft, ChevronRight, SlidersHorizontal, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';
import type { StockRankItem } from '@/app/api/v1/stock-ranking/route';
import StockActionMenu from '@/components/common/stock-action-menu';
import { getLastNWeekdays, formatDateLabel } from '@/lib/date-utils';
import { DEFAULT_WEIGHTS } from '@/types/ai-recommendation';

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
  signal: number;
  trend: number;
  valuation: number;
  supply: number;
}

type SortMode = 'score' | 'name' | 'updated';

const MARKETS = ['all', 'KOSPI', 'KOSDAQ'] as const;
const MARKET_LABELS: Record<string, string> = { all: '전체', KOSPI: 'KOSPI', KOSDAQ: 'KOSDAQ' };
const SORT_OPTIONS: { key: SortMode; label: string }[] = [
  { key: 'score', label: '점수순' },
  { key: 'name', label: '이름순' },
  { key: 'updated', label: '업데이트순' },
];

// ── 배지 정의 ────────────────────────────────────────────────────────────────
type BadgeVariant = 'green' | 'blue' | 'orange' | 'red';
const BADGE_CLS: Record<BadgeVariant, string> = {
  green: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  blue:  'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  orange:'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  red:   'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

interface Badge { label: string; hint: string; variant: BadgeVariant; }

function getAiBadges(ai: NonNullable<StockRankItem['ai']>): Badge[] {
  const b: Badge[] = [];
  if (ai.golden_cross)    b.push({ label: '골든크로스',      hint: 'MA5>MA20 상향돌파',    variant: 'green' });
  if (ai.bollinger_bottom) b.push({ label: '볼린저하단반등',  hint: '과매도→평균회귀',      variant: 'green' });
  if (ai.phoenix_pattern) b.push({ label: '불새패턴',         hint: '급락후 V자반등',        variant: 'green' });
  if (ai.macd_cross)      b.push({ label: 'MACD크로스',       hint: '시그널선 상향돌파',     variant: 'green' });
  if (ai.volume_surge)    b.push({ label: '거래량급증',        hint: '20일평균 2배↑',         variant: 'green' });
  if (ai.week52_low_near) b.push({ label: '52주저점근처',      hint: '±10%이내 지지구간',     variant: 'green' });
  if (ai.rsi !== null && ai.rsi < 30)
    b.push({ label: `RSI ${ai.rsi.toFixed(0)} 과매도`, hint: '강한과매도·반등여력',  variant: 'blue' });
  else if (ai.rsi !== null && ai.rsi <= 50)
    b.push({ label: `RSI ${ai.rsi.toFixed(0)}`,        hint: '과매도회복구간(30~50)',  variant: 'green' });
  if (ai.foreign_buying)     b.push({ label: '외국인순매수',  hint: '지속매수·중장기호재',   variant: 'blue' });
  if (ai.institution_buying) b.push({ label: '기관순매수',    hint: '펀더멘털기반매수',      variant: 'blue' });
  if (ai.volume_vs_sector)   b.push({ label: '섹터거래상위',  hint: '업종내주목도↑',         variant: 'blue' });
  if (ai.low_short_sell)     b.push({ label: '공매도낮음',    hint: '1%미만·하락압력↓',      variant: 'blue' });
  if (ai.double_top)         b.push({ label: '⚠ 쌍봉패턴',  hint: '고점2회→조정가능·주의', variant: 'orange' });
  return b;
}

function getBasicBadges(item: StockRankItem, todayMs: number): Badge[] {
  const b: Badge[] = [];
  const days = item.latest_signal_date
    ? Math.round((todayMs - new Date(item.latest_signal_date).getTime()) / 86400000)
    : null;
  if (days !== null && days <= 7 && (item.latest_signal_type === 'BUY' || item.latest_signal_type === 'BUY_FORECAST'))
    b.push({ label: days <= 1 ? '오늘BUY' : `${days}일전BUY`, hint: 'BUY/BUY_FORECAST 신호',  variant: 'green' });
  const cnt = item.signal_count_30d ?? 0;
  if (cnt >= 3)
    b.push({ label: `신호${cnt}회/30일`, hint: '반복추천·지속신호', variant: 'green' });
  if (item.per !== null && item.per > 0 && item.per < 10)
    b.push({ label: `PER ${item.per.toFixed(1)}`, hint: '10미만·이익저평가', variant: 'green' });
  if (item.pbr !== null && item.pbr > 0 && item.pbr < 1)
    b.push({ label: `PBR ${item.pbr.toFixed(2)}`, hint: '1미만·자산저평가', variant: 'green' });
  if (item.roe !== null && item.roe > 10)
    b.push({ label: `ROE ${item.roe.toFixed(1)}%`, hint: '10%↑·우량수익성', variant: 'green' });
  if (item.foreign_net_qty !== null && item.foreign_net_qty > 0)
    b.push({ label: '외국인순매수', hint: '누적순매수+', variant: 'blue' });
  if (item.institution_net_qty !== null && item.institution_net_qty > 0)
    b.push({ label: '기관순매수',   hint: '누적순매수+', variant: 'blue' });
  if (item.current_price && item.low_52w && item.low_52w > 0) {
    const r = item.current_price / item.low_52w;
    if (r >= 0.95 && r <= 1.1)
      b.push({ label: `52주저점+${((r-1)*100).toFixed(0)}%`, hint: '역사적지지구간', variant: 'green' });
  }
  if (item.price_change_pct !== null && item.price_change_pct > 3)
    b.push({ label: `+${item.price_change_pct.toFixed(1)}%급등`, hint: '3%↑강한모멘텀', variant: 'red' });
  if (item.short_sell_ratio !== null && item.short_sell_ratio < 1)
    b.push({ label: `공매도${item.short_sell_ratio.toFixed(2)}%`, hint: '1%미만·하락압력↓', variant: 'blue' });
  return b;
}

// 모든 점수를 100점 만점으로 정규화 (signal:30, trend:0~58, val:25, supply:45)
function normScores(item: StockRankItem) {
  const clamp = (v: number) => Math.round(Math.min(100, Math.max(0, v)));
  if (item.ai) {
    return {
      sig: clamp(item.ai.signal_score / 30 * 100),
      tech: clamp(item.ai.trend_score / 58 * 100),
      val: clamp(item.ai.valuation_score / 25 * 100),
      sup: clamp((item.ai.supply_score + 10) / 55 * 100),
    };
  }
  // 서버 calcScore는 이미 0~100 정규화 점수를 반환
  return {
    sig: clamp(item.score_signal),
    tech: clamp(item.score_momentum),
    val: clamp(item.score_valuation),
    sup: clamp(item.score_supply),
  };
}

// 가중치 비율 기반 합산 점수 (100점 만점)
function computeWeighted(item: StockRankItem, w: Weights): number {
  const total = w.signal + w.trend + w.valuation + w.supply || 1;
  const scores = normScores(item);
  return (scores.sig * w.signal + scores.tech * w.trend + scores.val * w.valuation + scores.sup * w.supply) / total;
}

function fmtNum(v: number | null, d = 1) { return v == null ? '-' : v.toFixed(d); }
function fmtPrice(v: number | null) { return v == null ? '-' : v.toLocaleString() + '원'; }

interface StockRankingProps {
  favoriteSymbols: string[];
  watchlistSymbols: string[];
}

const LAST7 = getLastNWeekdays(7);

// ── 카드 행 컴포넌트 (React.memo로 불필요한 리렌더링 방지) ─────────────────────
const RankCard = React.memo(function RankCard({
  item, rank, weighted, favs, onClick,
}: {
  item: StockRankItem;
  rank: number;
  weighted: number;
  favs: Set<string>;
  onClick: (e: React.MouseEvent) => void;
}) {
  const hasAi = !!item.ai;
  const isWarning = hasAi && item.ai!.double_top;
  const pct = item.price_change_pct;
  // useMemo로 배지 계산 메모이제이션 (item 변경 시에만 재계산)
  const badges = useMemo(
    () => hasAi ? getAiBadges(item.ai!) : getBasicBadges(item, Date.now()),
    [hasAi, item]
  );
  const { sig, tech, val, sup } = useMemo(() => normScores(item), [item]);

  return (
    <div
      onClick={onClick}
      className={`px-3 py-2 cursor-pointer hover:bg-[var(--card-hover)] transition-colors select-none ${
        isWarning ? 'bg-orange-50/60 dark:bg-orange-950/10' : ''
      }`}
    >
      {/* ── 줄 1: 순위 · 종목명 · 메타 · 점수 · 등락 ── */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={`text-xs font-bold tabular-nums w-6 shrink-0 text-right ${hasAi ? 'text-blue-500' : 'text-[var(--muted)]'}`}>
          {rank}
        </span>

        <div className="flex items-center gap-1 min-w-0 shrink-0 max-w-[9rem] sm:max-w-[14rem]">
          <span className="font-semibold text-sm truncate">{item.name}</span>
          {hasAi && <span className="shrink-0 px-0.5 rounded text-[8px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 leading-tight">AI</span>}
          {isWarning && <AlertTriangle size={9} className="shrink-0 text-orange-500" />}
          {favs.has(item.symbol) && <span className="shrink-0 text-yellow-400 text-[9px]">★</span>}
        </div>

        <div className="hidden sm:flex items-center gap-1 text-[10px] text-[var(--muted)] flex-1 min-w-0 overflow-hidden">
          <span className="shrink-0">{item.symbol}</span>
          <span className="opacity-30">·</span>
          <span className="shrink-0">{item.market}</span>
          <span className="opacity-30 mx-0.5">|</span>
          <span className="shrink-0 tabular-nums">신{sig}</span>
          <span className="opacity-30">·</span>
          <span className="shrink-0 tabular-nums">추{tech}</span>
          <span className="opacity-30">·</span>
          <span className="shrink-0 tabular-nums">밸{val}</span>
          <span className="opacity-30">·</span>
          <span className="shrink-0 tabular-nums">수{sup}</span>
          {item.per != null && <><span className="opacity-30 mx-0.5">|</span><span className="shrink-0">P{fmtNum(item.per, 0)}</span></>}
          {item.pbr != null && <span className="shrink-0">B{fmtNum(item.pbr, 1)}</span>}
          {item.roe != null && <span className="shrink-0">R{fmtNum(item.roe, 0)}%</span>}
        </div>
        <div className="flex-1 sm:hidden" />

        <span className={`text-sm font-bold tabular-nums shrink-0 ${
          weighted >= 60 ? 'text-green-600 dark:text-green-400'
          : weighted >= 40 ? 'text-blue-600 dark:text-blue-400'
          : 'text-[var(--text)]'
        }`}>{weighted.toFixed(0)}<span className="text-[9px] font-normal text-[var(--muted)]">pt</span></span>

        <div className="shrink-0 text-right min-w-[5.5rem]">
          {pct != null ? (
            <span className={`text-xs font-semibold tabular-nums flex items-center gap-0.5 justify-end ${
              pct > 0 ? 'text-red-500' : pct < 0 ? 'text-blue-500' : 'text-[var(--muted)]'
            }`}>
              {pct > 0 ? <TrendingUp size={9} /> : pct < 0 ? <TrendingDown size={9} /> : null}
              {pct > 0 ? '+' : ''}{fmtNum(pct)}%
            </span>
          ) : <span className="text-xs text-[var(--muted)]">-</span>}
          <div className="text-[10px] text-[var(--muted)] tabular-nums leading-tight">{fmtPrice(item.current_price)}</div>
        </div>
      </div>

      {/* ── 줄 1.5 (모바일 전용): 심볼·시장·점수 ── */}
      <div className="sm:hidden flex items-center gap-1 text-[10px] text-[var(--muted)] mt-0.5 pl-7">
        <span>{item.symbol} · {item.market}</span>
        <span className="opacity-30 mx-0.5">|</span>
        <span className="tabular-nums">신{sig}·추{tech}·밸{val}·수{sup}</span>
        {item.per != null && <><span className="opacity-30">|</span><span>P{fmtNum(item.per, 0)}</span></>}
      </div>

      {/* ── 줄 2: 분석 배지 ── */}
      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1 pl-7">
          {badges.map((badge, i) => (
            <span
              key={i}
              className={`inline-flex items-baseline gap-1 px-1.5 py-0.5 rounded text-[10px] ${BADGE_CLS[badge.variant]}`}
            >
              <b className="font-semibold whitespace-nowrap">{badge.label}</b>
              <span className="opacity-55 whitespace-nowrap hidden sm:inline">{badge.hint}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
});

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
export function StockRankingSection({ favoriteSymbols }: StockRankingProps) {
  const [selectedDate, setSelectedDate] = useState<string>('all');
  const [data, setData] = useState<RankingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [market, setMarket] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [favs, setFavs] = useState<Set<string>>(new Set(favoriteSymbols));
  const [showWeights, setShowWeights] = useState(false);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [sort, setSort] = useState<SortMode>('score');
  const [menu, setMenu] = useState<MenuState>({
    isOpen: false, symbol: '', name: '', currentPrice: null, isFavorite: false,
    position: { x: 0, y: 0 },
  });
  const LIMIT = 100;

  const doFetch = useCallback(async (date: string, searchQ: string, mkt: string, pg: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ date, page: String(pg), limit: String(LIMIT) });
      if (searchQ) params.set('q', searchQ);
      if (mkt !== 'all') params.set('market', mkt);
      const res = await window.fetch(`/api/v1/stock-ranking?${params}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { doFetch('all', '', 'all', 1); }, [doFetch]);
  useEffect(() => { setFavs(new Set(favoriteSymbols)); }, [favoriteSymbols]);

  const handleDate = (date: string) => {
    setSelectedDate(date); setPage(1); setQ(''); setMarket('all');
    doFetch(date, '', 'all', 1);
  };
  const handleSearch = (v: string) => { setQ(v); setPage(1); doFetch(selectedDate, v, market, 1); };
  const handleMarket = (mkt: string) => { setMarket(mkt); setPage(1); doFetch(selectedDate, q, mkt, 1); };
  const handlePage = (pg: number) => { setPage(pg); doFetch(selectedDate, q, market, pg); };

  const openMenu = (e: React.MouseEvent, symbol: string, name: string, currentPrice: number | null) => {
    e.stopPropagation();
    setMenu({ isOpen: true, symbol, name, currentPrice, isFavorite: favs.has(symbol), position: { x: e.clientX, y: e.clientY } });
  };
  const closeMenu = () => setMenu((m) => ({ ...m, isOpen: false }));
  const handleToggleFavorite = async () => {
    const { symbol } = menu;
    const isFav = favs.has(symbol);
    try {
      await fetch('/api/v1/favorites', {
        method: isFav ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      setFavs((prev) => { const n = new Set(prev); isFav ? n.delete(symbol) : n.add(symbol); return n; });
      setMenu((m) => ({ ...m, isFavorite: !isFav }));
    } catch {}
  };

  const rawItems = data?.items ?? [];

  const sortedItems = [...rawItems].sort((a, b) => {
    if (sort === 'name') return (a.name ?? '').localeCompare(b.name ?? '', 'ko');
    if (sort === 'updated') {
      const da = a.latest_signal_date ?? '';
      const db = b.latest_signal_date ?? '';
      if (da !== db) return db.localeCompare(da);
    }
    // score (default + fallback for updated)
    const aHasAi = a.ai ? 1 : 0;
    const bHasAi = b.ai ? 1 : 0;
    if (aHasAi !== bHasAi) return bHasAi - aHasAi;
    return computeWeighted(b, weights) - computeWeighted(a, weights);
  });

  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);
  const offset = (page - 1) * LIMIT;
  const aiCount = rawItems.filter((i) => i.ai).length;

  const btnCls = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
      active
        ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
        : 'bg-[var(--card)] text-[var(--muted)] border-[var(--border)] hover:bg-[var(--card-hover)]'
    }`;

  return (
    <div className="space-y-3">
      {/* ── 날짜 선택 (평일만, 전체는 마지막) ── */}
      <div className="flex gap-1.5 flex-wrap">
        {LAST7.map((date) => (
          <button key={date} onClick={() => handleDate(date)} className={btnCls(selectedDate === date)}>
            {formatDateLabel(date)}
          </button>
        ))}
        <button onClick={() => handleDate('all')} className={btnCls(selectedDate === 'all')}>
          전체
        </button>
      </div>

      {/* ── 필터 바 (시장 + 검색 + 가중치 아이콘) ── */}
      <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
        <div className="flex gap-1">
          {MARKETS.map((m) => (
            <button key={m} onClick={() => handleMarket(m)} className={btnCls(market === m)}>
              {MARKET_LABELS[m]}
            </button>
          ))}
        </div>

        <div className="flex gap-2 flex-1 max-w-sm items-center">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input type="text" placeholder="종목명 / 코드 검색" value={q}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            />
          </div>
          {/* 가중치 아이콘 버튼 */}
          <div className="relative shrink-0">
            <button
              onClick={() => setShowWeights((v) => !v)}
              className={`p-1.5 rounded-lg border transition-colors ${
                showWeights
                  ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                  : 'bg-[var(--card)] text-[var(--muted)] border-[var(--border)] hover:bg-[var(--card-hover)]'
              }`}
              title="가중치 조절"
            >
              <SlidersHorizontal size={15} />
            </button>
            {showWeights && (
              <WeightPopup
                weights={weights}
                onChange={setWeights}
                onClose={() => setShowWeights(false)}
              />
            )}
          </div>
        </div>

        <div className="text-xs text-[var(--muted)] ml-auto shrink-0">
          {total.toLocaleString()}종목
          {aiCount > 0 && (
            <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              AI분석 {aiCount}
            </span>
          )}
        </div>
      </div>

      {/* ── 정렬 바 ── */}
      <div className="flex gap-1 items-center">
        <span className="text-xs text-[var(--muted)] mr-1">정렬:</span>
        {SORT_OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSort(key)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
              sort === key
                ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                : 'bg-[var(--card)] text-[var(--muted)] border-[var(--border)] hover:bg-[var(--card-hover)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── 리스트 ── */}
      {loading && sortedItems.length === 0 && (
        <div className="py-16 text-center text-[var(--muted)] text-sm">로딩 중...</div>
      )}
      {!loading && sortedItems.length === 0 && (
        <div className="py-16 text-center text-[var(--muted)] text-sm">
          {selectedDate === 'all' ? '검색 결과가 없습니다' : '해당 날짜에 BUY 신호가 없습니다'}
        </div>
      )}

      <div className={`rounded-xl border border-[var(--border)] bg-[var(--card)] divide-y divide-[var(--border)] overflow-hidden ${loading ? 'opacity-60' : ''}`}>
        {sortedItems.map((item, idx) => {
          const weighted = computeWeighted(item, weights);
          return (
            <RankCard
              key={item.symbol}
              item={item}
              rank={offset + idx + 1}
              weighted={weighted}
              favs={favs}
              onClick={(e) => openMenu(e, item.symbol, item.name, item.current_price)}
            />
          );
        })}
      </div>

      {/* ── 페이지네이션 ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button onClick={() => handlePage(Math.max(1, page - 1))} disabled={page === 1 || loading}
            className="p-1.5 rounded-lg border border-[var(--border)] disabled:opacity-30 hover:bg-[var(--card-hover)]">
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm text-[var(--muted)] tabular-nums">{page} / {totalPages}</span>
          <button onClick={() => handlePage(Math.min(totalPages, page + 1))} disabled={page === totalPages || loading}
            className="p-1.5 rounded-lg border border-[var(--border)] disabled:opacity-30 hover:bg-[var(--card-hover)]">
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      <StockActionMenu
        symbol={menu.symbol}
        name={menu.name}
        currentPrice={menu.currentPrice}
        isOpen={menu.isOpen}
        onClose={closeMenu}
        position={menu.position}
        isFavorite={menu.isFavorite}
        onToggleFavorite={handleToggleFavorite}
      />
    </div>
  );
}
