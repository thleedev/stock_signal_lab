'use client';

import { useState, useEffect, useRef } from 'react';

interface ScoreItem {
  label: string;
  value: number;
  color: string;
}

interface GradeTooltipProps {
  weighted: number;
  scores: ScoreItem[];
  grade: string;
  gradeLabel: string;
  gradeCls: string;
}

const THRESHOLDS = [
  { grade: 'A+', min: 90, label: '적극매수' },
  { grade: 'A', min: 80, label: '매수' },
  { grade: 'B+', min: 65, label: '관심' },
  { grade: 'B', min: 50, label: '보통' },
  { grade: 'C', min: 35, label: '관망' },
  { grade: 'D', min: 0, label: '주의' },
];

export function GradeTooltip({ weighted, scores, grade, gradeLabel, gradeCls }: GradeTooltipProps) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!show) return;
    function handleOutside(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setShow(false);
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [show]);

  return (
    <span
      ref={ref}
      className="relative shrink-0"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={(e) => { e.stopPropagation(); setShow(v => !v); }}
    >
      <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold leading-none cursor-help ${gradeCls}`}>
        {grade} {gradeLabel}
      </span>
      {show && (
        <div
          className="absolute left-0 sm:left-1/2 sm:-translate-x-1/2 top-full mt-1.5 z-50 w-56 rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-xl p-3 space-y-2"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 총점 */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--text)]">종합점수</span>
            <span className={`text-lg font-bold tabular-nums ${
              weighted >= 65 ? 'text-red-500' : weighted >= 50 ? 'text-orange-500' : 'text-[var(--muted)]'
            }`}>{weighted.toFixed(0)}<span className="text-xs font-normal">점</span></span>
          </div>

          {/* 각 점수 바 */}
          <div className="space-y-1.5">
            {scores.map(s => (
              <div key={s.label} className="flex items-center gap-1.5">
                <span className="text-[10px] text-[var(--muted)] w-8 shrink-0">{s.label}</span>
                <div className="flex-1 h-2 rounded-full bg-[var(--border)] overflow-hidden">
                  <div className={`h-full rounded-full ${s.color} transition-all`} style={{ width: `${Math.min(100, s.value)}%` }} />
                </div>
                <span className="text-[10px] tabular-nums font-medium text-[var(--text)] w-6 text-right">{Math.round(s.value)}</span>
              </div>
            ))}
          </div>

          {/* 등급 기준표 */}
          <div className="border-t border-[var(--border)] pt-2">
            <p className="text-[10px] text-[var(--muted)] mb-1">등급 기준</p>
            <div className="grid grid-cols-3 gap-x-2 gap-y-0.5">
              {THRESHOLDS.map(t => (
                <span key={t.grade} className={`text-[10px] tabular-nums ${t.grade === grade ? 'font-bold text-[var(--text)]' : 'text-[var(--muted)]'}`}>
                  {t.grade} {t.min}+
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
