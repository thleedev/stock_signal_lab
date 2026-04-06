'use client';

import { useState, useEffect } from 'react';
import {
  LineChart, Line, YAxis, ResponsiveContainer,
} from 'recharts';
import type { StockRankItem } from '@/app/api/v1/stock-ranking/route';
import type { ScoreHistoryPoint } from '@/hooks/use-score-history';
import type { StockAnalysisResponse, AnalysisCategory } from '@/app/api/v1/stock-analysis/route';

interface Props {
  item: StockRankItem;
  history: ScoreHistoryPoint[];
}

// score_momentum은 DB 컬럼명이지만 실제로는 기술전환(Technical Reversal) 점수입니다.
const SCORE_BARS: { label: string; field: 'score_signal' | 'score_supply' | 'score_value' | 'score_momentum'; color: string }[] = [
  { label: '신호', field: 'score_signal',   color: 'bg-amber-500' },
  { label: '수급', field: 'score_supply',   color: 'bg-sky-500' },
  { label: '가치', field: 'score_value',    color: 'bg-violet-500' },
  { label: '기술', field: 'score_momentum', color: 'bg-emerald-500' },
];

const CATEGORY_COLOR: Record<AnalysisCategory['id'], string> = {
  signal:    'text-amber-400',
  supply:    'text-sky-400',
  valuation: 'text-violet-400',
  technical: 'text-emerald-400',
  risk:      'text-red-400',
};

export function AnalysisHoverCard({ item, history }: Props) {
  const riskScore = item.score_risk ?? 0;
  const totalScore = item.score_total ?? 0;

  const [analysisData, setAnalysisData] = useState<StockAnalysisResponse | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(true);

  useEffect(() => {
    if (!item.symbol) return;
    const controller = new AbortController();
    fetch(`/api/v1/stock-analysis?symbol=${encodeURIComponent(item.symbol)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<StockAnalysisResponse>;
      })
      .then((json) => {
        setAnalysisData(json);
        setAnalysisLoading(false);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setAnalysisLoading(false);
      });
    return () => controller.abort();
  }, [item.symbol]);

  return (
    <div className="w-[340px] p-3 rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-xl space-y-2.5">

      {/* ── 종목명 + 총점 ── */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[var(--text)]">{item.name}</span>
        <span className={`text-base font-bold tabular-nums ${
          totalScore >= 65 ? 'text-red-500' : totalScore >= 50 ? 'text-orange-500' : 'text-[var(--muted)]'
        }`}>{totalScore}<span className="text-xs font-normal ml-0.5">점</span></span>
      </div>

      {/* ── 카테고리 점수 바 + 리스크 감점 ── */}
      <div className="space-y-1.5">
        {SCORE_BARS.map(b => {
          const val = (item[b.field] as number) ?? 0;
          return (
            <div key={b.label} className="flex items-center gap-1.5">
              <span className="text-[10px] text-[var(--muted)] w-8 shrink-0">{b.label}</span>
              <div className="flex-1 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
                <div className={`h-full rounded-full ${b.color}`} style={{ width: `${Math.min(100, Math.max(0, val))}%` }} />
              </div>
              <span className="text-[10px] tabular-nums text-[var(--muted)] w-6 text-right">{Math.round(val)}</span>
            </div>
          );
        })}
        <div className="text-[10px] text-[var(--muted)] text-right">
          리스크 감점 <span className="text-red-400 font-medium">-{Math.round(riskScore * 0.15)}</span>
        </div>
      </div>

      {/* ── 세부 조건 체크리스트 ── */}
      <div className="border-t border-[var(--border)] pt-2">
        {analysisLoading ? (
          <div className="space-y-1.5">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-4 rounded bg-[var(--border)] animate-pulse" />
            ))}
          </div>
        ) : analysisData ? (
          <ChecklistSection categories={analysisData.categories} />
        ) : (
          <p className="text-[10px] text-[var(--muted)]">조건 데이터를 불러오지 못했습니다.</p>
        )}
      </div>

      {/* ── 7일 추이 ── */}
      {history.length > 1 && (
        <div className="border-t border-[var(--border)] pt-2">
          <div className="h-[50px]">
            <ResponsiveContainer>
              <LineChart data={history}>
                <YAxis domain={[0, 100]} hide />
                <Line type="monotone" dataKey="score" stroke="var(--accent)" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[10px] text-[var(--muted)] text-center">7일 점수 추이</div>
        </div>
      )}
    </div>
  );
}

/** 카테고리별 충족/미충족/해당없음 조건 전체 나열 (토글 없음) */
function ChecklistSection({ categories }: { categories: AnalysisCategory[] }) {
  // risk 카테고리는 별도 표기
  const mainCats = categories.filter(c => c.id !== 'risk');
  const riskCat = categories.find(c => c.id === 'risk');

  return (
    <div className="space-y-2">
      {mainCats.map(cat => {
        const passed = cat.reasons.filter(r => r.passed);
        return (
          <div key={cat.id}>
            {/* 카테고리 헤더 */}
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`text-[10px] font-semibold w-8 shrink-0 ${CATEGORY_COLOR[cat.id]}`}>{cat.label}</span>
              <span className="text-[10px] text-[var(--muted)]">{passed.length}/{cat.reasons.length}</span>
            </div>
            {/* 모든 조건 나열 */}
            <div className="space-y-0.5 ml-1">
              {cat.reasons.map((r, i) => (
                <div key={i} className={`flex items-start gap-1 text-[10px] ${r.passed ? '' : 'opacity-50'}`}>
                  <span className={`shrink-0 mt-px ${r.passed ? 'text-green-400' : 'text-[var(--muted)]'}`}>
                    {r.passed ? '✓' : '✗'}
                  </span>
                  <span className={r.passed ? 'text-[var(--text)]' : 'text-[var(--muted)]'}>{r.label}</span>
                  {r.value && <span className="text-[var(--muted)] truncate ml-auto pl-1">{r.value}</span>}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* 리스크 조건 */}
      {riskCat && (
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[10px] font-semibold w-8 shrink-0 text-red-400">{riskCat.label}</span>
            <span className="text-[10px] text-[var(--muted)]">
              {riskCat.reasons.filter(r => r.passed).length}/{riskCat.reasons.length}
            </span>
          </div>
          <div className="space-y-0.5 ml-1">
            {riskCat.reasons.map((r, i) => (
              <div key={i} className={`flex items-start gap-1 text-[10px] ${r.passed ? '' : 'opacity-50'}`}>
                <span className={`shrink-0 mt-px ${r.passed ? 'text-green-400' : 'text-red-400'}`}>
                  {r.passed ? '✓' : '⚠'}
                </span>
                <span className={r.passed ? 'text-[var(--text)]' : 'text-red-400'}>{r.label}</span>
                {r.value && <span className="text-[var(--muted)] truncate ml-auto pl-1">{r.value}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
