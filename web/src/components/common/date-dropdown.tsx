'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { formatDateLabel } from '@/lib/date-utils';

interface DateDropdownProps {
  dates: string[];        // 최근 평일 목록 (YYYY-MM-DD) — [0]=오늘, [1]=어제
  selected: string;       // 선택된 날짜, 'all', 'week', 또는 extraAll.value
  onChange: (date: string) => void;
  allLabel?: string;      // 마지막 '전체' 항목 레이블 (기본값: '전체')
  extraAll?: { value: string; label: string };  // allLabel 앞에 추가 전체 옵션 (예: 신호전체)
  label?: string;         // 필터 타입 레이블 (예: '날짜') — 트리거 버튼 앞에 표시
}

function getDatePresetLabel(
  date: string,
  dates: string[],
  allLabel = '전체',
  extraAll?: { value: string; label: string },
): string {
  if (date === 'all') return allLabel;
  if (date === 'week') return '이번주';
  if (extraAll && date === extraAll.value) return extraAll.label;
  const idx = dates.indexOf(date);
  if (idx === 0) return '오늘';
  if (idx === 1) return '어제';
  return formatDateLabel(date); // 커스텀 날짜 → M/D(요일)
}

export function DateDropdown({ dates, selected, onChange, allLabel = '전체', extraAll, label }: DateDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleSelect = (date: string) => {
    onChange(date);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center gap-1 pl-3 pr-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] text-sm text-[var(--foreground)] hover:bg-[var(--card-hover)] transition-colors"
      >
        {label && (
          <span className="text-[var(--muted)] mr-0.5">{label}</span>
        )}
        <span className="font-medium">{getDatePresetLabel(selected, dates, allLabel, extraAll)}</span>
        <ChevronDown
          size={14}
          className={`text-[var(--muted)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 min-w-[8rem] rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg overflow-hidden">
          {/* 오늘 */}
          <button
            type="button"
            onClick={() => handleSelect(dates[0])}
            className={`w-full px-3 py-1.5 text-sm text-left hover:bg-[var(--card-hover)] transition-colors ${
              selected === dates[0] ? 'text-[var(--accent)] font-semibold' : 'text-[var(--foreground)]'
            }`}
          >
            오늘
          </button>
          {/* 어제 */}
          {dates[1] && (
            <button
              type="button"
              onClick={() => handleSelect(dates[1])}
              className={`w-full px-3 py-1.5 text-sm text-left hover:bg-[var(--card-hover)] transition-colors ${
                selected === dates[1] ? 'text-[var(--accent)] font-semibold' : 'text-[var(--foreground)]'
              }`}
            >
              어제
            </button>
          )}
          {/* 이번주 */}
          <button
            type="button"
            onClick={() => handleSelect('week')}
            className={`w-full px-3 py-1.5 text-sm text-left hover:bg-[var(--card-hover)] transition-colors ${
              selected === 'week' ? 'text-[var(--accent)] font-semibold' : 'text-[var(--foreground)]'
            }`}
          >
            이번주
          </button>
          {/* 추가 전체 옵션 (예: 신호전체) */}
          {extraAll && (
            <button
              type="button"
              onClick={() => handleSelect(extraAll.value)}
              className={`w-full px-3 py-1.5 text-sm text-left hover:bg-[var(--card-hover)] transition-colors ${
                selected === extraAll.value ? 'text-[var(--accent)] font-semibold' : 'text-[var(--foreground)]'
              }`}
            >
              {extraAll.label}
            </button>
          )}
          {/* 전체 (allLabel) */}
          <button
            type="button"
            onClick={() => handleSelect('all')}
            className={`w-full px-3 py-1.5 text-sm text-left hover:bg-[var(--card-hover)] transition-colors ${
              selected === 'all' ? 'text-[var(--accent)] font-semibold' : 'text-[var(--foreground)]'
            }`}
          >
            {allLabel}
          </button>
          <div className="mx-2 border-t border-[var(--border)]" />
          <div className="px-3 py-2">
            <label className="text-xs text-[var(--muted)] block mb-1">직접 선택</label>
            <input
              type="date"
              value={
                selected !== 'all' &&
                selected !== 'week' &&
                !(extraAll && selected === extraAll.value) &&
                !dates.includes(selected)
                  ? selected
                  : ''
              }
              className="w-full text-sm bg-[var(--card)] text-[var(--foreground)] border border-[var(--border)] rounded px-2 py-1 focus:outline-none focus:border-[var(--accent)]"
              onChange={(e) => {
                if (e.target.value) handleSelect(e.target.value);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
