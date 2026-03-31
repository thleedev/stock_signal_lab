'use client';

import { useMemo } from 'react';
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer,
  LineChart, Line, YAxis,
} from 'recharts';
import type { StockRankItem } from '@/app/api/v1/stock-ranking/route';
import type { ScoreHistoryPoint } from '@/hooks/use-score-history';

interface Props {
  item: StockRankItem;
  history: ScoreHistoryPoint[];
}

export function AnalysisHoverCard({ item, history }: Props) {
  const radarData = useMemo(() => {
    if (!item.categories) return [];
    return [
      { category: '신호·기술', value: item.categories.signalTech.normalized },
      { category: '수급', value: item.categories.supply.normalized },
      { category: '가치·성장', value: item.categories.valueGrowth.normalized },
      { category: '모멘텀', value: item.categories.momentum.normalized },
    ];
  }, [item.categories]);

  const riskScore = item.categories?.risk?.normalized ?? 0;
  const checklist = item.checklist ?? [];
  const checklistMet = item.checklistMet ?? 0;
  const checklistTotal = item.checklistTotal ?? 0;

  return (
    <div className="w-[380px] p-3 rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-xl text-sm">
      <div className="flex gap-3 mb-2">
        <div className="w-[170px] h-[140px]">
          <ResponsiveContainer>
            <RadarChart data={radarData}>
              <PolarGrid stroke="var(--border)" />
              <PolarAngleAxis dataKey="category" tick={{ fontSize: 10, fill: 'var(--muted)' }} />
              <Radar dataKey="value" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        <div className="flex-1 flex flex-col justify-between">
          {history.length > 1 ? (
            <div className="h-[80px]">
              <ResponsiveContainer>
                <LineChart data={history}>
                  <YAxis domain={[0, 100]} hide />
                  <Line type="monotone" dataKey="score" stroke="var(--accent)" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
              <div className="text-xs text-[var(--muted)] text-center">7일 추이</div>
            </div>
          ) : (
            <div className="h-[80px] flex items-center justify-center text-xs text-[var(--muted)]">추이 데이터 없음</div>
          )}
          <div className="text-xs mt-1">
            리스크: <span className="text-red-400 font-medium">-{Math.round(riskScore * 0.15)}점</span>
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--border)] pt-2">
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          {checklist.map(c => (
            <span key={c.id} className={`text-xs ${c.na ? 'text-[var(--muted)]' : c.met ? 'text-green-400' : 'text-red-400'}`}>
              {c.na ? '·' : c.met ? '✓' : '✗'}{c.label.replace(/\s/g, '')}
            </span>
          ))}
        </div>
        <div className="text-xs text-[var(--muted)] mt-1">{checklistMet}/{checklistTotal} 충족</div>
      </div>
    </div>
  );
}
