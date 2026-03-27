'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, RefreshCw, MoreHorizontal, BarChart3, SlidersHorizontal, Camera, Loader2 } from 'lucide-react';
import { SnapshotTracker } from './SnapshotTracker';
import type { ScoreMode } from './SnapshotTracker';

// ─── Props 타입 ──────────────────────────────────────────────────────────────

interface RecommendationFilterBarProps {
  searchValue: string;
  onSearchChange: (q: string) => void;
  dateMode: 'today' | 'signal_all' | 'all';
  onDateChange: (mode: 'today' | 'signal_all' | 'all') => void;
  market: 'all' | 'KOSPI' | 'KOSDAQ' | 'ETF';
  onMarketChange: (m: 'all' | 'KOSPI' | 'KOSDAQ' | 'ETF') => void;
  sortBy: 'score' | 'name' | 'updated' | 'gap';
  sortDir: 'asc' | 'desc';
  onSortChange: (by: 'score' | 'name' | 'updated' | 'gap') => void;
  characterOptions: { key: string; label: string }[];
  selectedCharacter: string;
  onCharacterChange: (c: string) => void;
  noiseFilter: boolean;
  onNoiseFilterChange: (on: boolean) => void;
  onRefresh: () => void;
  refreshing: boolean;
  /** true이면 하단에 "순위 업데이트 중..." 배너 표시 */
  updating?: boolean;
  /** 가중치 조절 버튼 클릭 핸들러 (없으면 버튼 숨김) */
  onWeightClick?: () => void;
  /** 순위 트래킹 점수 모드 (기본: standard) */
  scoreMode?: ScoreMode;
  /** 부모의 실시간 가격 데이터 (순위 트래킹에서 현재가로 사용) */
  livePrices?: Record<string, { current_price: number | null }>;
  /** 데이터 업데이트 시각 라벨 (예: "14:30") */
  updateLabel?: string | null;
  /** 수동 스냅샷 저장 핸들러 */
  onSaveSnapshot?: () => void;
  /** 스냅샷 저장 진행 중 */
  savingSnapshot?: boolean;
}

// ─── 상수 ────────────────────────────────────────────────────────────────────

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
  { key: 'score', label: '점수' },
  { key: 'name', label: '이름' },
  { key: 'updated', label: '업데이트' },
  { key: 'gap', label: '괴리율' },
] as const;

// ─── 내부 컴포넌트 ────────────────────────────────────────────────────────────

