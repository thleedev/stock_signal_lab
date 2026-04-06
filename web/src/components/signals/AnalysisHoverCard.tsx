'use client';

import {
  LineChart, Line, YAxis, ResponsiveContainer,
} from 'recharts';
import type { StockRankItem } from '@/app/api/v1/stock-ranking/route';
import type { ScoreHistoryPoint } from '@/hooks/use-score-history';

interface Props {
  item: StockRankItem;
  history: ScoreHistoryPoint[];
}

const SCORE_BARS: { label: string; field: 'score_signal' | 'score_supply' | 'score_value' | 'score_momentum'; color: string }[] = [
  { label: '신호', field: 'score_signal',   color: 'bg-amber-500' },
  { label: '수급', field: 'score_supply',   color: 'bg-sky-500' },
  { label: '가치', field: 'score_value',    color: 'bg-violet-500' },
  { label: '모멘텀', field: 'score_momentum', color: 'bg-emerald-500' },
];

export function AnalysisHoverCard({ item, history }: Props) {
  const riskScore = item.score_risk ?? 0;
  const totalScore = item.score_total ?? 0;

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

      {/* ── 7일 추이 ── */}
      {history.length > 1 && (
        <div className="border-t border-[var(--border)] pt-2">
          <div className="h-[60px]">
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
