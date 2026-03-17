'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { StockRankItem } from '@/app/api/v1/stock-ranking/route';
import StockActionMenu from '@/components/common/stock-action-menu';
import { getLastNWeekdays } from '@/lib/date-utils';
import { FilterBar } from '@/components/common/filter-bar';
import { usePriceRefresh } from '@/hooks/use-price-refresh';
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
  technical: number;
  valuation: number;
  supply: number;
}

// ── 상수 ──────────────────────────────────────────────────────────────────────
const SOURCE_LABELS: Record<string, string> = {
  quant: '퀀트',
  lassi: '라씨',
  stockbot: '스톡봇',
};

const SOURCE_DOTS: Record<string, string> = {
  quant: 'bg-blue-400',
  lassi: 'bg-red-400',
  stockbot: 'bg-green-400',
};

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
type InvestmentCharacter = 'short_surge' | 'value' | 'supply_strong' | 'tech_rebound' | 'multi_signal' | 'top_pick';

interface CharacterDef {
  key: InvestmentCharacter;
  label: string;
  icon: string;
  variant: BadgeVariant;
}

const CHARACTER_DEFS: CharacterDef[] = [
  { key: 'short_surge',   label: '단기급등',  icon: '🔥', variant: 'red' },
  { key: 'value',         label: '가치주',    icon: '💎', variant: 'purple' },
  { key: 'supply_strong', label: '수급강세',  icon: '🏦', variant: 'blue' },
  { key: 'tech_rebound',  label: '기술반등',  icon: '📈', variant: 'green' },
  { key: 'multi_signal',  label: '다중신호',  icon: '⚡', variant: 'orange' },
  { key: 'top_pick',      label: '종합추천',  icon: '⭐', variant: 'gold' },
];

const CHARACTER_FILTER_OPTIONS = [
  { key: 'all', label: '전체' },
  ...CHARACTER_DEFS.map(d => ({ key: d.key, label: `${d.icon} ${d.label}` })),
];


// ── 점수 정규화 ───────────────────────────────────────────────────────────────
function normScores(item: StockRankItem) {
  if (item.ai) {
    return {
      sig: Math.round(item.ai.signal_score / 30 * 100),
      tech: Math.round(item.ai.technical_score / 30 * 100),
      val: Math.round(item.ai.valuation_score / 20 * 100),
      sup: Math.round(item.ai.supply_score / 20 * 100),
    };
  }
  return {
    sig: Math.round(item.score_signal / 30 * 100),
    tech: Math.round(item.score_momentum / 30 * 100),
    val: Math.round(item.score_valuation / 20 * 100),
    sup: Math.round(item.score_supply / 20 * 100),
  };
}

// ── 가중치 합산 점수 ──────────────────────────────────────────────────────────
function computeWeighted(item: StockRankItem, w: Weights): number {
  const total = w.signal + w.technical + w.valuation + w.supply || 1;
  const scores = normScores(item);
  return (scores.sig * w.signal + scores.tech * w.technical + scores.val * w.valuation + scores.sup * w.supply) / total;
}

function getInvestmentCharacters(item: StockRankItem, weights: Weights): InvestmentCharacter[] {
  const chars: InvestmentCharacter[] = [];
  const { sig, tech, val, sup } = normScores(item);
  const weighted = computeWeighted(item, weights);

  // 단기급등: 기술점수 높고 + 모멘텀 패턴 감지
  if (item.ai) {
    if (tech >= 60 && (item.ai.golden_cross || item.ai.macd_cross || item.ai.volume_surge)) {
      chars.push('short_surge');
    }
  } else if (tech >= 60 && item.price_change_pct !== null && item.price_change_pct > 3) {
    chars.push('short_surge');
  }

  // 가치주: 밸류점수 70 이상
  if (val >= 70) chars.push('value');

  // 수급강세: 수급점수 60 이상
  if (sup >= 60) chars.push('supply_strong');

  // 기술반등: 불새패턴 또는 (볼린저하단 + RSI<40)
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

  if (item.ai) {
    if (item.ai.golden_cross) reasons.push('골든크로스');
    if (item.ai.macd_cross) reasons.push('MACD돌파');
    if (item.ai.phoenix_pattern) reasons.push('V자반등');
    if (item.ai.bollinger_bottom) reasons.push('볼린저반등');
    if (item.ai.volume_surge) reasons.push('거래량급증');
    if (item.ai.week52_low_near) reasons.push('52주저점');
    if (item.ai.foreign_buying) reasons.push('외국인매수');
    if (item.ai.institution_buying) reasons.push('기관매수');
    if (item.ai.volume_vs_sector) reasons.push('섹터주목');
    if (item.ai.low_short_sell) reasons.push('공매도↓');
    if (item.ai.rsi !== null && item.ai.rsi < 30) reasons.push(`RSI${item.ai.rsi.toFixed(0)}과매도`);
    if (item.ai.double_top) reasons.push('⚠쌍봉주의');
  }

  if (item.per !== null && item.per > 0 && item.per < 10) reasons.push(`PER${item.per.toFixed(1)}`);
  if (item.pbr !== null && item.pbr > 0 && item.pbr < 1) reasons.push(`PBR${item.pbr.toFixed(2)}`);
  if (item.roe !== null && item.roe > 10) reasons.push(`ROE${item.roe.toFixed(0)}%`);

  const cnt = item.signal_count_30d ?? 0;
  if (cnt >= 3) reasons.push(`신호${cnt}회`);

  if (item.price_change_pct !== null && item.price_change_pct > 3) reasons.push(`+${item.price_change_pct.toFixed(1)}%급등`);

  return reasons.join(' · ') || '분석 데이터 부족';
}

