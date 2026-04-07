'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Camera, Loader2, BarChart3 } from 'lucide-react';
import type { StockRankItem } from '@/app/api/v1/stock-ranking/route';
import StockActionMenu from '@/components/common/stock-action-menu';
import { GradeTooltip } from '@/components/common/grade-tooltip';
import { useUnifiedRanking } from '@/hooks/use-unified-ranking';
import { useScoreHistory } from '@/hooks/use-score-history';
import { useStockModal } from '@/contexts/stock-modal-context';
import { StyleSelector } from './StyleSelector';
import { AnalysisHoverCard } from './AnalysisHoverCard';
import { SnapshotTracker } from './SnapshotTracker';
import { formatTimeAgo, getLastNWeekdays } from '@/lib/date-utils';
import type { WatchlistGroup } from '@/types/stock';
import type { StyleWeights } from '@/lib/unified-scoring/types';

// ── 투자 성격 배지 ────────────────────────────────────────────────────────────
const CHAR_BADGE_CLS: Record<string, string> = {
  early_rise:    'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  value:         'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  supply_strong: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  tech_rebound:  'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  multi_signal:  'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  top_pick:      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  overheated:    'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
};
const CHAR_LABEL: Record<string, string> = {
  early_rise: '🚀상승초입', value: '💎가치주', supply_strong: '🏦수급강세',
  tech_rebound: '📈기술반등', multi_signal: '⚡다중신호', top_pick: '⭐종합추천',
  overheated: '⚠️과열',
};

/** score_* 축 기반 투자 성격 계산 */
function getCharacters(item: StockRankItem): string[] {
  const pct = item.price_change_pct ?? 0;
  const val = item.score_value ?? 0;
  const sup = item.score_supply ?? 0;
  const sig = item.score_signal ?? 0;
  const risk = item.score_risk ?? 0;
  const total = item.score_total;
  const chars: string[] = [];
  if ((risk >= 60 && pct >= 10) || pct >= 25) chars.push('overheated');
  if (sig >= 50 && pct >= 0 && pct < 5) chars.push('early_rise');
  if (val >= 70) chars.push('value');
  if (sup >= 60) chars.push('supply_strong');
  if (sig >= 80) chars.push('multi_signal');
  if (total >= 70) chars.push('top_pick');
  return chars;
}

// ── 타입 정의 ─────────────────────────────────────────────────────────────────

interface StockAnalysisSectionProps {
  initialDateMode?: 'today' | 'signal_all' | 'all';
  favoriteSymbols: string[];
  watchlistSymbols: string[];
  groups?: WatchlistGroup[];
  symbolGroups?: Record<string, string[]>;
}

type MarketFilter = 'all' | 'KOSPI' | 'KOSDAQ';
type SortMode = 'score' | 'name' | 'change';

interface MenuState {
  isOpen: boolean;
  symbol: string;
  name: string;
  currentPrice: number | null;
  isFavorite: boolean;
  position: { x: number; y: number };
  initialData?: StockRankItem;
}

interface HoverState {
  item: StockRankItem | null;
  x: number;
  y: number;
}

