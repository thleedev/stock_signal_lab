'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { X, ArrowUpDown, TrendingUp, TrendingDown, Loader2 } from 'lucide-react';
import { getLastNWeekdays, formatDateLabel } from '@/lib/date-utils';

// ── 타입 정의 ─────────────────────────────────────────────────────────────────

/** 스냅샷 API 응답의 개별 항목 (raw_data 포함) */
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
  // raw_data에서 spread 되는 단기점수 계산용 필드
  price_change_pct?: number | null;
  volume_ratio?: number | null;
  close_position?: number | null;
  gap_pct?: number | null;
  trading_value?: number | null;
  foreign_net_qty?: number | null;
  institution_net_qty?: number | null;
  foreign_streak?: number | null;
  institution_streak?: number | null;
  latest_signal_date?: string | null;
  signal_count_30d?: number | null;
  forward_per?: number | null;
  target_price?: number | null;
  pbr?: number | null;
  roe?: number | null;
  cum_return_3d?: number | null;
  latest_signal_price?: number | null;
  is_managed?: boolean;
  audit_opinion?: string | null;
  has_recent_cbw?: boolean;
  major_shareholder_pct?: number | null;
  major_shareholder_delta?: number | null;
  turnover_rate?: number | null;
  daily_trading_value?: number | null;
}

