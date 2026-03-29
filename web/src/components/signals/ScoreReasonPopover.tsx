'use client';

import { useState, useRef, useEffect } from 'react';
import type { ScoreReason } from '@/types/score-reason';

interface Props {
  label: string;
  normalizedScore: number;
  reasons: ScoreReason[];
  variant?: 'default' | 'risk';
  children: React.ReactNode;
}

export default function ScoreReasonPopover({
  label, normalizedScore, reasons, variant = 'default', children,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="w-full text-left">
        {children}
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 min-w-[280px] max-w-[360px] rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg p-3 space-y-2">
          <div className="flex items-center justify-between text-sm font-semibold">
            <span>{label}</span>
            <span className={variant === 'risk' ? 'text-red-400' : 'text-[var(--accent)]'}>
              {Math.round(normalizedScore)}/100
            </span>
          </div>

          <div className="h-px bg-[var(--border)]" />

          <div className="space-y-1.5">
            {reasons.map((r, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 shrink-0">
                  {r.met ? '✅' : '❌'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-[var(--text)]">{r.label}</span>
                    {r.met && (
                      <span className={`font-mono ${variant === 'risk' ? 'text-red-400' : 'text-green-400'}`}>
                        {r.points > 0 ? '+' : ''}{r.points.toFixed(1)}
                      </span>
                    )}
                  </div>
                  <p className="text-[var(--muted)] break-words">{r.detail}</p>
                </div>
              </div>
            ))}
          </div>

          {reasons.length === 0 && (
            <p className="text-xs text-[var(--muted)]">데이터 부족</p>
          )}
        </div>
      )}
    </div>
  );
}