function fmtNum(v: number | null, d = 1) { return v == null ? '-' : v.toFixed(d); }
function fmtPrice(v: number | null) { return v == null ? '-' : v.toLocaleString() + '원'; }

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

const LAST7 = getLastNWeekdays(7);

// ── RankCard 컴포넌트 (컴팩트 2줄) ──────────────────────────────────────────────
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

  return (
    <div
      onClick={onClick}
      className={`px-4 py-2.5 cursor-pointer hover:bg-[var(--card-hover)] transition-colors select-none ${
        isWarning ? 'bg-orange-50/60 dark:bg-orange-950/10' : ''
      }`}
    >
      {/* ── 줄 1: 순위 · 종목명 · 성격태그 · 점수 · 등락 ── */}
      <div className="flex items-center gap-2 min-w-0">
        <span className={`text-sm font-bold tabular-nums w-6 shrink-0 text-right ${hasAi ? 'text-blue-500' : 'text-[var(--muted)]'}`}>
          {rank}
        </span>

        <div className="flex items-center gap-1.5 min-w-0 shrink-0">
          <span className="font-semibold text-[15px] leading-snug truncate max-w-[7rem] sm:max-w-[10rem]">{item.name}</span>
          {favs.has(item.symbol) && <span className="text-yellow-400 text-xs">★</span>}
        </div>

        {/* 성격 태그 */}
        {/* 성격 태그 — 데스크탑 최대 3개 */}
        {characters.length > 0 && (
          <div className="hidden sm:flex items-center gap-1 shrink-0">
            {characters.slice(0, 3).map(charKey => {
              const def = CHARACTER_DEFS.find(d => d.key === charKey)!;
              return (
                <span key={charKey} className={`px-1.5 py-0.5 rounded text-[11px] font-bold leading-none ${BADGE_CLS[def.variant]}`}>
                  {def.icon} {def.label}
                </span>
              );
            })}
          </div>
        )}
        {/* 성격 태그 — 모바일 최대 2개 */}
        {characters.length > 0 && (
          <div className="sm:hidden flex items-center gap-1 shrink-0">
            {characters.slice(0, 2).map(charKey => {
              const def = CHARACTER_DEFS.find(d => d.key === charKey)!;
              return (
                <span key={charKey} className={`px-1.5 py-0.5 rounded text-[11px] font-bold leading-none ${BADGE_CLS[def.variant]}`}>
                  {def.icon} {def.label}
                </span>
              );
            })}
          </div>
        )}

        <div className="flex-1 min-w-0" />

        {/* 점수 */}
        <span className={`text-base font-bold tabular-nums shrink-0 ${
          weighted >= 60 ? 'text-green-600 dark:text-green-400'
          : weighted >= 40 ? 'text-blue-600 dark:text-blue-400'
          : 'text-[var(--text)]'
        }`}>{weighted.toFixed(0)}<span className="text-[10px] font-normal text-[var(--muted)] ml-0.5">pt</span></span>

        {/* Gap */}
        {gapInfo && (
          <span className={`text-xs font-bold tabular-nums shrink-0 ${gapInfo.gap >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
            {gapInfo.gap >= 0 ? '+' : ''}{gapInfo.gap.toFixed(1)}%
          </span>
        )}

        {/* 등락 + 현재가 */}
        <div className="shrink-0 text-right">
          <span className={`text-xs font-semibold tabular-nums ${
            pct != null && pct > 0 ? 'text-red-500' : pct != null && pct < 0 ? 'text-blue-500' : 'text-[var(--muted)]'
          }`}>
            {pct != null ? `${pct > 0 ? '+' : ''}${fmtNum(pct)}%` : '-'}
          </span>
          <span className="text-[11px] text-[var(--muted)] tabular-nums ml-1.5">{item.current_price?.toLocaleString() ?? '-'}</span>
        </div>
      </div>

      {/* ── 줄 2: 추천근거 + 미니 점수바 ── */}
      <div className="flex items-start gap-3 mt-1 pl-8">
        {/* 추천근거 — 전체 표시 (줄바꿈 허용) */}
        <p className="text-xs text-[var(--muted)] leading-relaxed flex-1 min-w-0">{reason}</p>

        {/* 미니 점수바 (데스크탑) */}
        <div className="hidden sm:flex items-center gap-2 shrink-0 pt-0.5">
          {[
            { label: '신', value: sig, color: 'bg-amber-400' },
            { label: '기', value: tech, color: 'bg-emerald-400' },
            { label: '밸', value: val, color: 'bg-violet-400' },
            { label: '수', value: sup, color: 'bg-sky-400' },
          ].map(b => (
            <div key={b.label} className="flex items-center gap-0.5">
              <span className="text-[10px] text-[var(--muted)]">{b.label}</span>
              <div className="w-10 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
                <div className={`h-full rounded-full ${b.color}`} style={{ width: `${Math.max(0, Math.min(100, b.value))}%` }} />
              </div>
            </div>
          ))}
        </div>
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
    { key: 'technical' as const, label: '기술/모멘텀' },
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
  const [selectedDate, setSelectedDate] = useState<string>(LAST7[0]);
  const [data, setData] = useState<RankingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [market, setMarket] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [favs, setFavs] = useState<Set<string>>(new Set(favoriteSymbols));
  const [showWeights, setShowWeights] = useState(false);
  const [weights, setWeights] = useState<Weights>({ signal: 20, technical: 40, valuation: 10, supply: 30 });
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
  const LIMIT = 100;

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

  // ── 데이터 조회 ───────────────────────────────────────────────────────────────
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

  useEffect(() => { doFetch(LAST7[0], '', 'all', 1); }, [doFetch]);
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

  // ── 정렬 ──────────────────────────────────────────────────────────────────────
  const sortedItems = useMemo(() => [...rawItems].sort((a, b) => {
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
    // score (default + fallback for updated)
    const aHasAi = a.ai ? 1 : 0;
    const bHasAi = b.ai ? 1 : 0;
    if (aHasAi !== bHasAi) return bHasAi - aHasAi;
    return computeWeighted(b, weights) - computeWeighted(a, weights);
  }), [rawItems, sort, weights, sourceFilter, signalMap, livePrices, gapAsc]);

  // ── 투자성격 필터 ────────────────────────────────────────────────────────────
  const filteredByChar = useMemo(() => {
    if (charFilter === 'all') return sortedItems;
    return sortedItems.filter(item => {
      const chars = getInvestmentCharacters(item, weights);
      return chars.includes(charFilter as InvestmentCharacter);
    });
  }, [sortedItems, charFilter, weights]);

  const total = data?.total ?? 0;
  const displayTotal = filteredByChar.length;
  const totalPages = Math.ceil(displayTotal / LIMIT);
  const offset = (page - 1) * LIMIT;
  const displayItems = filteredByChar.slice(offset, offset + LIMIT);
  const aiCount = rawItems.filter((i) => i.ai).length;

  return (
    <div className="space-y-3">
      {/* ── 필터 바 ── */}
      <div className="relative">
        <FilterBar
          date={{ dates: LAST7, selected: selectedDate, onChange: handleDate, extraAll: { value: 'signal_all', label: '신호전체' }, allLabel: '종목전체', label: '날짜' }}
          source={{ options: SOURCE_OPTIONS, selected: sourceFilter, onChange: (s) => setSourceFilter(s as SourceFilter), label: '소스' }}
          character={{ options: CHARACTER_FILTER_OPTIONS, selected: charFilter, onChange: (c) => { setCharFilter(c); setPage(1); }, label: '성격' }}
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
        {displayItems.map((item, idx) => {
          const w = computeWeighted(item, weights);
          const gapInfo = getGapInfo(item, signalMap, sourceFilter, livePrices);
          const characters = getInvestmentCharacters(item, weights);
          return (
            <RankCard
              key={item.symbol}
              item={item}
              rank={offset + idx + 1}
              weighted={w}
              favs={favs}
              gapInfo={gapInfo}
              onClick={(e) => openMenu(e, item.symbol, item.name, item.current_price)}
              characters={characters}
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
        isInPortfolio={portSet.has(menu.symbol)}
        onToggleFavorite={handleToggleFavorite}
        groups={groups}
        symbolGroupIds={symGroups[menu.symbol] ?? []}
        onGroupToggle={handleGroupToggle}
      />
    </div>
  );
}