/** 수평 버튼 그룹 — 각 버튼은 활성/비활성 스타일을 적용 */
function ButtonGroup<T extends string>({
  options,
  active,
  onSelect,
  showArrow,
  arrowDir,
}: {
  options: readonly { key: T; label: string }[];
  active: T;
  onSelect: (key: T) => void;
  /** 선택된 버튼에 방향 화살표(↑↓) 표시 여부 */
  showArrow?: boolean;
  arrowDir?: 'asc' | 'desc';
}) {
  return (
    <div className="flex rounded-lg border border-[var(--border)] overflow-hidden shrink-0">
      {options.map((opt, idx) => {
        const isActive = opt.key === active;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onSelect(opt.key)}
            className={[
              'px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap',
              // 버튼 사이 구분선 (첫 번째 제외)
              idx > 0 ? 'border-l border-[var(--border)]' : '',
              isActive
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--card)] text-[var(--muted-foreground)] hover:bg-[var(--border)]',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {opt.label}
            {/* 정렬 버튼: 선택된 경우 방향 표시 */}
            {showArrow && isActive && (
              <span className="ml-0.5">{arrowDir === 'asc' ? '↑' : '↓'}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** 성격 드롭다운 — 레이블 없는 select */
function CharacterSelect({
  options,
  value,
  onChange,
  className = '',
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (c: string) => void;
  className?: string;
}) {
  return (
    <div
      className={`relative flex items-center rounded-lg border border-[var(--border)] bg-[var(--card)] ${className}`}
    >
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-3 pr-7 py-1.5 bg-transparent text-xs font-medium text-[var(--foreground)] appearance-none cursor-pointer focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      {/* 드롭다운 화살표 아이콘 */}
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] text-xs">
        ▾
      </span>
    </div>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

/**
 * 종목추천/단기추천 전용 필터바.
 * - 데스크탑: 검색·날짜·시장·정렬·성격·노이즈 제외·새로고침 한 줄 배치
 * - 모바일: 검색·날짜·시장 유지, 정렬·성격·노이즈는 "⋯" 팝업
 * - `updating=true`이면 하단에 "순위 업데이트 중..." 배너 표시
 */
export function RecommendationFilterBar({
  searchValue,
  onSearchChange,
  dateMode,
  onDateChange,
  market,
  onMarketChange,
  sortBy,
  sortDir,
  onSortChange,
  characterOptions,
  selectedCharacter,
  onCharacterChange,
  noiseFilter,
  onNoiseFilterChange,
  onRefresh,
  refreshing,
  updating = false,
  onWeightClick,
  scoreMode = 'standard',
  livePrices,
  updateLabel,
  onSaveSnapshot,
  savingSnapshot,
}: RecommendationFilterBarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [trackerOpen, setTrackerOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // ⋯ 팝업 외부 클릭 및 ESC 키로 닫기
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

  // 아이콘 버튼 공통 클래스
  const iconBtnCls =
    'p-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:bg-[var(--card-hover)] transition-colors';

  return (
    <div className="flex flex-col gap-1.5">
      {/* ── 메인 필터 행 ──────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
        {/* 검색 입력 */}
        <div className="relative shrink-0">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none"
          />
          <input
            type="text"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="검색..."
            className="w-28 sm:w-36 pl-7 pr-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)]"
          />
        </div>

        {/* 날짜 버튼 그룹 */}
        <ButtonGroup
          options={DATE_OPTIONS}
          active={dateMode}
          onSelect={onDateChange}
        />

        {/* 시장 버튼 그룹 */}
        <ButtonGroup
          options={MARKET_OPTIONS}
          active={market}
          onSelect={onMarketChange}
        />

        {/* 정렬 버튼 그룹 — 데스크탑만 */}
        <div className="hidden sm:block">
          <ButtonGroup
            options={SORT_OPTIONS}
            active={sortBy}
            onSelect={onSortChange}
            showArrow
            arrowDir={sortDir}
          />
        </div>

        {/* 성격 드롭다운 — 데스크탑만 */}
        {characterOptions.length > 0 && (
          <CharacterSelect
            options={characterOptions}
            value={selectedCharacter}
            onChange={onCharacterChange}
            className="hidden sm:flex"
          />
        )}

        {/* 노이즈 제외 토글 — 데스크탑만 */}
        <label className="hidden sm:flex items-center gap-1.5 cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={noiseFilter}
            onChange={(e) => onNoiseFilterChange(e.target.checked)}
            className="w-3.5 h-3.5 accent-[var(--accent)] cursor-pointer"
          />
          <span className="text-xs text-[var(--muted-foreground)] whitespace-nowrap">
            노이즈 제외
          </span>
        </label>

        {/* ⋯ 버튼 — 모바일만 (정렬·성격·노이즈 팝업) */}
        <div ref={moreRef} className="sm:hidden relative">
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            aria-label="더보기"
            aria-haspopup="menu"
            className={`${iconBtnCls} ${
              moreOpen
                ? '!bg-[var(--accent)] !text-white !border-[var(--accent)]'
                : ''
            }`}
          >
            <MoreHorizontal size={15} />
          </button>

          {/* 팝업 메뉴 */}
          {moreOpen && (
            <div className="absolute top-full mt-1 left-0 z-50 w-56 rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg p-3 space-y-3">
              {/* 정렬 */}
              <div>
                <p className="text-xs text-[var(--muted)] mb-1.5">정렬</p>
                <ButtonGroup
                  options={SORT_OPTIONS}
                  active={sortBy}
                  onSelect={(key) => {
                    onSortChange(key);
                    setMoreOpen(false);
                  }}
                  showArrow
                  arrowDir={sortDir}
                />
              </div>

              {/* 성격 */}
              {characterOptions.length > 0 && (
                <div>
                  <p className="text-xs text-[var(--muted)] mb-1.5">성격</p>
                  <CharacterSelect
                    options={characterOptions}
                    value={selectedCharacter}
                    onChange={(c) => {
                      onCharacterChange(c);
                      setMoreOpen(false);
                    }}
                    className="w-full"
                  />
                </div>
              )}

              {/* 노이즈 제외 */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={noiseFilter}
                  onChange={(e) => onNoiseFilterChange(e.target.checked)}
                  className="w-4 h-4 accent-[var(--accent)] cursor-pointer"
                />
                <span className="text-sm text-[var(--foreground)]">
                  노이즈 제외
                </span>
              </label>
            </div>
          )}
        </div>

        {/* 가중치 조절 버튼 */}
        {onWeightClick && (
          <button
            type="button"
            aria-label="가중치 조절"
            title="가중치 조절"
            onClick={onWeightClick}
            className={`ml-auto ${iconBtnCls}`}
          >
            <SlidersHorizontal size={15} />
          </button>
        )}

        {/* 스냅샷 저장 버튼 */}
        {onSaveSnapshot && (
          <button
            type="button"
            aria-label="스냅샷 저장"
            title="현재 스냅샷 저장"
            onClick={onSaveSnapshot}
            disabled={savingSnapshot}
            className={`${onWeightClick ? '' : 'ml-auto'} ${iconBtnCls} disabled:opacity-50`}
          >
            {savingSnapshot ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Camera size={15} />
            )}
          </button>
        )}

        {/* 순위 트래킹 버튼 */}
        <button
          type="button"
          aria-label="순위 트래킹"
          title="순위 트래킹"
          onClick={() => setTrackerOpen(true)}
          className={`${!onSaveSnapshot && !onWeightClick ? 'ml-auto' : ''} ${iconBtnCls}`}
        >
          <BarChart3 size={15} />
        </button>

        {/* 새로고침 버튼 + 업데이트 시각 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {updateLabel && (
            <span className="text-[10px] text-[var(--muted)] whitespace-nowrap">
              {updateLabel}
            </span>
          )}
          <button
            type="button"
            aria-label="새로고침"
            onClick={onRefresh}
            disabled={refreshing}
            className={`${iconBtnCls} disabled:opacity-50`}
          >
            <RefreshCw
              size={15}
              className={refreshing ? 'animate-spin' : ''}
            />
          </button>
        </div>
      </div>

      {/* ── 업데이트 배너 ─────────────────────────────────────────── */}
      {updating && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)]/30 text-xs text-[var(--accent)]">
          {/* 작은 스피너 */}
          <span
            className="inline-block w-3 h-3 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin"
            aria-hidden="true"
          />
          순위 업데이트 중...
        </div>
      )}

      {/* ── 순위 트래킹 모달 ─────────────────────────────────────── */}
      {trackerOpen && (
        <SnapshotTracker onClose={() => setTrackerOpen(false)} scoreMode={scoreMode} livePrices={livePrices} />
      )}
    </div>
  );
}
