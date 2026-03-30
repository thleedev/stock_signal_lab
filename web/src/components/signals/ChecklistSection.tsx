'use client';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { Search, RefreshCw, ChevronDown } from 'lucide-react';
import ChecklistFilterPanel from './ChecklistFilterPanel';
import { ALL_CONDITIONS } from '@/lib/checklist-recommendation/types';
import type { ChecklistItem, ConditionCategory, ChecklistGrade } from '@/lib/checklist-recommendation/types';

// ── 상수 ──────────────────────────────────────────────────────────────────────
const GRADE_COLORS: Record<ChecklistGrade, string> = {
  A: 'bg-green-500', B: 'bg-blue-500', C: 'bg-orange-500', D: 'bg-red-500',
};
const GRADE_LABELS: Record<ChecklistGrade, string> = {
  A: '적극매수', B: '매수 고려', C: '관망', D: '주의',
};
const CATEGORY_LABELS: Record<ConditionCategory, string> = {
  trend: '추세', supply: '수급', valuation: '밸류', risk: '리스크',
};
const GRADE_OPTIONS = [
  { key: 'all', label: '전체' },
  { key: 'A', label: 'A 적극매수' },
  { key: 'B', label: 'B 매수 고려' },
  { key: 'C', label: 'C 관망' },
  { key: 'D', label: 'D 주의' },
] as const;
const DATE_OPTIONS = [
  { key: 'today', label: '오늘' },
  { key: 'signal_all', label: '신호전체' },
  { key: 'all', label: '종목전체' },
] as const;
const MARKET_OPTIONS = [
  { key: 'all', label: '전체' },
  { key: 'KOSPI', label: 'KOSPI' },
  { key: 'KOSDAQ', label: 'KOSDAQ' },
  { key: 'ETF', label: 'ETF' },
] as const;
const SORT_OPTIONS = [
  { key: 'ratio', label: '충족률↓' },
  { key: 'name', label: '이름' },
] as const;
type SortMode = 'ratio' | 'name';
type GradeFilter = 'all' | ChecklistGrade;
type DateMode = 'today' | 'signal_all' | 'all';
type MarketFilter = 'all' | 'KOSPI' | 'KOSDAQ' | 'ETF';

