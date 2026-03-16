'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, SlidersHorizontal, RefreshCw, MoreHorizontal } from 'lucide-react';
import { DateDropdown } from './date-dropdown';

// FilterBar 내부 고정 시장 옵션
const MARKET_OPTIONS = [
  { key: 'all',    label: '전체'   },
  { key: 'KOSPI',  label: 'KOSPI'  },
  { key: 'KOSDAQ', label: 'KOSDAQ' },
];

interface FilterBarProps {
  date: {
    dates: string[];
    selected: string;
    onChange: (d: string) => void;
    allLabel?: string;
    label?: string;
  };
  source?: {
    options: { key: string; label: string }[];
    selected: string;
    onChange: (s: string) => void;
  };
  market?: {
    selected: string;         // 'all' | 'KOSPI' | 'KOSDAQ'
    onChange: (m: string) => void;
  };
  search?: {
    value: string;
    onChange: (q: string) => void;
    placeholder?: string;
  };
  sort?: {
    options: { key: string; label: string }[];
    selected: string;
    onChange: (s: string) => void;
    gapAsc?: boolean;
    onGapToggle?: () => void;
  };
  onWeightClick?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}

const selectCls =
  'pl-3 pr-7 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-sm text-[var(--foreground)] appearance-none cursor-pointer focus:outline-none focus:border-[var(--accent)]';

const iconBtnCls =
  'p-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:bg-[var(--card-hover)] transition-colors';

export function FilterBar({
  date,
  source,
  market,
  search,
  sort,
  onWeightClick,
  onRefresh,
  refreshing,
}: FilterBarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const hasMore = !!(market || sort);

  // ⋯ 팝업 외부 클릭 시 닫힘
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMoreOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // 검색 확장 시 input 포커스
  useEffect(() => {
    if (searchExpanded) searchInputRef.current?.focus();
  }, [searchExpanded]);

  const handleSearchBlur = () => {
    setSearchExpanded(false);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setSearchExpanded(false);
  };

  // 모바일 검색 확장 모드
  if (searchExpanded && search) {
    return (
      <div className="flex sm:hidden items-center gap-2 w-full">
        <input
          ref={searchInputRef}
          type="text"
          value={search.value}
          onChange={(e) => search.onChange(e.target.value)}
          onBlur={handleSearchBlur}
          onKeyDown={handleSearchKeyDown}
          placeholder={search.placeholder}
          className="flex-1 pl-3 pr-3 py-1.5 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:border-[var(--accent)]"
        />
        {onWeightClick && (
          <button
            type="button"
            aria-label="가중치 설정"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onWeightClick}
            className={`${iconBtnCls} shrink-0`}
          >
            <SlidersHorizontal size={15} />
          </button>
        )}
        {onRefresh && (
          <button
            type="button"
            aria-label="새로고침"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onRefresh}
            disabled={refreshing}
            className={`${iconBtnCls} shrink-0 disabled:opacity-50`}
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-2 flex-wrap sm:flex-nowrap">
      {/* 검색 — 맨 왼쪽, 데스크탑: inline input / 모바일: 🔍 아이콘 */}
      {search && (
        <>
          {/* 데스크탑 인라인 검색 */}
          <div className="hidden sm:block relative flex-1 min-w-[8rem] max-w-[16rem]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              type="text"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder}
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-[var(--border)] bg-[var(--card)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
          {/* 모바일 🔍 아이콘 버튼 */}
          <button
            type="button"
            aria-label="검색"
            className={`sm:hidden ${iconBtnCls}`}
            onClick={() => setSearchExpanded(true)}
          >
            <Search size={15} />
          </button>
        </>
      )}

      {/* DateDropdown */}
      <DateDropdown
        dates={date.dates}
        selected={date.selected}
        onChange={date.onChange}
        allLabel={date.allLabel}
        label={date.label}
      />

      {/* 소스 드롭다운 */}
      {source && (
        <div className="relative">
          <select
            value={source.selected}
            onChange={(e) => source.onChange(e.target.value)}
            className={selectCls}
          >
            {source.options.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] text-xs">▾</span>
        </div>
      )}

      {/* 시장 드롭다운 — 데스크탑만 */}
      {market && (
        <div className="hidden sm:block relative">
          <select
            value={market.selected}
            onChange={(e) => market.onChange(e.target.value)}
            className={selectCls}
          >
            {MARKET_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] text-xs">▾</span>
        </div>
      )}

      {/* 정렬 드롭다운 + Gap ↑↓ — 데스크탑만 */}
      {sort && (
        <div className="hidden sm:flex items-center gap-1">
          <div className="relative">
            <select
              value={sort.selected}
              onChange={(e) => sort.onChange(e.target.value)}
              className={selectCls}
            >
              {sort.options.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] text-xs">▾</span>
          </div>
          {sort.selected === 'gap' && sort.onGapToggle && (
            <button
              type="button"
              onClick={sort.onGapToggle}
              className="px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-sm text-[var(--muted)] hover:bg-[var(--card-hover)] transition-colors"
            >
              {sort.gapAsc ? '↑' : '↓'}
            </button>
          )}
        </div>
      )}

      {/* ⋯ 버튼 — 모바일만, market 또는 sort 있을 때 */}
      {hasMore && (
        <div ref={moreRef} className="sm:hidden relative">
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            aria-label="더보기"
            aria-haspopup="menu"
            className={`${iconBtnCls} ${moreOpen ? '!bg-[var(--accent)] !text-white !border-[var(--accent)]' : ''}`}
          >
            <MoreHorizontal size={15} />
          </button>

          {moreOpen && (
            <div className="absolute top-full mt-1 left-0 z-50 w-48 rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg p-3 space-y-2">
              {market && (
                <div className="relative">
                  <select
                    value={market.selected}
                    onChange={(e) => { market.onChange(e.target.value); setMoreOpen(false); }}
                    className={`w-full ${selectCls}`}
                  >
                    {MARKET_OPTIONS.map((o) => (
                      <option key={o.key} value={o.key}>{o.label}</option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] text-xs">▾</span>
                </div>
              )}
              {sort && (
                <div className="flex items-center gap-1">
                  <div className="relative flex-1">
                    <select
                      value={sort.selected}
                      onChange={(e) => sort.onChange(e.target.value)}
                      className={`w-full ${selectCls}`}
                    >
                      {sort.options.map((o) => (
                        <option key={o.key} value={o.key}>{o.label}</option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] text-xs">▾</span>
                  </div>
                  {sort.selected === 'gap' && sort.onGapToggle && (
                    <button
                      type="button"
                      onClick={sort.onGapToggle}
                      className="px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-sm text-[var(--muted)] hover:bg-[var(--card-hover)] transition-colors shrink-0"
                    >
                      {sort.gapAsc ? '↑' : '↓'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ⚙ 가중치 버튼 */}
      {onWeightClick && (
        <button type="button" aria-label="가중치 설정" onClick={onWeightClick} className={`ml-auto sm:ml-0 ${iconBtnCls}`}>
          <SlidersHorizontal size={15} />
        </button>
      )}

      {/* 🔄 갱신 버튼 */}
      {onRefresh && (
        <button
          type="button"
          aria-label="새로고침"
          onClick={onRefresh}
          disabled={refreshing}
          className={`${iconBtnCls} disabled:opacity-50`}
        >
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
        </button>
      )}
    </div>
  );
}
