'use client';

import { useState, useCallback } from 'react';
import {
  STYLE_PRESETS,
  loadCustomPresets,
  saveCustomPreset,
  deleteCustomPreset,
  validateWeights,
} from '@/lib/unified-scoring/presets';
import type { StyleWeights, CustomPreset } from '@/lib/unified-scoring/types';
import { ALL_CONDITIONS } from '@/lib/checklist-recommendation/types';

interface Props {
  currentStyleId: string;
  onStyleChange: (styleId: string, weights?: StyleWeights, disabledConditionIds?: string[]) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  signalTech: '신호·기술',
  supply: '수급',
  valueGrowth: '가치·성장',
  momentum: '모멘텀',
  risk: '리스크',
};

const CATEGORY_COLORS: Record<string, string> = {
  signalTech: 'bg-blue-500',
  supply: 'bg-green-500',
  valueGrowth: 'bg-yellow-500',
  momentum: 'bg-red-500',
  risk: 'bg-gray-500',
};

const CHECKLIST_CATEGORY_LABELS: Record<string, string> = {
  trend: '기술적',
  supply: '수급',
  valuation: '가치',
  risk: '리스크',
};

export function StyleSelector({ currentStyleId, onStyleChange }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editWeights, setEditWeights] = useState<StyleWeights>({ signalTech: 22, supply: 22, valueGrowth: 22, momentum: 19, risk: 15 });
  const [editName, setEditName] = useState('');
  const [editDisabledConds, setEditDisabledConds] = useState<Set<string>>(new Set());
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>(() => loadCustomPresets());

  const currentPreset = STYLE_PRESETS.find(p => p.id === currentStyleId);
  const currentCustom = customPresets.find(p => p.id === currentStyleId);
  const displayName = currentPreset?.name ?? currentCustom?.name ?? '커스텀';

  const handleSelect = useCallback((id: string, weights?: StyleWeights, disabledConds?: string[]) => {
    onStyleChange(id, weights, disabledConds);
    setIsOpen(false);
    setEditing(false);
  }, [onStyleChange]);

  const handleSliderChange = useCallback((key: keyof StyleWeights, value: number) => {
    setEditWeights(prev => {
      if (key === 'risk') {
        const clamped = Math.max(10, Math.min(20, value));
        const diff = clamped - prev.risk;
        const others = ['signalTech', 'supply', 'valueGrowth', 'momentum'] as const;
        const otherSum = others.reduce((sum, k) => sum + prev[k], 0);
        if (otherSum - diff <= 0) return prev;

        const newWeights = { ...prev, risk: clamped };
        others.forEach(k => {
          newWeights[k] = Math.round(prev[k] * ((otherSum - diff) / otherSum));
        });
        const newOtherSum = others.reduce((sum, k) => sum + newWeights[k], 0);
        const target = 100 - clamped;
        if (newOtherSum !== target) {
          newWeights[others[0]] += target - newOtherSum;
        }
        return newWeights;
      } else {
        const maxForKey = 100 - prev.risk;
        const clamped = Math.max(0, Math.min(maxForKey, value));
        const others = (['signalTech', 'supply', 'valueGrowth', 'momentum'] as const).filter(k => k !== key);
        const oldOtherSum = others.reduce((sum, k) => sum + prev[k], 0);
        const newOtherTarget = maxForKey - clamped;

        const newWeights = { ...prev, [key]: clamped };
        if (oldOtherSum > 0) {
          others.forEach(k => {
            newWeights[k] = Math.round(prev[k] * (newOtherTarget / oldOtherSum));
          });
          const sum = others.reduce((s, k) => s + newWeights[k], 0);
          if (sum !== newOtherTarget) newWeights[others[0]] += newOtherTarget - sum;
        }
        return newWeights;
      }
    });
  }, []);

  const toggleCondition = useCallback((id: string) => {
    setEditDisabledConds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleOpenNew = useCallback(() => {
    setEditWeights({ signalTech: 22, supply: 22, valueGrowth: 22, momentum: 19, risk: 15 });
    setEditName('');
    setEditDisabledConds(new Set());
    setEditing(true);
    setIsOpen(false);
  }, []);

  const handleSave = useCallback(() => {
    if (!editName.trim() || !validateWeights(editWeights)) return;
    const id = `custom_${Date.now()}`;
    const disabledConditionsArr = Array.from(editDisabledConds);
    const preset: CustomPreset = {
      id,
      name: editName.trim(),
      weights: editWeights,
      disabledConditions: disabledConditionsArr.length > 0 ? disabledConditionsArr : undefined,
    };
    const updated = saveCustomPreset(preset);
    setCustomPresets(updated);
    handleSelect(id, editWeights, disabledConditionsArr.length > 0 ? disabledConditionsArr : undefined);
    setEditing(false);
  }, [editName, editWeights, editDisabledConds, handleSelect]);

  const handleDelete = useCallback((id: string) => {
    const updated = deleteCustomPreset(id);
    setCustomPresets(updated);
    if (currentStyleId === id) handleSelect('balanced');
  }, [currentStyleId, handleSelect]);

  // 체크리스트 조건을 카테고리별로 그룹
  const conditionsByCategory = ALL_CONDITIONS.reduce((acc, cond) => {
    const cat = cond.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(cond);
    return acc;
  }, {} as Record<string, typeof ALL_CONDITIONS>);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--card-hover)] transition-colors"
      >
        <span>{displayName}</span>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-64 rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg">
          {STYLE_PRESETS.map(preset => (
            <button
              key={preset.id}
              onClick={() => handleSelect(preset.id)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--card-hover)] ${currentStyleId === preset.id ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : ''}`}
            >
              <div className="font-medium">{preset.name}</div>
              <div className="text-xs text-[var(--muted)]">{preset.description}</div>
            </button>
          ))}

          {customPresets.length > 0 && <div className="border-t border-[var(--border)] my-1" />}

          {customPresets.map(preset => (
            <div key={preset.id} className="flex items-center justify-between px-3 py-2 hover:bg-[var(--card-hover)]">
              <button
                onClick={() => handleSelect(preset.id, preset.weights, preset.disabledConditions)}
                className={`text-left text-sm flex-1 ${currentStyleId === preset.id ? 'text-[var(--accent)]' : ''}`}
              >
                {preset.name}
                {preset.disabledConditions?.length ? (
                  <span className="ml-1 text-xs text-[var(--muted)]">({12 - preset.disabledConditions.length}/12)</span>
                ) : null}
              </button>
              <button onClick={() => handleDelete(preset.id)} className="text-xs text-[var(--muted)] hover:text-red-500 ml-2">삭제</button>
            </div>
          ))}

          <div className="border-t border-[var(--border)] mt-1">
            <button
              onClick={handleOpenNew}
              className="w-full text-left px-3 py-2 text-sm font-medium text-[var(--accent)] hover:bg-[var(--card-hover)]"
            >
              + 새 스타일 만들기
            </button>
          </div>
        </div>
      )}

      {editing && (
        <div className="mt-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--card)] space-y-3 w-72">
          <input
            type="text"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            placeholder="스타일 이름"
            className="w-full px-2 py-1 text-sm rounded border border-[var(--border)] bg-transparent"
          />

          {/* 가중치 슬라이더 */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-[var(--muted)]">카테고리 가중치</p>
            {(Object.keys(CATEGORY_LABELS) as (keyof StyleWeights)[]).map(key => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-xs w-16 text-[var(--muted)]">{CATEGORY_LABELS[key]}</span>
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${CATEGORY_COLORS[key]}`} />
                <input
                  type="range"
                  min={key === 'risk' ? 10 : 0}
                  max={key === 'risk' ? 20 : 60}
                  value={editWeights[key]}
                  onChange={e => handleSliderChange(key, Number(e.target.value))}
                  className="flex-1"
                />
                <span className="text-xs w-8 text-right font-mono">{editWeights[key]}</span>
              </div>
            ))}
          </div>

          {/* 체크리스트 조건 토글 */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-[var(--muted)]">체크리스트 항목 <span className="text-[var(--muted)]/60">(비활성화하면 N/A 처리)</span></p>
            {Object.entries(conditionsByCategory).map(([cat, conds]) => (
              <div key={cat}>
                <p className="text-xs text-[var(--muted)]/70 mb-1">{CHECKLIST_CATEGORY_LABELS[cat] ?? cat}</p>
                <div className="flex flex-col gap-1">
                  {conds.map(cond => {
                    const disabled = editDisabledConds.has(cond.id);
                    return (
                      <button
                        key={cond.id}
                        type="button"
                        onClick={() => toggleCondition(cond.id)}
                        className={`flex items-center gap-2 px-2 py-1 rounded text-xs text-left transition-colors ${
                          disabled
                            ? 'bg-[var(--muted)]/10 text-[var(--muted)]/50 line-through'
                            : 'bg-[var(--accent)]/8 text-[var(--foreground)] hover:bg-[var(--accent)]/15'
                        }`}
                      >
                        <span className={`w-3 h-3 rounded-sm border flex items-center justify-center flex-shrink-0 ${disabled ? 'border-[var(--muted)]/30' : 'border-[var(--accent)] bg-[var(--accent)]'}`}>
                          {!disabled && (
                            <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </span>
                        {cond.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 justify-end">
            <button onClick={() => setEditing(false)} className="px-3 py-1 text-xs rounded border border-[var(--border)]">취소</button>
            <button onClick={handleSave} className="px-3 py-1 text-xs rounded bg-[var(--accent)] text-white">저장</button>
          </div>
        </div>
      )}
    </div>
  );
}
