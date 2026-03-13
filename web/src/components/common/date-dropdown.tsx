'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { formatDateLabel } from '@/lib/date-utils';

interface DateDropdownProps {
  dates: string[];        // 최근 평일 목록 (YYYY-MM-DD), 보통 4~7개
  selected: string;       // 선택된 날짜 또는 'all'
  onChange: (date: string) => void;
}

function getDatePresetLabel(date: string, dates: string[]): string {
  if (date === 'all') return '전체';
  const idx = dates.indexOf(date);
  if (idx === 0) return '오늘';
  if (idx === 1) return '어제';
  if (idx === 2) return '2일전';
  if (idx === 3) return '3일전';
  return formatDateLabel(date); // index 4+ 또는 커스텀 날짜 → M/D(요일)
}

export function DateDropdown({ dates, selected, onChange }: DateDropdownProps) {
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
        <span>{getDatePresetLabel(selected, dates)}</span>
        <ChevronDown
          size={14}
          className={`text-[var(--muted)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 min-w-[8rem] rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg overflow-hidden">
          {dates.map((date) => (
            <button
              type="button"
              key={date}
              onClick={() => handleSelect(date)}
              className={`w-full px-3 py-1.5 text-sm text-left hover:bg-[var(--card-hover)] transition-colors ${
                selected === date
                  ? 'text-[var(--accent)] font-semibold'
                  : 'text-[var(--foreground)]'
              }`}
            >
              {getDatePresetLabel(date, dates)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => handleSelect('all')}
            className={`w-full px-3 py-1.5 text-sm text-left hover:bg-[var(--card-hover)] transition-colors ${
              selected === 'all'
                ? 'text-[var(--accent)] font-semibold'
                : 'text-[var(--foreground)]'
            }`}
          >
            전체
          </button>
          <div className="mx-2 border-t border-[var(--border)]" />
          <div className="px-3 py-2">
            <label className="text-xs text-[var(--muted)] block mb-1">직접 선택</label>
            <input
              type="date"
              value={selected !== 'all' && !dates.includes(selected) ? selected : ''}
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
