'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { X, ArrowUpDown, TrendingUp, TrendingDown, Loader2 } from 'lucide-react';
import { getLastNWeekdays, formatDateLabel } from '@/lib/date-utils';

// ── 타입 정의 ─────────────────────────────────────────────────────────────────

/** 스냅샷 API 응답의 개별 항목 */
interface SnapshotItem {
  symbol: string;
  name: string;
  market: string;
  current_price: number | null;
  score_total: number;
  grade: string | null;
  characters: string[] | null;
  recommendation: string | null;
  signal_date: string | null;
}

/** 스냅샷 API 응답 */
interface SnapshotResponse {
  date: string;
  model: string;
  snapshot_time: string | null;
  items: SnapshotItem[];
  total: number;
}

/** 현재 랭킹 API 응답의 개별 항목 (가격 비교용 최소 필드) */
interface CurrentPriceItem {
  symbol: string;
  current_price: number | null;
}

/** 수익률 계산이 포함된 표시용 행 */
interface TrackerRow {
  rank: number;
  symbol: string;
  name: string;
  market: string;
  snapshotPrice: number | null;
  todayPrice: number | null;
  returnPct: number | null;
  grade: string | null;
}

type SortKey = 'rank' | 'return';

// ── 과거 평일 목록 (최근 7영업일, 오늘 제외) ──────────────────────────────────
const WEEKDAYS = getLastNWeekdays(8).slice(1); // 오늘 제외한 7일

