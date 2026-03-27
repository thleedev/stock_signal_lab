'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { TrendingUp, TrendingDown, Loader2 } from 'lucide-react';

interface HistoryItem {
  session_id: number;
  session_date: string;
  session_time: string;
  trigger_type: string;
  snapshot_price: number | null;
  grade: string | null;
  score_total: number;
}

interface ReturnTrendSectionProps {
  symbol: string;
  currentPrice: number | null;
}

const GRADE_CLS: Record<string, string> = {
  S: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  A: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  B: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  C: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  D: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

export function ReturnTrendSection({ symbol, currentPrice }: ReturnTrendSectionProps) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/v1/stock-ranking/snapshot/history?symbol=${symbol}&limit=30`,
      );
      if (res.ok) {
        const data = await res.json();
        setItems(data.items ?? []);
      }
    } catch {
      // 무시
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // 수익률 계산
  const rows = useMemo(() => {
    return items.map((item) => {
      let returnPct: number | null = null;
      if (item.snapshot_price && item.snapshot_price > 0 && currentPrice && currentPrice > 0) {
        returnPct = ((currentPrice - item.snapshot_price) / item.snapshot_price) * 100;
      }
      return { ...item, returnPct };
    });
  }, [items, currentPrice]);

  const fmtDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Seoul',
    });
  };

  const fmtReturn = (v: number | null) => {
    if (v == null) return { text: '-', cls: 'text-[var(--muted)]' };
    const sign = v > 0 ? '+' : '';
    const cls = v > 0 ? 'text-[var(--danger)]' : v < 0 ? 'text-blue-500' : 'text-[var(--muted)]';
    return { text: `${sign}${v.toFixed(2)}%`, cls };
  };

  if (loading) {
    return (
      <div className="p-4">
        <h3 className="text-sm font-semibold text-[var(--foreground)] mb-3">수익률 추이</h3>
        <div className="flex items-center justify-center py-8 text-[var(--muted)] text-sm gap-2">
          <Loader2 size={14} className="animate-spin" />
          로딩 중...
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="p-4">
        <h3 className="text-sm font-semibold text-[var(--foreground)] mb-3">수익률 추이</h3>
        <p className="text-sm text-[var(--muted)] text-center py-6">스냅샷 데이터가 없습니다</p>
      </div>
    );
  }

  // 간이 라인 차트 (SVG)
  const validRows = rows.filter((r) => r.returnPct !== null);
  const maxAbs = Math.max(1, ...validRows.map((r) => Math.abs(r.returnPct!)));
  const chartW = 280;
  const chartH = 80;
  const padding = 8;

  const points = validRows
    .slice()
    .reverse() // 오래된 순
    .map((r, i, arr) => {
      const x = padding + (i / Math.max(1, arr.length - 1)) * (chartW - padding * 2);
      const y = chartH / 2 - (r.returnPct! / maxAbs) * (chartH / 2 - padding);
      return { x, y, returnPct: r.returnPct! };
    });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return (
    <div className="p-4">
      <h3 className="text-sm font-semibold text-[var(--foreground)] mb-3">수익률 추이</h3>

      {/* 간이 라인 차트 */}
      {validRows.length >= 2 && (
        <div className="mb-3 flex justify-center">
          <svg width={chartW} height={chartH} className="overflow-visible">
            {/* 0% 기준선 */}
            <line
              x1={padding}
              y1={chartH / 2}
              x2={chartW - padding}
              y2={chartH / 2}
              stroke="var(--border)"
              strokeDasharray="3 3"
            />
            {/* 라인 */}
            <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth={2} />
            {/* 점 */}
            {points.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={3}
                fill={p.returnPct >= 0 ? 'var(--danger)' : '#3b82f6'}
              />
            ))}
          </svg>
        </div>
      )}

      {/* 테이블 */}
      <div className="max-h-[200px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[var(--card)]">
            <tr className="text-[var(--muted)] border-b border-[var(--border)]">
              <th className="py-1.5 text-left">날짜</th>
              <th className="py-1.5 text-center">등급</th>
              <th className="py-1.5 text-right">당시가격</th>
              <th className="py-1.5 text-right">수익률</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((row) => {
              const ret = fmtReturn(row.returnPct);
              const gradeCls = row.grade
                ? GRADE_CLS[row.grade] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                : '';
              return (
                <tr key={row.session_id}>
                  <td className="py-1.5 text-[var(--muted)]">
                    {fmtDate(row.session_date)}
                    <span className="ml-1 text-[9px]">{fmtTime(row.session_time)}</span>
                  </td>
                  <td className="py-1.5 text-center">
                    {row.grade ? (
                      <span className={`inline-block px-1 py-0.5 rounded text-[9px] font-bold ${gradeCls}`}>
                        {row.grade}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {row.snapshot_price?.toLocaleString() ?? '-'}
                  </td>
                  <td className={`py-1.5 text-right font-semibold tabular-nums ${ret.cls}`}>
                    <span className="inline-flex items-center gap-0.5 justify-end">
                      {row.returnPct != null && row.returnPct > 0 && <TrendingUp size={9} />}
                      {row.returnPct != null && row.returnPct < 0 && <TrendingDown size={9} />}
                      {ret.text}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
