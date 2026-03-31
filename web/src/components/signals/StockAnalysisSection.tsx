'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { StockRankItem } from '@/app/api/v1/stock-ranking/route';
import StockActionMenu from '@/components/common/stock-action-menu';
import { GradeTooltip } from '@/components/common/grade-tooltip';
import { useUnifiedRanking } from '@/hooks/use-unified-ranking';
import { useScoreHistory } from '@/hooks/use-score-history';
import { useStockModal } from '@/contexts/stock-modal-context';
import { StyleSelector } from './StyleSelector';
import { AnalysisHoverCard } from './AnalysisHoverCard';
import type { WatchlistGroup } from '@/types/stock';
import type { StyleWeights } from '@/lib/unified-scoring/types';

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
function getCategoryScores(item: StockRankItem) {
  const clamp = (v: number) => Math.round(Math.min(100, Math.max(0, v)));
  if (item.categories) {
    return {
      signalTech: clamp(item.categories.signalTech.normalized),
      supply:     clamp(item.categories.supply.normalized),
      valueGrowth: clamp(item.categories.valueGrowth.normalized),
      momentum:   clamp(item.categories.momentum.normalized),
    };
  }
  // 구형 필드 fallback
  return {
    signalTech:  clamp(item.score_signal),
    supply:      clamp(item.score_supply),
    valueGrowth: clamp(item.score_valuation),
    momentum:    clamp(item.score_momentum),
  };
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

  const miniBars = [
    { label: '신호', value: scores.signalTech, color: 'bg-amber-500' },
    { label: '수급', value: scores.supply,     color: 'bg-sky-500' },
    { label: '가치', value: scores.valueGrowth, color: 'bg-violet-500' },
    { label: '모멘텀', value: scores.momentum,  color: 'bg-emerald-500' },
  ];

  return (
    <div
      onClick={onClick}
      onMouseEnter={(e) => onHoverEnter(e, item)}
      onMouseLeave={onHoverLeave}
      className="px-3 sm:px-4 py-2 sm:py-2.5 cursor-pointer hover:bg-[var(--card-hover)] transition-colors select-none"
    >
      {/* 줄 1: 순위 · 종목명 · 즐겨찾기 · 등급 · 등락률 · 현재가 */}
      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
        <span className="text-sm font-bold tabular-nums w-6 shrink-0 text-right text-[var(--muted)]">
          {rank}
        </span>

        <span className="font-semibold text-sm sm:text-[15px] truncate max-w-[6rem] sm:max-w-[10rem]">
          {item.name}
        </span>
        {favs.has(item.symbol) && <span className="text-yellow-400 text-xs shrink-0">★</span>}

        <GradeTooltip
          weighted={item.score_total}
          grade={grade}
          gradeLabel={gradeLabel}
          gradeCls={gradeCls}
          scores={[
            { label: '신호', value: scores.signalTech, color: 'bg-amber-500' },
            { label: '수급', value: scores.supply,     color: 'bg-sky-500' },
            { label: '가치', value: scores.valueGrowth, color: 'bg-violet-500' },
            { label: '모멘텀', value: scores.momentum,  color: 'bg-emerald-500' },
          ]}
        />

        <div className="flex-1 min-w-0" />

        <span className={`text-sm font-bold tabular-nums shrink-0 ${pctCls}`}>
          {pct != null ? `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%` : '-'}
        </span>

        <span className="hidden sm:inline text-xs text-[var(--muted)] tabular-nums shrink-0">
          {item.current_price?.toLocaleString() ?? '-'}원
        </span>

        {/* 점수 바 */}
        <div className="hidden sm:flex items-center gap-1 shrink-0">
          <div className="w-16 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--accent)]"
              style={{ width: `${Math.min(100, Math.max(0, item.score_total))}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-[var(--muted)] w-7 text-right">{item.score_total}</span>
        </div>

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

      {/* 줄 2 (데스크탑): 4카테고리 미니바 */}
      <div className="hidden sm:flex items-center gap-3 mt-1 pl-8">
        {miniBars.map((b) => (
          <div key={b.label} className="flex items-center gap-1">
            <span className="text-[10px] text-[var(--muted)] w-7">{b.label}</span>
            <div className="w-14 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
              <div
                className={`h-full rounded-full ${b.color}`}
                style={{ width: `${Math.max(0, Math.min(100, b.value))}%` }}
              />
            </div>
            <span className="text-[10px] tabular-nums text-[var(--muted)] w-5 text-right">{b.value}</span>
          </div>
        ))}
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
  const todayStr = useMemo(
    () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10),
    [],
  );

  // 스타일
  const [styleId, setStyleId] = useState('balanced');

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
    doFetch(styleId, getDateParam(initialDateMode ?? 'today'), market);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 핸들러 ───────────────────────────────────────────────────────────────────
  const resetScroll = () => setVisibleCount(PAGE_SIZE);

  const handleStyleChange = useCallback((id: string) => {
    setStyleId(id);
    resetScroll();
    doFetch(id, getDateParam(dateMode), market);
  }, [dateMode, doFetch, getDateParam, market]);

  const handleDateMode = useCallback((mode: 'today' | 'signal_all' | 'all') => {
    setDateMode(mode);
    resetScroll(); setQ(''); setMarket('all');
    doFetch(styleId, getDateParam(mode), 'all');
  }, [styleId, doFetch, getDateParam]);

  const handleMarket = useCallback((mkt: MarketFilter) => {
    setMarket(mkt);
    resetScroll();
    doFetch(styleId, getDateParam(dateMode), mkt);
  }, [styleId, dateMode, doFetch, getDateParam]);

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
    openStockModal(item.symbol, item.name, item);
  }, [openStockModal]);

  // ── 컨텍스트 메뉴 ────────────────────────────────────────────────────────────
  const openMenu = useCallback((e: React.MouseEvent, item: StockRankItem) => {
    e.stopPropagation();
    setMenu({
      isOpen: true,
      symbol: item.symbol,
      name: item.name,
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
  const rawItems = data?.items ?? [];

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

  const displayTotal = filteredBySearch.length;
  const displayItems = filteredBySearch.slice(0, visibleCount);
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

  return (
    <div className="space-y-3">
      {/* ── 스타일 셀렉터 + 필터 바 ── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* 스타일 셀렉터 */}
        <StyleSelector currentStyleId={styleId} onStyleChange={handleStyleChange} />

        {/* 날짜 모드 */}
        <div className="flex rounded-lg border border-[var(--border)] overflow-hidden text-xs">
          {([
            { key: 'today', label: '오늘' },
            { key: 'signal_all', label: '신호전체' },
            { key: 'all', label: '전체종목' },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => handleDateMode(key)}
              className={`px-2.5 py-1.5 transition-colors ${
                dateMode === key
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--card)] text-[var(--muted)] hover:bg-[var(--card-hover)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 마켓 필터 */}
        <div className="flex rounded-lg border border-[var(--border)] overflow-hidden text-xs">
          {MARKET_BUTTONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => handleMarket(key)}
              className={`px-2.5 py-1.5 transition-colors ${
                market === key
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--card)] text-[var(--muted)] hover:bg-[var(--card-hover)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 검색 */}
        <input
          type="text"
          value={q}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="종목명 · 코드 검색"
          className="flex-1 min-w-[120px] max-w-[200px] px-2.5 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--card)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />

        {/* 정렬 */}
        <div className="flex rounded-lg border border-[var(--border)] overflow-hidden text-xs ml-auto">
          {SORT_BUTTONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => handleSortChange(key)}
              className={`px-2.5 py-1.5 transition-colors flex items-center gap-0.5 ${
                sort === key
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--card)] text-[var(--muted)] hover:bg-[var(--card-hover)]'
              }`}
            >
              {label}
              {sort === key && (
                <span className="text-[10px]">{sortDir === 'desc' ? '↓' : '↑'}</span>
              )}
            </button>
          ))}
        </div>

        {/* 새로고침 */}
        <button
          onClick={() => doFetch(styleId, getDateParam(dateMode), market)}
          disabled={loading}
          className="px-2.5 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:bg-[var(--card-hover)] disabled:opacity-50 transition-colors"
          title="새로고침"
        >
          {loading ? '...' : '↺'}
        </button>
      </div>

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
          <AnalysisHoverCard item={hover.item} history={history} />
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