// ── 등급 색상 매핑 ──────────────────────────────────────────────────────────────
const GRADE_CLS: Record<string, string> = {
  S: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  A: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  B: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  C: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  D: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

// ── Props ─────────────────────────────────────────────────────────────────────
interface SnapshotTrackerProps {
  /** 모달/드로어 닫기 콜백 */
  onClose: () => void;
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────────

/**
 * 순위 트래킹 — 과거 스냅샷의 가격과 현재 가격을 비교하여 수익률을 표시.
 * 모달 형태로 렌더링되며, 날짜 선택 + 테이블 구성.
 */
export function SnapshotTracker({ onClose }: SnapshotTrackerProps) {
  const [selectedDate, setSelectedDate] = useState<string>(WEEKDAYS[0] ?? '');
  const [snapshotData, setSnapshotData] = useState<SnapshotResponse | null>(null);
  const [currentPrices, setCurrentPrices] = useState<Map<string, number | null>>(new Map());
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // 스냅샷 데이터 가져오기
  const fetchSnapshot = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const res = await window.fetch(
        `/api/v1/stock-ranking/snapshot?date=${date}&model=standard`,
      );
      if (res.ok) {
        const data: SnapshotResponse = await res.json();
        setSnapshotData(data);
      } else {
        setSnapshotData(null);
      }
    } catch {
      setSnapshotData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // 현재 가격 가져오기 (오늘 전체 랭킹에서 추출)
  const fetchCurrentPrices = useCallback(async () => {
    try {
      const res = await window.fetch('/api/v1/stock-ranking?date=all&limit=500');
      if (res.ok) {
        const data = await res.json();
        const map = new Map<string, number | null>();
        (data.items as CurrentPriceItem[]).forEach((item) => {
          map.set(item.symbol, item.current_price);
        });
        setCurrentPrices(map);
      }
    } catch {
      // 현재 가격 조회 실패 시 빈 맵 유지
    }
  }, []);

  // 초기 로드: 현재 가격 + 첫 번째 날짜 스냅샷
  useEffect(() => {
    fetchCurrentPrices();
  }, [fetchCurrentPrices]);

  useEffect(() => {
    if (selectedDate) {
      fetchSnapshot(selectedDate);
    }
  }, [selectedDate, fetchSnapshot]);

  // 날짜 변경 핸들러
  const handleDateChange = (date: string) => {
    setSelectedDate(date);
  };

  // 정렬 토글
  const handleSortToggle = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'return' ? 'desc' : 'asc');
    }
  };

  // 표시용 행 계산
  const rows: TrackerRow[] = useMemo(() => {
    if (!snapshotData?.items) return [];
    return snapshotData.items.map((item, idx) => {
      const todayPrice = currentPrices.get(item.symbol) ?? null;
      const snapshotPrice = item.current_price;
      let returnPct: number | null = null;
      if (snapshotPrice && snapshotPrice > 0 && todayPrice && todayPrice > 0) {
        returnPct = ((todayPrice - snapshotPrice) / snapshotPrice) * 100;
      }
      return {
        rank: idx + 1,
        symbol: item.symbol,
        name: item.name,
        market: item.market,
        snapshotPrice,
        todayPrice,
        returnPct,
        grade: item.grade,
      };
    });
  }, [snapshotData, currentPrices]);

  // 정렬 적용
  const sortedRows = useMemo(() => {
    const sorted = [...rows];
    sorted.sort((a, b) => {
      if (sortKey === 'rank') {
        return sortDir === 'asc' ? a.rank - b.rank : b.rank - a.rank;
      }
      // return 정렬: null은 뒤로
      const aVal = a.returnPct ?? (sortDir === 'asc' ? Infinity : -Infinity);
      const bVal = b.returnPct ?? (sortDir === 'asc' ? Infinity : -Infinity);
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return sorted;
  }, [rows, sortKey, sortDir]);

  // 평균 수익률 계산
  const avgReturn = useMemo(() => {
    const valid = rows.filter((r) => r.returnPct !== null);
    if (valid.length === 0) return null;
    return valid.reduce((sum, r) => sum + r.returnPct!, 0) / valid.length;
  }, [rows]);

  // 가격 포매팅
  const fmtPrice = (v: number | null) =>
    v == null ? '-' : v.toLocaleString() + '원';

  // 수익률 포매팅 + 색상 클래스
  const fmtReturn = (v: number | null) => {
    if (v == null) return { text: '-', cls: 'text-[var(--muted)]' };
    const sign = v > 0 ? '+' : '';
    const cls =
      v > 0
        ? 'text-[var(--danger)]'
        : v < 0
          ? 'text-blue-500'
          : 'text-[var(--muted)]';
    return { text: `${sign}${v.toFixed(2)}%`, cls };
  };

  // ESC 키로 닫기
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 오버레이 */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      {/* 모달 컨텐츠 */}
      <div className="relative w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-2xl">
        {/* ── 헤더 ── */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">
            순위 트래킹
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)] transition-colors"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── 날짜 선택 ── */}
        <div className="p-4 border-b border-[var(--border)] space-y-3">
          <p className="text-xs text-[var(--muted)]">
            과거 스냅샷 날짜를 선택하면 해당일 추천 종목의 현재 수익률을 확인할 수 있습니다.
          </p>
          <div className="flex gap-1.5 flex-wrap">
            {WEEKDAYS.map((date) => (
              <button
                key={date}
                onClick={() => handleDateChange(date)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  selectedDate === date
                    ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                    : 'bg-[var(--card)] text-[var(--muted)] border-[var(--border)] hover:bg-[var(--card-hover)]'
                }`}
              >
                {formatDateLabel(date)}
              </button>
            ))}
          </div>

          {/* 요약 통계 */}
          {snapshotData && !loading && (
            <div className="flex items-center gap-4 text-xs">
              <span className="text-[var(--muted)]">
                {snapshotData.total}종목
              </span>
              {avgReturn !== null && (
                <span className={avgReturn >= 0 ? 'text-[var(--danger)]' : 'text-blue-500'}>
                  평균 수익률: {avgReturn > 0 ? '+' : ''}
                  {avgReturn.toFixed(2)}%
                </span>
              )}
            </div>
          )}
        </div>

        {/* ── 테이블 ── */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-16 text-[var(--muted)] text-sm gap-2">
              <Loader2 size={16} className="animate-spin" />
              로딩 중...
            </div>
          )}

          {!loading && sortedRows.length === 0 && (
            <div className="py-16 text-center text-[var(--muted)] text-sm">
              해당 날짜의 스냅샷 데이터가 없습니다
            </div>
          )}

          {!loading && sortedRows.length > 0 && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[var(--card)] border-b border-[var(--border)]">
                <tr className="text-xs text-[var(--muted)]">
                  {/* 순위 */}
                  <th className="py-2 px-3 text-center w-12">
                    <button
                      onClick={() => handleSortToggle('rank')}
                      className="inline-flex items-center gap-0.5 hover:text-[var(--foreground)] transition-colors"
                    >
                      #
                      {sortKey === 'rank' && (
                        <ArrowUpDown size={10} />
                      )}
                    </button>
                  </th>
                  {/* 종목명 */}
                  <th className="py-2 px-3 text-left">종목</th>
                  {/* 등급 */}
                  <th className="py-2 px-3 text-center hidden sm:table-cell">등급</th>
                  {/* 스냅샷 가격 */}
                  <th className="py-2 px-3 text-right hidden md:table-cell">당시가격</th>
                  {/* 현재 가격 */}
                  <th className="py-2 px-3 text-right">현재가</th>
                  {/* 수익률 */}
                  <th className="py-2 px-3 text-right w-24">
                    <button
                      onClick={() => handleSortToggle('return')}
                      className="inline-flex items-center gap-0.5 hover:text-[var(--foreground)] transition-colors ml-auto"
                    >
                      수익률
                      {sortKey === 'return' && (
                        <ArrowUpDown size={10} />
                      )}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {sortedRows.map((row) => {
                  const ret = fmtReturn(row.returnPct);
                  const gradeCls = row.grade
                    ? GRADE_CLS[row.grade] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                    : '';
                  return (
                    <tr
                      key={row.symbol}
                      className="hover:bg-[var(--card-hover)] transition-colors"
                    >
                      {/* 순위 */}
                      <td className="py-2 px-3 text-center text-xs font-bold tabular-nums text-[var(--muted)]">
                        {row.rank}
                      </td>
                      {/* 종목명 + 심볼 */}
                      <td className="py-2 px-3">
                        <div className="font-semibold text-sm truncate max-w-[10rem]">
                          {row.name}
                        </div>
                        <div className="text-[10px] text-[var(--muted)]">
                          {row.symbol} · {row.market}
                        </div>
                      </td>
                      {/* 등급 */}
                      <td className="py-2 px-3 text-center hidden sm:table-cell">
                        {row.grade ? (
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${gradeCls}`}
                          >
                            {row.grade}
                          </span>
                        ) : (
                          <span className="text-[var(--muted)]">-</span>
                        )}
                      </td>
                      {/* 스냅샷 가격 */}
                      <td className="py-2 px-3 text-right text-xs tabular-nums text-[var(--muted)] hidden md:table-cell">
                        {fmtPrice(row.snapshotPrice)}
                      </td>
                      {/* 현재 가격 */}
                      <td className="py-2 px-3 text-right text-xs tabular-nums">
                        {fmtPrice(row.todayPrice)}
                      </td>
                      {/* 수익률 */}
                      <td className={`py-2 px-3 text-right text-xs font-semibold tabular-nums ${ret.cls}`}>
                        <span className="inline-flex items-center gap-0.5 justify-end">
                          {row.returnPct !== null && row.returnPct > 0 && (
                            <TrendingUp size={10} />
                          )}
                          {row.returnPct !== null && row.returnPct < 0 && (
                            <TrendingDown size={10} />
                          )}
                          {ret.text}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
