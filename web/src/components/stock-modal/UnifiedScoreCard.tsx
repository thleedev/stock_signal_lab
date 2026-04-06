// web/src/components/stock-modal/UnifiedScoreCard.tsx
'use client';

import { useState, useMemo } from 'react';
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer,
  LineChart, Line, YAxis, Tooltip,
} from 'recharts';
import type { StockRankItem } from '@/app/api/v1/stock-ranking/route';
import type { ScoreReason } from '@/types/score-reason';
import type { ScoreHistoryPoint } from '@/hooks/use-score-history';

interface Props {
  data: StockRankItem;
  history?: ScoreHistoryPoint[];
}

// ── 카테고리 메타 ──────────────────────────────────────────────────────────────
const CATEGORY_META = [
  { key: 'signalTech',  label: '신호·기술',   color: 'bg-amber-500',   text: 'text-amber-500'   },
  { key: 'supply',      label: '수급',        color: 'bg-sky-500',     text: 'text-sky-500'     },
  { key: 'valueGrowth', label: '가치·성장',   color: 'bg-violet-500',  text: 'text-violet-500'  },
  { key: 'momentum',    label: '모멘텀',      color: 'bg-emerald-500', text: 'text-emerald-500' },
  { key: 'risk',        label: '리스크',      color: 'bg-red-500',     text: 'text-red-500'     },
] as const;

// ── 등급 유틸 ─────────────────────────────────────────────────────────────────
function getGradeStyle(score: number): { badge: string; label: string } {
  if (score >= 85) return { badge: 'bg-red-600 text-white',        label: '적극매수' };
  if (score >= 70) return { badge: 'bg-red-500 text-white',        label: '매수'     };
  if (score >= 55) return { badge: 'bg-orange-400 text-white',     label: '관심'     };
  if (score >= 40) return { badge: 'bg-yellow-400 text-gray-900',  label: '보통'     };
  if (score >= 25) return { badge: 'bg-gray-400 text-white',       label: '관망'     };
  return                   { badge: 'bg-gray-600 text-gray-200',   label: '주의'     };
}

// ── 점수 → 색상 ───────────────────────────────────────────────────────────────
function scoreColor(v: number, invert = false): string {
  const high = invert ? v < 30 : v >= 70;
  const mid  = invert ? v < 60 : v >= 40;
  if (high) return 'text-green-400';
  if (mid)  return 'text-yellow-400';
  return 'text-red-400';
}

