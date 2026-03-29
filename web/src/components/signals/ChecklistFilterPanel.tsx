'use client';
import { useState, useEffect } from 'react';
import { ALL_CONDITIONS, type ConditionCategory } from '@/lib/checklist-recommendation/types';

const STORAGE_KEY = 'checklist-conditions';
const CATEGORY_LABELS: Record<ConditionCategory, string> = {
  trend: '추세', supply: '수급', valuation: '밸류', risk: '리스크',
};

interface Props { onChange: (activeIds: string[]) => void; }

export default function ChecklistFilterPanel({ onChange }: Props) {
  const [activeIds, setActiveIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set(ALL_CONDITIONS.map(c => c.id));
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return new Set(JSON.parse(stored) as string[]);
    } catch {}
    return new Set(ALL_CONDITIONS.map(c => c.id));
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...activeIds]));
    onChange([...activeIds]);
  }, [activeIds, onChange]);

  const toggle = (id: string) => {
    setActiveIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleCategory = (cat: ConditionCategory) => {
    const catIds = ALL_CONDITIONS.filter(c => c.category === cat).map(c => c.id);
    const allOn = catIds.every(id => activeIds.has(id));
    setActiveIds(prev => {
      const next = new Set(prev);
      for (const id of catIds) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 space-y-3">
      <div className="text-xs font-semibold text-[var(--muted)]">조건 필터</div>
      {(['trend', 'supply', 'valuation', 'risk'] as ConditionCategory[]).map(cat => {
        const items = ALL_CONDITIONS.filter(c => c.category === cat);
        const allOn = items.every(c => activeIds.has(c.id));
        return (
          <div key={cat} className="space-y-1">
            <button type="button" onClick={() => toggleCategory(cat)}
              className="text-xs font-medium text-[var(--text)] flex items-center gap-1.5">
              <span className={`w-3 h-3 rounded border ${allOn ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-[var(--border)]'}`} />
              {CATEGORY_LABELS[cat]}
            </button>
            <div className="flex flex-wrap gap-1.5 ml-4">
              {items.map(c => (
                <button key={c.id} type="button" onClick={() => toggle(c.id)}
                  className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                    activeIds.has(c.id)
                      ? 'bg-[var(--accent)]/10 border-[var(--accent)] text-[var(--accent)]'
                      : 'border-[var(--border)] text-[var(--muted)]'
                  }`}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