// ── 한줄 요약 생성 ───────────────────────────────────────────────────────────
function makeSummary(item: ChecklistItem, activeIds: string[]): string {
  const active = item.conditions.filter(c => activeIds.includes(c.id) && !c.na);
  const met = active.filter(c => c.met);
  const unmet = active.filter(c => !c.met);

  const parts: string[] = [];
  // 충족된 핵심 조건 (최대 3개)
  const highlights = met.slice(0, 3).map(c => c.label);
  if (highlights.length > 0) parts.push(`✅ ${highlights.join(', ')}`);
  // 미충족 경고 (최대 2개)
  const warnings = unmet.slice(0, 2).map(c => c.label);
  if (warnings.length > 0) parts.push(`❌ ${warnings.join(', ')}`);

  return parts.join('  ') || '데이터 부족';
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function ChecklistSection() {
  const [activeIds, setActiveIds] = useState<string[]>(ALL_CONDITIONS.map(c => c.id));
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [expandedSymbols, setExpandedSymbols] = useState<Set<string>>(new Set());

  // 필터/검색 상태
  const [search, setSearch] = useState('');
  const [gradeFilter, setGradeFilter] = useState<GradeFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('ratio');
  const [dateMode, setDateMode] = useState<DateMode>('today');
  const [market, setMarket] = useState<MarketFilter>('all');
  const [conditionPanelOpen, setConditionPanelOpen] = useState(false);

  const fetchData = useCallback(async (ids: string[], date: DateMode, mkt: MarketFilter) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/stock-ranking?mode=checklist&conditions=${ids.join(',')}&date=${date}&market=${mkt}`);
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total_candidates ?? 0);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeIds.length > 0) fetchData(activeIds, dateMode, market);
    else setItems([]);
  }, [activeIds, dateMode, market, fetchData]);

  const handleFilterChange = useCallback((ids: string[]) => {
    setActiveIds(ids);
  }, []);

  const toggleExpand = useCallback((symbol: string) => {
    setExpandedSymbols(prev => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol); else next.add(symbol);
      return next;
    });
  }, []);

  // 필터링 + 정렬
  const filtered = useMemo(() => {
    let result = items;

    // 검색
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(i => i.name.toLowerCase().includes(q) || i.symbol.toLowerCase().includes(q));
    }

    // 등급 필터
    if (gradeFilter !== 'all') {
      result = result.filter(i => i.grade === gradeFilter);
    }

    // 정렬
    if (sortMode === 'name') {
      result = [...result].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    } else {
      result = [...result].sort((a, b) => b.metRatio - a.metRatio);
    }

    return result;
  }, [items, search, gradeFilter, sortMode]);

  const categories = ['trend', 'supply', 'valuation', 'risk'] as ConditionCategory[];

  return (
    <div className="space-y-3">
      {/* ── 필터 바 ── */}
      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
        {/* 검색 */}
        <div className="relative shrink-0">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="검색..."
            className="w-28 sm:w-36 pl-7 pr-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)]"
          />
        </div>

        {/* 날짜 필터 */}
        <div className="flex rounded-lg border border-[var(--border)] overflow-hidden shrink-0">
          {DATE_OPTIONS.map((opt, idx) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setDateMode(opt.key as DateMode)}
              className={[
                'px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap',
                idx > 0 ? 'border-l border-[var(--border)]' : '',
                dateMode === opt.key
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--card)] text-[var(--muted-foreground)] hover:bg-[var(--border)]',
              ].filter(Boolean).join(' ')}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* 시장 필터 */}
        <div className="flex rounded-lg border border-[var(--border)] overflow-hidden shrink-0">
          {MARKET_OPTIONS.map((opt, idx) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setMarket(opt.key as MarketFilter)}
              className={[
                'px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap',
                idx > 0 ? 'border-l border-[var(--border)]' : '',
                market === opt.key
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--card)] text-[var(--muted-foreground)] hover:bg-[var(--border)]',
              ].filter(Boolean).join(' ')}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* 등급 필터 */}
        <div className="hidden sm:flex rounded-lg border border-[var(--border)] overflow-hidden shrink-0">
          {GRADE_OPTIONS.map((opt, idx) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setGradeFilter(opt.key as GradeFilter)}
              className={[
                'px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap',
                idx > 0 ? 'border-l border-[var(--border)]' : '',
                gradeFilter === opt.key
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--card)] text-[var(--muted-foreground)] hover:bg-[var(--border)]',
              ].filter(Boolean).join(' ')}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* 정렬 */}
        <div className="hidden sm:flex rounded-lg border border-[var(--border)] overflow-hidden shrink-0">
          {SORT_OPTIONS.map((opt, idx) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setSortMode(opt.key as SortMode)}
              className={[
                'px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap',
                idx > 0 ? 'border-l border-[var(--border)]' : '',
                sortMode === opt.key
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--card)] text-[var(--muted-foreground)] hover:bg-[var(--border)]',
              ].filter(Boolean).join(' ')}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* 조건 설정 토글 */}
        <button
          type="button"
          onClick={() => setConditionPanelOpen(v => !v)}
          className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
            conditionPanelOpen
              ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
              : 'bg-[var(--card)] text-[var(--muted)] border-[var(--border)] hover:bg-[var(--border)]'
          }`}
        >
          조건 설정
        </button>

        {/* 새로고침 */}
        <button
          type="button"
          aria-label="새로고침"
          onClick={() => fetchData(activeIds, dateMode, market)}
          disabled={loading}
          className="ml-auto p-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:bg-[var(--card-hover)] transition-colors disabled:opacity-50"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ── 조건 필터 패널 (접이식) ── */}
      {conditionPanelOpen && <ChecklistFilterPanel onChange={handleFilterChange} />}

      {/* ── 상태 표시 ── */}
      {loading && <div className="text-center text-sm text-[var(--muted)] py-8">로딩 중...</div>}
      {!loading && items.length === 0 && (
        <div className="text-center text-sm text-[var(--muted)] py-8">오늘 매수 신호 종목이 없습니다</div>
      )}
      {!loading && items.length > 0 && (
        <div className="text-xs text-[var(--muted)]">
          {total}개 종목 중 {filtered.length}개 표시
          {search.trim() && ` (검색: "${search.trim()}")`}
        </div>
      )}

      {/* ── 종목 리스트 ── */}
      <div className="space-y-1">
        {filtered.map(item => {
          const isExpanded = expandedSymbols.has(item.symbol);
          const activeConditions = item.conditions.filter(c => activeIds.includes(c.id));
          const summary = makeSummary(item, activeIds);

          return (
            <div key={item.symbol} className="rounded-lg border border-[var(--border)] bg-[var(--card)] overflow-hidden">
              {/* ── 한줄 요약 (항상 표시) ── */}
              <button
                type="button"
                onClick={() => toggleExpand(item.symbol)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--border)]/30 transition-colors"
              >
                {/* 등급 */}
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold text-white shrink-0 ${GRADE_COLORS[item.grade]}`}>
                  {item.grade}
                </span>

                {/* 종목명 */}
                <span className="font-semibold text-sm text-[var(--text)] truncate max-w-[6rem] sm:max-w-[10rem]">
                  {item.name}
                </span>

                {/* 등급 라벨 */}
                <span className="text-[10px] text-[var(--muted)] shrink-0 hidden sm:inline">
                  {GRADE_LABELS[item.grade]}
                </span>

                {/* 충족 비율 바 */}
                <div className="flex items-center gap-1 shrink-0">
                  <div className="w-12 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
                    <div
                      className={`h-full rounded-full ${GRADE_COLORS[item.grade]}`}
                      style={{ width: `${Math.round(item.metRatio * 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] tabular-nums text-[var(--muted)] w-8">
                    {item.metCount}/{item.activeCount}
                  </span>
                </div>

                {/* 요약 (데스크탑) */}
                <span className="flex-1 text-[11px] text-[var(--muted)] truncate hidden sm:inline">
                  {summary}
                </span>

                {/* 현재가 */}
                {item.currentPrice && (
                  <span className="text-xs tabular-nums text-[var(--muted)] shrink-0">
                    {item.currentPrice.toLocaleString('ko-KR')}
                  </span>
                )}

                {/* 펼침 아이콘 */}
                <ChevronDown
                  size={14}
                  className={`shrink-0 text-[var(--muted)] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                />
              </button>

              {/* ── 펼침 상세 ── */}
              {isExpanded && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border)] space-y-2">
                  {/* 모바일 요약 */}
                  <p className="sm:hidden text-[11px] text-[var(--muted)]">{summary}</p>

                  {categories.map(cat => {
                    const catConds = activeConditions.filter(c => c.category === cat);
                    if (catConds.length === 0) return null;
                    const catMet = catConds.filter(c => c.met && !c.na).length;
                    const catTotal = catConds.filter(c => !c.na).length;
                    return (
                      <div key={cat}>
                        <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-1">
                          <span className="font-medium">{CATEGORY_LABELS[cat]}</span>
                          <span>{catMet}/{catTotal}</span>
                        </div>
                        <div className="space-y-0.5">
                          {catConds.map(c => (
                            <div key={c.id} className="flex items-start gap-1.5 text-xs">
                              <span className="mt-0.5 shrink-0">{c.na ? '➖' : c.met ? '✅' : '❌'}</span>
                              <span className={c.na ? 'text-[var(--muted)]' : c.met ? 'text-[var(--text)]' : 'text-[var(--muted)]'}>
                                {c.label}: {c.detail}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
