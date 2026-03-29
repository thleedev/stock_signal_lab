'use client';
import { useState, useCallback, useEffect } from 'react';
import ChecklistFilterPanel from './ChecklistFilterPanel';
import { ALL_CONDITIONS } from '@/lib/checklist-recommendation/types';
import type { ChecklistItem, ConditionCategory, ChecklistGrade } from '@/lib/checklist-recommendation/types';

const GRADE_COLORS: Record<ChecklistGrade, string> = {
  A: 'bg-green-500',
  B: 'bg-blue-500',
  C: 'bg-orange-500',
  D: 'bg-red-500',
};
const CATEGORY_LABELS: Record<ConditionCategory, string> = {
  trend: '추세', supply: '수급', valuation: '밸류', risk: '리스크',
};

export default function ChecklistSection() {
  const [activeIds, setActiveIds] = useState<string[]>(ALL_CONDITIONS.map(c => c.id));
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);

  const fetchData = useCallback(async (ids: string[]) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/stock-ranking?mode=checklist&conditions=${ids.join(',')}`);
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
    if (activeIds.length > 0) fetchData(activeIds);
    else setItems([]);
  }, [activeIds, fetchData]);

  const handleFilterChange = useCallback((ids: string[]) => {
    setActiveIds(ids);
  }, []);

  const categories = ['trend', 'supply', 'valuation', 'risk'] as ConditionCategory[];

  return (
    <div className="space-y-4">
      <ChecklistFilterPanel onChange={handleFilterChange} />
      {loading && (
        <div className="text-center text-sm text-[var(--muted)] py-8">로딩 중...</div>
      )}
      {!loading && items.length === 0 && (
        <div className="text-center text-sm text-[var(--muted)] py-8">오늘 매수 신호 종목이 없습니다</div>
      )}
      {!loading && items.length > 0 && (
        <div className="text-xs text-[var(--muted)]">{total}개 종목 중 상위 {items.length}개</div>
      )}
      <div className="space-y-3">
        {items.map(item => {
          const activeConditions = item.conditions.filter(c => activeIds.includes(c.id));
          return (
            <div key={item.symbol} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-[var(--text)]">{item.name}</span>
                  <span className="text-xs text-[var(--muted)]">{item.symbol}</span>
                  {item.currentPrice && (
                    <span className="text-xs text-[var(--muted)]">
                      {item.currentPrice.toLocaleString('ko-KR')}원
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold text-white ${GRADE_COLORS[item.grade]}`}>
                    {item.grade}
                  </span>
                  <span className="text-xs text-[var(--muted)]">{item.metCount}/{item.activeCount} 충족</span>
                </div>
              </div>
              {categories.map(cat => {
                const catConds = activeConditions.filter(c => c.category === cat);
                if (catConds.length === 0) return null;
                const catMet = catConds.filter(c => c.met && !c.na).length;
                const catTotal = catConds.filter(c => !c.na).length;
                return (
                  <div key={cat}>
                    <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-1">
                      <span>{CATEGORY_LABELS[cat]}</span>
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
          );
        })}
      </div>
    </div>
  );
}