// ── 이유 목록 ─────────────────────────────────────────────────────────────────
function ReasonList({ reasons }: { reasons: ScoreReason[] }) {
  if (!reasons || reasons.length === 0) {
    return <p className="text-xs text-[var(--muted)] py-1">산출 근거 없음</p>;
  }
  const met    = reasons.filter((r) => r.met);
  const notMet = reasons.filter((r) => !r.met);

  return (
    <div className="space-y-1 py-1">
      {met.map((r, i) => (
        <div key={i} className="flex items-start gap-2 text-xs">
          <span className="shrink-0 text-green-400 mt-0.5">✓</span>
          <div className="min-w-0">
            <span className="font-medium text-[var(--text)]">{r.label}</span>
            <span className={`ml-1.5 font-mono font-bold ${r.points >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {r.points >= 0 ? '+' : ''}{r.points.toFixed(1)}
            </span>
            {r.detail && (
              <p className="text-[var(--muted)] leading-snug mt-0.5">{r.detail}</p>
            )}
          </div>
        </div>
      ))}
      {notMet.length > 0 && (
        <details className="cursor-pointer">
          <summary className="text-xs text-[var(--muted)] select-none hover:text-[var(--text)] transition-colors">
            미충족 조건 {notMet.length}개 보기
          </summary>
          <div className="mt-1 space-y-1">
            {notMet.map((r, i) => (
              <div key={i} className="flex items-start gap-2 text-xs opacity-60">
                <span className="shrink-0 text-[var(--muted)] mt-0.5">✗</span>
                <div className="min-w-0">
                  <span className="text-[var(--muted)]">{r.label}</span>
                  {r.detail && (
                    <p className="text-[var(--muted)] leading-snug mt-0.5">{r.detail}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ── 카테고리 아코디언 항목 ────────────────────────────────────────────────────
function CategoryAccordion({
  label, normalized, color, textColor, reasons, isRisk = false,
}: {
  label: string;
  normalized: number;
  color: string;
  textColor: string;
  reasons: ScoreReason[];
  isRisk?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pct = Math.min(100, Math.max(0, normalized));

  return (
    <div className="border border-[var(--border)] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--card-hover)] transition-colors text-left"
      >
        {/* 카테고리명 */}
        <span className="text-sm font-medium w-20 shrink-0">{label}</span>

        {/* 점수 바 */}
        <div className="flex-1 h-2 rounded-full bg-[var(--border)] overflow-hidden">
          <div
            className={`h-full rounded-full ${color} transition-all duration-500`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* 점수 숫자 */}
        <span className={`tabular-nums text-sm font-bold w-8 text-right shrink-0 ${textColor}`}>
          {Math.round(normalized)}
        </span>

        {/* 충족 이유 수 */}
        <span className="text-xs text-[var(--muted)] w-14 text-right shrink-0">
          {reasons.filter((r) => r.met).length}/{reasons.length}개
        </span>

        {/* 펼침 아이콘 */}
        <span className="text-xs text-[var(--muted)] shrink-0">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 border-t border-[var(--border)] bg-[var(--background)]">
          <ReasonList reasons={reasons} />
          {isRisk && normalized > 0 && (
            <p className="text-xs text-red-400 mt-2 font-medium">
              ※ 리스크 점수가 높을수록 총점에서 감점됩니다
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export function UnifiedScoreCard({ data, history = [] }: Props) {
  const { badge, label: gradeLabel } = getGradeStyle(data.score_total);

  // 레이더 데이터 — score_* 필드로 구성
  const radarData = useMemo(() => [
    { category: '신호·기술',  value: Math.round(data.score_signal ?? 0) },
    { category: '수급',       value: Math.round(data.score_supply ?? 0) },
    { category: '가치·성장',  value: Math.round(data.score_value ?? 0) },
    { category: '모멘텀',     value: Math.round(data.score_momentum ?? 0) },
  ], [data.score_signal, data.score_supply, data.score_value, data.score_momentum]);

  return (
    <div className="p-4 space-y-4">
      {/* ── 헤더: 총점 + 등급 + 스타일 ── */}
      <div className="flex items-center gap-3">
        <div className="text-center shrink-0">
          <p className={`text-4xl font-bold tabular-nums ${scoreColor(data.score_total)}`}>
            {Math.round(data.score_total)}
          </p>
          <p className="text-xs text-[var(--muted)]">/ 100</p>
        </div>
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-0.5 rounded-full text-sm font-bold ${badge}`}>
              {gradeLabel}
            </span>
          </div>
        </div>
      </div>

      {/* ── 레이더 + 점수 추이 ── */}
      {(radarData.length > 0 || history.length > 1) && (
        <div className="flex gap-3 h-[140px]">
          {radarData.length > 0 && (
            <div className="w-[160px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                  <PolarGrid stroke="var(--border)" />
                  <PolarAngleAxis dataKey="category" tick={{ fontSize: 9, fill: 'var(--muted)' }} />
                  <Radar dataKey="value" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.25} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          )}
          {history.length > 1 && (
            <div className="flex-1 flex flex-col">
              <p className="text-xs text-[var(--muted)] mb-1">7일 점수 추이</p>
              <div className="flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history} margin={{ top: 2, right: 4, bottom: 2, left: 0 }}>
                    <YAxis domain={[0, 100]} hide />
                    <Tooltip
                      contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', fontSize: 11 }}
                      formatter={(v) => [`${v}점`, '점수']}
                      labelFormatter={(l) => String(l).slice(5)}
                    />
                    <Line type="monotone" dataKey="score" stroke="var(--accent)" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 축별 점수 바 (score_* 기반) ── */}
      <div className="space-y-2">
        {[
          { label: '신호',    value: data.score_signal   ?? 0, color: 'bg-amber-500',   text: 'text-amber-500'   },
          { label: '수급',    value: data.score_supply   ?? 0, color: 'bg-sky-500',     text: 'text-sky-500'     },
          { label: '가치',    value: data.score_value    ?? 0, color: 'bg-violet-500',  text: 'text-violet-500'  },
          { label: '모멘텀',  value: data.score_momentum ?? 0, color: 'bg-emerald-500', text: 'text-emerald-500' },
          { label: '성장',    value: data.score_growth   ?? 0, color: 'bg-orange-500',  text: 'text-orange-500'  },
          { label: '리스크',  value: data.score_risk     ?? 0, color: 'bg-red-500',     text: 'text-red-500'     },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-3 px-1">
            <span className="text-sm w-14 shrink-0">{item.label}</span>
            <div className="flex-1 h-2 rounded-full bg-[var(--border)] overflow-hidden">
              <div
                className={`h-full rounded-full ${item.color}`}
                style={{ width: `${Math.min(100, Math.max(0, item.value))}%` }}
              />
            </div>
            <span className={`tabular-nums text-sm font-bold w-8 text-right ${item.text}`}>
              {Math.round(item.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