// ── 점수 → 등급 변환 ──────────────────────────────────────────────────────────
function getGrade(score: number): { grade: string; label: string; cls: string } {
  if (score >= 90) return { grade: 'A+', label: '적극매수', cls: 'bg-red-600 text-white' };
  if (score >= 80) return { grade: 'A',  label: '매수',    cls: 'bg-red-500 text-white' };
  if (score >= 65) return { grade: 'B+', label: '관심',    cls: 'bg-orange-400 text-white' };
  if (score >= 50) return { grade: 'B',  label: '보통',    cls: 'bg-yellow-400 text-gray-900' };
  if (score >= 35) return { grade: 'C',  label: '관망',    cls: 'bg-gray-300 text-gray-700 dark:bg-gray-600 dark:text-gray-200' };
  return             { grade: 'D',  label: '주의',    cls: 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400' };
}

// ── 카테고리 미니바 정규화 ──────────────────────────────────────────────────
// score_momentum은 DB 컬럼명이지만 실제로는 기술전환(Technical Reversal) 점수입니다.
function getCategoryScores(item: StockRankItem) {
  const clamp = (v: number) => Math.round(Math.min(100, Math.max(0, v)));
  return {
    signal:    clamp(item.score_signal ?? 0),
    supply:    clamp(item.score_supply ?? 0),
    valuation: clamp(item.score_value ?? 0),
    technical: clamp(item.score_momentum ?? 0),
  };
}

// ── 신호 경과 텍스트 (모듈 레벨 — Date.now 를 render 밖에서 호출) ──────────────
function getSignalAge(d: string | undefined | null): string | null {
  if (!d) return null;
  const date = new Date(d);
  if (isNaN(date.getTime())) return null;
  const diffD = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (diffD === 0) return '오늘';
  if (diffD === 1) return '어제';
  if (diffD < 7) return `${diffD}일전`;
  if (diffD < 30) return `${Math.floor(diffD / 7)}주전`;
  return `${Math.floor(diffD / 30)}달전`;
}

// ── StockRow ──────────────────────────────────────────────────────────────────
function StockRow({
  item,
  rank,
  favs,
  onClick,
  onMenuOpen,
  onHoverEnter,
  onHoverLeave,
}: {
  item: StockRankItem;
  rank: number;
  favs: Set<string>;
  onClick: (e: React.MouseEvent) => void;
  onMenuOpen: (e: React.MouseEvent) => void;
  onHoverEnter: (e: React.MouseEvent, item: StockRankItem) => void;
  onHoverLeave: () => void;
}) {
  const pct = item.price_change_pct;
  const scores = getCategoryScores(item);
  const { grade, label: gradeLabel, cls: gradeCls } = getGrade(item.score_total);
  const pctCls = pct != null && pct > 0
    ? 'text-red-500'
    : pct != null && pct < 0
    ? 'text-blue-500'
    : 'text-[var(--muted)]';

  // 매수신호 대비 Gap (30일 내 신호가 있는 종목에만 표시)
  const signalGap = item.signal_count_30d && item.signal_count_30d > 0
    && item.latest_signal_price && item.latest_signal_price > 0
    && item.current_price && item.current_price > 0
    ? ((item.current_price - item.latest_signal_price) / item.latest_signal_price) * 100
    : null;

  // 신호 경과
  const sigDateRaw = item.latest_signal_date ?? (item as unknown as Record<string, unknown>).signal_date as string | undefined;
  const signalAge = getSignalAge(sigDateRaw);

  const miniBars = [
    {
      label: '신호', value: scores.signal,    color: 'bg-amber-500',
      pass: item.checklist_sig_pass, total: item.checklist_sig_total,
    },
    {
      label: '수급', value: scores.supply,    color: 'bg-sky-500',
      pass: item.checklist_sup_pass, total: item.checklist_sup_total,
    },
    {
      label: '가치', value: scores.valuation, color: 'bg-violet-500',
      pass: item.checklist_val_pass, total: item.checklist_val_total,
    },
    {
      label: '기술', value: scores.technical, color: 'bg-emerald-500',
      pass: item.checklist_tech_pass, total: item.checklist_tech_total,
    },
  ];

  return (
    <div
      onClick={onClick}
      onMouseEnter={(e) => onHoverEnter(e, item)}
      onMouseLeave={onHoverLeave}
      className="px-3 sm:px-4 py-2 sm:py-2.5 cursor-pointer hover:bg-[var(--card-hover)] transition-colors select-none"
    >
      {/* ── 단일 행: 종목명/등급 | 게이지(데스크탑) | 현재가/등락률/신호경과/Gap ── */}
      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">

        {/* 순위 */}
        <span className="text-sm font-bold tabular-nums w-6 shrink-0 text-right text-[var(--muted)]">
          {rank}
        </span>

        {/* 종목명 + 즐겨찾기 */}
        <span className="font-semibold text-sm sm:text-[15px] truncate max-w-[5rem] sm:max-w-[9rem] shrink-0">
          {item.name}
        </span>
        {favs.has(item.symbol) && <span className="text-yellow-400 text-xs shrink-0">★</span>}

        {/* 등급 뱃지 */}
        <GradeTooltip
          weighted={item.score_total}
          grade={grade}
          gradeLabel={gradeLabel}
          gradeCls={gradeCls}
          scores={[]}
        />

        {/* 투자 성격 배지 — 데스크탑만 */}
        {(() => {
          const chars = getCharacters(item);
          return chars.length > 0 ? (
            <div className="hidden sm:flex items-center gap-0.5 shrink-0">
              {chars.slice(0, 2).map((ch) => (
                <span
                  key={ch}
                  className={`px-1 py-0.5 rounded text-[10px] font-bold leading-none ${CHAR_BADGE_CLS[ch] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}
                >
                  {CHAR_LABEL[ch] ?? ch}
                </span>
              ))}
            </div>
          ) : null;
        })()}


        {/* 카테고리 게이지 + N/M 체크리스트 수 — 데스크탑만 */}
        <div className="hidden sm:flex items-center gap-2 shrink-0">
          {miniBars.map((b) => (
            <div key={b.label} className="flex items-center gap-0.5">
              <span className="text-[10px] text-[var(--muted)] w-5 shrink-0">{b.label}</span>
              <div className="w-10 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
                <div className={`h-full rounded-full ${b.color}`} style={{ width: `${Math.max(0, Math.min(100, b.value))}%` }} />
              </div>
              {b.total != null && b.total > 0 && (
                <span className="text-[9px] tabular-nums text-[var(--muted)] leading-none">
                  {b.pass}/{b.total}
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="flex-1 min-w-0" />

        {/* 현재가(등락률) */}
        <span className="text-xs tabular-nums shrink-0 text-right">
          <span className="text-[var(--muted)]">{item.current_price?.toLocaleString() ?? '-'}원</span>
          <span className={`ml-0.5 font-bold ${pctCls}`}>
            ({pct != null ? `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%` : '-'})
          </span>
        </span>

        {/* 신호경과(Gap) */}
        {(signalAge || signalGap != null) && (
          <span className="text-[11px] tabular-nums shrink-0 text-[var(--muted)]" title={signalGap != null ? `신호가 ${item.latest_signal_price?.toLocaleString()}원 대비` : undefined}>
            {signalAge ?? ''}
            {signalGap != null && (
              <span className={`ml-0.5 font-semibold ${signalGap >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                ({signalGap >= 0 ? '+' : ''}{signalGap.toFixed(1)}%)
              </span>
            )}
          </span>
        )}

        {/* 우클릭 메뉴 버튼 */}
        <button
          onClick={(e) => { e.stopPropagation(); onMenuOpen(e); }}
          className="shrink-0 p-1 rounded text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--card-hover)] transition-colors"
          aria-label="메뉴"
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export function StockAnalysisSection({
  initialDateMode = 'today',
  favoriteSymbols,
  watchlistSymbols,
  groups: initialGroups = [],
  symbolGroups: initialSymbolGroups = {},
}: StockAnalysisSectionProps) {
  // AI 신호탭의 "오늘" 기준과 동일하게 마지막 평일을 사용
  // (주말/공휴일에 실제 오늘 날짜로 계산하면 신호가 없어 빈 결과 표시됨)
  const todayStr = useMemo(() => getLastNWeekdays(1)[0], []);

  // 스타일
  const [styleId, setStyleId] = useState('balanced');
  const [styleWeights, setStyleWeights] = useState<StyleWeights | undefined>(undefined);
  const [styleDisabledConds, setStyleDisabledConds] = useState<string[] | undefined>(undefined);

  // 데이터
  const { data, loading, doFetch } = useUnifiedRanking();

  // 필터 / 정렬 / 검색
  const [q, setQ] = useState('');
  const [market, setMarket] = useState<MarketFilter>('all');
  const [dateMode, setDateMode] = useState<'today' | 'signal_all' | 'all'>(initialDateMode ?? 'today');
  const [sort, setSort] = useState<SortMode>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [visibleCount, setVisibleCount] = useState(50);
  const PAGE_SIZE = 50;
  const sentinelRef = useRef<HTMLDivElement>(null);

  // 노이즈 필터 / 트래커 / 투자성격 필터
  const [noiseFilter, setNoiseFilter] = useState(false);
  const [trackerOpen, setTrackerOpen] = useState(false);
  const [charFilter, setCharFilter] = useState<string>('all');

  // 스냅샷
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const handleSaveSnapshot = useCallback(async () => {
    setSavingSnapshot(true);
    try {
      await window.fetch('/api/v1/stock-ranking/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'standard' }),
      });
    } finally {
      setSavingSnapshot(false);
    }
  }, []);

  // 즐겨찾기 / 워치리스트
  const [favs, setFavs] = useState<Set<string>>(new Set(favoriteSymbols));
  const portSet = useMemo(() => new Set(watchlistSymbols), [watchlistSymbols]);
  const [groups] = useState<WatchlistGroup[]>(initialGroups);
  const [symGroups, setSymGroups] = useState<Record<string, string[]>>(initialSymbolGroups);

  // 컨텍스트 메뉴
  const [menu, setMenu] = useState<MenuState>({
    isOpen: false, symbol: '', name: '', currentPrice: null, isFavorite: false,
    position: { x: 0, y: 0 },
  });

  // 호버 카드
  const { history, fetchHistory } = useScoreHistory();
  const [hover, setHover] = useState<HoverState>({ item: null, x: 0, y: 0 });
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 모달 오픈
  const { openStockModal } = useStockModal();

  // ── 동기화 ───────────────────────────────────────────────────────────────────
  useEffect(() => { setFavs(new Set(favoriteSymbols)); }, [favoriteSymbols]);

  // ── 데이터 조회 ───────────────────────────────────────────────────────────────
  const getDateParam = useCallback(
    (mode: 'today' | 'signal_all' | 'all') => (mode === 'today' ? todayStr : mode),
    [todayStr],
  );

  useEffect(() => {
    doFetch(styleId, getDateParam(initialDateMode ?? 'today'), market, styleWeights, styleDisabledConds);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 핸들러 ───────────────────────────────────────────────────────────────────
  const resetScroll = () => setVisibleCount(PAGE_SIZE);

  const handleStyleChange = useCallback((id: string, weights?: StyleWeights, disabledConds?: string[]) => {
    setStyleId(id);
    setStyleWeights(weights);
    setStyleDisabledConds(disabledConds);
    resetScroll();
    doFetch(id, getDateParam(dateMode), market, weights, disabledConds);
  }, [dateMode, doFetch, getDateParam, market]);

  const handleDateMode = useCallback((mode: 'today' | 'signal_all' | 'all') => {
    setDateMode(mode);
    resetScroll(); setQ(''); setMarket('all');
    doFetch(styleId, getDateParam(mode), 'all', styleWeights, styleDisabledConds);
  }, [styleId, styleWeights, styleDisabledConds, doFetch, getDateParam]);

  const handleMarket = useCallback((mkt: MarketFilter) => {
    setMarket(mkt);
    resetScroll();
    doFetch(styleId, getDateParam(dateMode), mkt, styleWeights, styleDisabledConds);
  }, [styleId, styleWeights, styleDisabledConds, dateMode, doFetch, getDateParam]);

  const handleSearch = (v: string) => { setQ(v); resetScroll(); };

  const handleSortChange = (by: SortMode) => {
    if (by === sort) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSort(by);
      setSortDir('desc');
    }
  };

  // ── 호버 ─────────────────────────────────────────────────────────────────────
  const handleHoverEnter = useCallback((e: React.MouseEvent, item: StockRankItem) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    const x = e.clientX;
    const y = e.clientY;
    hoverTimerRef.current = setTimeout(() => {
      setHover({ item, x, y });
      fetchHistory(item.symbol);
    }, 300);
  }, [fetchHistory]);

  const handleHoverLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHover({ item: null, x: 0, y: 0 });
  }, []);

  useEffect(() => () => { if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current); }, []);

  // ── 클릭 ─────────────────────────────────────────────────────────────────────
  const handleItemClick = useCallback((item: StockRankItem) => {
    openStockModal(item.symbol, item.name ?? undefined, item);
  }, [openStockModal]);

  // ── 컨텍스트 메뉴 ────────────────────────────────────────────────────────────
  const openMenu = useCallback((e: React.MouseEvent, item: StockRankItem) => {
    e.stopPropagation();
    setMenu({
      isOpen: true,
      symbol: item.symbol,
      name: item.name ?? '',
      currentPrice: item.current_price,
      isFavorite: favs.has(item.symbol),
      position: { x: e.clientX, y: e.clientY },
      initialData: item,
    });
  }, [favs]);

  const closeMenu = () => setMenu((m) => ({ ...m, isOpen: false }));

  const handleToggleFavorite = useCallback(async () => {
    const { symbol, name } = menu;
    const isFav = favs.has(symbol);
    if (isFav) {
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
      console.error('[StockAnalysisSection] handleGroupToggle 실패, 롤백:', e);
      setSymGroups((prev) => ({ ...prev, [symbol]: currentGroups }));
      if (!inGroup) {
        if (currentGroups.length === 0) setFavs((prev) => { const n = new Set(prev); n.delete(symbol); return n; });
      } else {
        setFavs((prev) => new Set([...prev, symbol]));
      }
    }
  }, [menu, symGroups]);

  // ── 정렬 / 필터 ──────────────────────────────────────────────────────────────
  const rawItems = useMemo(() => data?.items ?? [], [data]);

  const sortedItems = useMemo(() => {
    const list = [...rawItems];
    switch (sort) {
      case 'name':
        list.sort((a, b) => {
          const cmp = (a.name ?? '').localeCompare(b.name ?? '', 'ko');
          return sortDir === 'desc' ? -cmp : cmp;
        });
        break;
      case 'change':
        list.sort((a, b) => {
          const pa = a.price_change_pct ?? (sortDir === 'asc' ? Infinity : -Infinity);
          const pb = b.price_change_pct ?? (sortDir === 'asc' ? Infinity : -Infinity);
          return sortDir === 'desc' ? pb - pa : pa - pb;
        });
        break;
      default: // score
        list.sort((a, b) => {
          const diff = b.score_total - a.score_total;
          return sortDir === 'desc' ? diff : -diff;
        });
        break;
    }
    return list;
  }, [rawItems, sort, sortDir]);

  const filteredBySearch = useMemo(() => {
    if (!q) return sortedItems;
    const lower = q.toLowerCase();
    return sortedItems.filter(
      (s) => s.name?.toLowerCase().includes(lower) || s.symbol?.toLowerCase().includes(lower),
    );
  }, [sortedItems, q]);

  const filteredByNoise = useMemo(() => {
    if (!noiseFilter) return filteredBySearch;
    return filteredBySearch.filter((item) => {
      const r = item as unknown as Record<string, unknown>;
      const tvRaw = (r.daily_trading_value as number | null) ?? (r.trading_value as number | null) ?? null;
      const avgTvRaw = (r.avg_trading_value_20d as number | null) ?? null;
      const tr = (r.turnover_rate as number) ?? 0;
      const managed = (r.is_managed as boolean) ?? false;
      const cbw = (r.has_recent_cbw as boolean) ?? false;
      const shRaw = (r.major_shareholder_pct as number | null) ?? null;
      const mc = (r.market_cap as number) ?? 0;
      const isLargeCap = mc >= 10_000;
      if (tvRaw != null && tvRaw < 10_000_000_000) return false;
      if (avgTvRaw != null && avgTvRaw > 0 && avgTvRaw < 5_000_000_000) return false;
      if (!isLargeCap && tr > 0 && tr < 1) return false;
      if (managed) return false;
      if (cbw) return false;
      if (shRaw != null && shRaw > 0 && shRaw < 20) return false;
      return true;
    });
  }, [filteredBySearch, noiseFilter]);

  const filteredByChar = useMemo(() => {
    if (charFilter === 'all') return filteredByNoise;
    return filteredByNoise.filter((item) => getCharacters(item).includes(charFilter));
  }, [filteredByNoise, charFilter]);

  const displayTotal = filteredByChar.length;
  const displayItems = filteredByChar.slice(0, visibleCount);
  const hasMore = visibleCount < displayTotal;

  // ── 무한스크롤 ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !loading) {
          setVisibleCount((prev) => prev + PAGE_SIZE);
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading]);

  // ── 호버카드 위치 계산 (화면 경계 처리) ──────────────────────────────────────
  const hoverCardStyle = useMemo(() => {
    if (!hover.item) return {};
    const cardW = 380;
    const cardH = 220;
    const margin = 12;
    let left = hover.x + margin;
    let top = hover.y + margin;
    if (typeof window !== 'undefined') {
      if (left + cardW > window.innerWidth - margin) left = hover.x - cardW - margin;
      if (top + cardH > window.innerHeight - margin) top = hover.y - cardH - margin;
    }
    return { left, top };
  }, [hover.x, hover.y, hover.item]);

  const MARKET_BUTTONS: { key: MarketFilter; label: string }[] = [
    { key: 'all',    label: '전체'   },
    { key: 'KOSPI',  label: 'KOSPI'  },
    { key: 'KOSDAQ', label: 'KOSDAQ' },
  ];

  const SORT_BUTTONS: { key: SortMode; label: string }[] = [
    { key: 'score',  label: '점수순'  },
    { key: 'name',   label: '이름순'  },
    { key: 'change', label: '등락률순' },
  ];

  const CHAR_OPTIONS = [
    { key: 'all',           label: '투자성격' },
    { key: 'early_rise',    label: '🚀상승초입' },
    { key: 'value',         label: '💎가치주' },
    { key: 'supply_strong', label: '🏦수급강세' },
    { key: 'tech_rebound',  label: '📈기술반등' },
    { key: 'multi_signal',  label: '⚡다중신호' },
    { key: 'top_pick',      label: '⭐종합추천' },
    { key: 'overheated',    label: '⚠️과열주의' },
  ];

  const iconBtnCls = 'p-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:bg-[var(--card-hover)] transition-colors disabled:opacity-50';
  const snapshotLabel = data?.snapshot_time ? formatTimeAgo(data.snapshot_time) : null;

  return (
    <div className="space-y-3">
      {/* ── 필터 바 ── */}
      <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap">

        {/* 검색 */}
        <input
          type="text"
          value={q}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="검색..."
          className="w-24 sm:w-28 px-2.5 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--card)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)] shrink-0"
        />

        {/* 이중 구분선 */}
        <span className="hidden sm:flex items-center gap-0.5 shrink-0">
          <span className="w-px h-5 bg-[var(--border)]" />
          <span className="w-px h-5 bg-[var(--border)]" />
        </span>

        {/* 가중치 필터 (스타일 셀렉터) */}
        <StyleSelector currentStyleId={styleId} onStyleChange={handleStyleChange} />

        {/* 투자성격 필터 */}
        <select
          value={charFilter}
          onChange={(e) => { setCharFilter(e.target.value); resetScroll(); }}
          className={`text-xs px-2 py-1.5 rounded-lg border shrink-0 bg-[var(--card)] cursor-pointer focus:outline-none transition-colors ${
            charFilter !== 'all'
              ? 'border-[var(--accent)] text-[var(--accent)]'
              : 'border-[var(--border)] text-[var(--muted)]'
          }`}
        >
          {CHAR_OPTIONS.map(({ key, label }) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>

        {/* 날짜 모드 */}
        <div className="flex rounded-lg border border-[var(--border)] overflow-hidden text-xs shrink-0">
          {([
            { key: 'today', label: '오늘' },
            { key: 'signal_all', label: '신호전체' },
            { key: 'all', label: '전체종목' },
          ] as const).map(({ key, label }) => (
            <button key={key} onClick={() => handleDateMode(key)}
              className={`px-2.5 py-1.5 transition-colors ${dateMode === key ? 'bg-[var(--accent)] text-white' : 'bg-[var(--card)] text-[var(--muted)] hover:bg-[var(--card-hover)]'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* 마켓 필터 */}
        <div className="flex rounded-lg border border-[var(--border)] overflow-hidden text-xs shrink-0">
          {MARKET_BUTTONS.map(({ key, label }) => (
            <button key={key} onClick={() => handleMarket(key)}
              className={`px-2.5 py-1.5 transition-colors ${market === key ? 'bg-[var(--accent)] text-white' : 'bg-[var(--card)] text-[var(--muted)] hover:bg-[var(--card-hover)]'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* 구분선 */}
        <span className="hidden sm:block w-px h-5 bg-[var(--border)] shrink-0" />

        {/* 정렬 */}
        <div className="hidden sm:flex rounded-lg border border-[var(--border)] overflow-hidden text-xs shrink-0">
          {SORT_BUTTONS.map(({ key, label }) => (
            <button key={key} onClick={() => handleSortChange(key)}
              className={`px-2.5 py-1.5 transition-colors flex items-center gap-0.5 ${sort === key ? 'bg-[var(--accent)] text-white' : 'bg-[var(--card)] text-[var(--muted)] hover:bg-[var(--card-hover)]'}`}>
              {label}
              {sort === key && <span className="text-[10px]">{sortDir === 'desc' ? '↓' : '↑'}</span>}
            </button>
          ))}
        </div>

        {/* 노이즈제외 토글 버튼 */}
        <button
          type="button"
          onClick={() => setNoiseFilter((v) => !v)}
          className={`hidden sm:inline-flex items-center px-2.5 py-1.5 text-xs rounded-lg border transition-colors shrink-0 ${
            noiseFilter
              ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
              : 'bg-[var(--card)] text-[var(--muted)] border-[var(--border)] hover:bg-[var(--card-hover)]'
          }`}
        >
          노이즈제외
        </button>

        {/* 우측 액션 버튼들 */}
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          <button type="button" onClick={handleSaveSnapshot} disabled={savingSnapshot} title="스냅샷 저장" className={iconBtnCls}>
            {savingSnapshot ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
          </button>
          <button type="button" onClick={() => setTrackerOpen(true)} title="순위 트래킹" className={iconBtnCls}>
            <BarChart3 size={15} />
          </button>
          {/* 새로고침 + 업데이트 시각 */}
          <div className="flex items-center gap-1">
            {snapshotLabel && (
              <span className="hidden sm:inline text-[10px] text-[var(--muted)] whitespace-nowrap">{snapshotLabel}</span>
            )}
            <button
              onClick={() => doFetch(styleId, getDateParam(dateMode), market, styleWeights, styleDisabledConds)}
              disabled={loading} title="새로고침" className={iconBtnCls}
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <span className="text-sm leading-none">↺</span>}
            </button>
          </div>
        </div>
      </div>

      {/* SnapshotTracker 모달 */}
      {trackerOpen && (
        <SnapshotTracker onClose={() => setTrackerOpen(false)} scoreMode="standard" />
      )}

      {/* ── 종목수 표시 ── */}
      <div className="text-xs text-[var(--muted)]">
        {displayTotal.toLocaleString()}종목
        {data?.total && data.total !== displayTotal ? ` / ${data.total.toLocaleString()}전체` : ''}
      </div>

      {/* ── 리스트 ── */}
      {loading && displayItems.length === 0 && (
        <div className="py-16 text-center text-[var(--muted)] text-sm">로딩 중...</div>
      )}
      {!loading && displayItems.length === 0 && (
        <div className="py-16 text-center text-[var(--muted)] text-sm">
          {dateMode === 'signal_all' ? '검색 결과가 없습니다' : '해당 날짜에 신호가 없습니다'}
        </div>
      )}

      <div
        className={`rounded-xl border border-[var(--border)] bg-[var(--card)] divide-y divide-[var(--border)] overflow-hidden ${loading ? 'opacity-60' : ''}`}
      >
        {displayItems.map((item, idx) => (
          <StockRow
            key={`${item.symbol}-${idx}`}
            item={item}
            rank={idx + 1}
            favs={favs}
            onClick={() => handleItemClick(item)}
            onMenuOpen={(e) => openMenu(e, item)}
            onHoverEnter={handleHoverEnter}
            onHoverLeave={handleHoverLeave}
          />
        ))}
      </div>

      {/* ── 무한스크롤 sentinel ── */}
      <div ref={sentinelRef} className="py-4 text-center text-xs text-[var(--muted)]">
        {hasMore
          ? `${displayItems.length} / ${displayTotal}종목 표시 중...`
          : displayTotal > 0
          ? `전체 ${displayTotal}종목`
          : ''}
      </div>

      {/* ── 호버 카드 (fixed 포지셔닝) ── */}
      {hover.item && (
        <div
          className="fixed z-50 pointer-events-none"
          style={hoverCardStyle}
        >
          <AnalysisHoverCard item={hover.item} history={history} style={styleId} />
        </div>
      )}

      {/* ── 컨텍스트 메뉴 ── */}
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
        initialData={menu.initialData}
      />
    </div>
  );
}