/** 스냅샷 API 응답 */
interface SnapshotResponse {
  date: string;
  model: string;
  snapshot_time: string | null;
  items: SnapshotItem[];
  total: number;
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

export type ScoreMode = 'standard' | 'short_term';

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

// ── 단기추천 점수 계산 (ShortTermRecommendationSection에서 가져옴) ──────────────
function computeShortTermScore(item: SnapshotItem): number {
  const pct = item.price_change_pct ?? 0;
  const vr = item.volume_ratio ?? 1;

  // 모멘텀
  let matrixScore = 0;
  if (pct >= 1 && pct < 3) matrixScore = vr >= 2 ? 35 : vr >= 1.5 ? 28 : 18;
  else if (pct >= 3 && pct < 6) matrixScore = vr >= 2 ? 30 : vr >= 1.5 ? 25 : 15;
  else if (pct >= 0.5 && pct < 1) matrixScore = vr >= 2 ? 22 : vr >= 1.5 ? 15 : 8;
  else if (pct >= 6 && pct < 8) matrixScore = vr >= 2 ? 15 : vr >= 1.5 ? 12 : 5;
  else if (pct >= -1 && pct < 0.5) matrixScore = vr >= 2 ? 12 : vr >= 1.5 ? 8 : 3;
  else if (pct >= 8) matrixScore = vr >= 2 ? -5 : vr >= 1.5 ? -8 : -10;

  const cp = item.close_position;
  let closePosScore = 0;
  if (cp !== null && cp !== undefined) {
    if (cp >= 0.8) closePosScore = 20;
    else if (cp >= 0.6) closePosScore = 12;
    else if (cp >= 0.4) closePosScore = 3;
    else closePosScore = -10;
  }

  const gap = item.gap_pct;
  let gapScore = 0;
  if (gap !== null && gap !== undefined) {
    if (gap >= 1 && gap < 3) gapScore = 15;
    else if (gap >= 0 && gap < 1) gapScore = 8;
    else if (gap >= 3) gapScore = 3;
  }

  const tv = item.trading_value ?? 0;
  let tvScore = 0;
  if (tv >= 500_0000_0000) tvScore = 15;
  else if (tv >= 100_0000_0000) tvScore = 10;
  else if (tv >= 30_0000_0000) tvScore = 5;

  const momentumRaw = matrixScore + closePosScore + gapScore + tvScore;
  const momentum = Math.max(0, Math.min(100, (momentumRaw + 10) / 75 * 100));

  // 수급
  const fn = item.foreign_net_qty ?? 0;
  const in_ = item.institution_net_qty ?? 0;
  const fs = item.foreign_streak ?? 0;
  const is_ = item.institution_streak ?? 0;
  let supplyRaw = 0;
  if (fn > 0) supplyRaw += 10;
  if (in_ > 0) supplyRaw += 10;
  if (fn > 0 && in_ > 0) supplyRaw += 12;
  if (fs >= 2) supplyRaw += 5;
  if (is_ >= 2) supplyRaw += 5;
  if (fn <= 0 && in_ <= 0 && (fn !== 0 || in_ !== 0)) supplyRaw -= 15;
  if (fs <= -3) supplyRaw -= 10;
  if (is_ <= -3) supplyRaw -= 10;
  const supply = Math.max(0, Math.min(100, (supplyRaw + 25) / 60 * 100));

  // 촉매
  let catalystRaw = 0;
  const sigDate = item.latest_signal_date;
  if (sigDate) {
    const days = Math.floor((Date.now() - new Date(sigDate).getTime()) / 86400000);
    if (days <= 0) catalystRaw += 20;
    else if (days === 1) catalystRaw += 10;
    else if (days <= 3) catalystRaw += 3;
    else catalystRaw -= 5;
  }
  const cnt = item.signal_count_30d ?? 0;
  if (cnt >= 5) catalystRaw += 15;
  else if (cnt >= 3) catalystRaw += 10;
  else if (cnt >= 1) catalystRaw += 5;
  const catalyst = Math.max(0, Math.min(100, (catalystRaw + 10) / 40 * 100));

  // 밸류에이션
  let valRaw = 0;
  const fper = item.forward_per;
  if (fper !== null && fper !== undefined && fper > 0) {
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
  if ((fper === null || fper === undefined) && item.pbr !== null && item.pbr !== undefined && item.pbr > 0) {
    if (item.pbr < 0.5) valRaw += 30;
    else if (item.pbr < 1.0) valRaw += 15;
    else if (item.pbr < 1.5) valRaw += 5;
  }
  const roe = item.roe ?? 0;
  if (roe > 15) valRaw += 20;
  else if (roe > 10) valRaw += 10;
  else if (roe > 5) valRaw += 5;
  const valuation = Math.max(0, Math.min(100, valRaw / 55 * 100));

  // 리스크
  let riskRaw = 0;
  if (pct >= 12) riskRaw += 20;
  const cr3 = item.cum_return_3d ?? 0;
  if (cr3 >= 20) riskRaw += 20;
  if (pct >= 10 && vr < 1) riskRaw += 15;
  if (cp !== null && cp !== undefined && cp < 0.3 && pct > 0) riskRaw += 10;
  if (item.latest_signal_price && item.current_price && item.latest_signal_price > 0) {
    const sigGap = ((item.current_price - item.latest_signal_price) / item.latest_signal_price) * 100;
    if (sigGap >= 12) riskRaw += 20;
    else if (sigGap >= 7) riskRaw += 12;
  }
  if (tv > 0 && tv < 100_0000_0000 && pct > 3) riskRaw += 10;
  if (item.is_managed) riskRaw += 100;
  if (item.audit_opinion && item.audit_opinion !== '적정') riskRaw += 80;
  if (item.has_recent_cbw) riskRaw += 20;
  if (item.major_shareholder_pct != null && item.major_shareholder_pct > 0 && item.major_shareholder_pct < 20) riskRaw += 15;
  if (item.major_shareholder_delta != null && item.major_shareholder_delta < 0) riskRaw += 10;
  if (item.turnover_rate != null && item.turnover_rate > 10) riskRaw += 10;
  const tvValue = item.daily_trading_value ?? item.trading_value ?? 0;
  if (tvValue > 0 && tvValue < 3_000_000_000) riskRaw += 15;
  const risk = Math.min(100, riskRaw);

  // 가중합: momentum:45, supply:28, catalyst:22, valuation:5, risk감산:15
  const base = (momentum * 45 + supply * 28 + catalyst * 22 + valuation * 5) / 100;
  return Math.max(0, Math.min(100, base - risk * 0.15));
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface SnapshotTrackerProps {
  onClose: () => void;
  /** 점수 모드: standard(종목추천) 또는 short_term(단기추천) */
  scoreMode?: ScoreMode;
  /** 부모 컴포넌트의 실시간 가격 — 있으면 별도 조회 생략 */
  livePrices?: Record<string, { current_price: number | null }>;
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────────

/**
 * 순위 트래킹 — 과거 스냅샷의 가격과 현재 가격을 비교하여 수익률을 표시.
 * scoreMode에 따라 종목추천 순위 또는 단기추천 순위로 표시.
 */
export function SnapshotTracker({ onClose, scoreMode = 'standard', livePrices }: SnapshotTrackerProps) {
  const [selectedDate, setSelectedDate] = useState<string>(WEEKDAYS[0] ?? '');
  const [snapshotData, setSnapshotData] = useState<SnapshotResponse | null>(null);
  const [fetchedPrices, setFetchedPrices] = useState<Map<string, number | null>>(new Map());
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

  // 부모에서 livePrices가 없을 때 stock_cache에서 현재가 조회
  const fetchCurrentPrices = useCallback(async (symbols: string[]) => {
    if (symbols.length === 0) return;
    try {
      const CHUNK = 200;
      const map = new Map<string, number | null>();
      for (let i = 0; i < symbols.length; i += CHUNK) {
        const chunk = symbols.slice(i, i + CHUNK);
        const res = await window.fetch(`/api/v1/prices?symbols=${chunk.join(',')}`);
        if (res.ok) {
          const { data } = await res.json();
          if (data) {
            for (const [sym, info] of Object.entries(data as Record<string, { current_price: number | null }>)) {
              map.set(sym, info.current_price);
            }
          }
        }
      }
      setFetchedPrices(map);
    } catch {
      // 실패 시 빈 맵 유지
    }
  }, []);

  useEffect(() => {
    if (selectedDate) {
      fetchSnapshot(selectedDate);
    }
  }, [selectedDate, fetchSnapshot]);

  // 부모에서 livePrices를 전달하지 않았을 때만 별도 조회
  useEffect(() => {
    if (!livePrices && snapshotData?.items?.length) {
      const symbols = snapshotData.items.map((item) => item.symbol);
      fetchCurrentPrices(symbols);
    }
  }, [snapshotData, fetchCurrentPrices, livePrices]);

  // 현재가 맵: livePrices 우선, 없으면 fetchedPrices
  const currentPrices = useMemo(() => {
    if (livePrices) {
      const map = new Map<string, number | null>();
      for (const [sym, info] of Object.entries(livePrices)) {
        map.set(sym, info.current_price);
      }
      return map;
    }
    return fetchedPrices;
  }, [livePrices, fetchedPrices]);

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

  // 스냅샷 아이템을 scoreMode에 따라 정렬 (단기추천이면 재정렬)
  const orderedSnapshotItems = useMemo(() => {
    if (!snapshotData?.items) return [];
    if (scoreMode === 'standard') {
      // 서버 score_total 순 (API가 이미 정렬해서 반환)
      return snapshotData.items;
    }
    // 단기추천: raw_data 기반으로 단기점수 재계산 후 정렬
    return [...snapshotData.items].sort((a, b) => {
      return computeShortTermScore(b) - computeShortTermScore(a);
    });
  }, [snapshotData, scoreMode]);

  // 표시용 행 계산
  const rows: TrackerRow[] = useMemo(() => {
    return orderedSnapshotItems.map((item, idx) => {
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
  }, [orderedSnapshotItems, currentPrices]);

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

  const modeLabel = scoreMode === 'short_term' ? '단기추천' : '종목추천';

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
            <span className="ml-2 text-xs font-normal text-[var(--muted)]">
              {modeLabel} 기준
            </span>
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
