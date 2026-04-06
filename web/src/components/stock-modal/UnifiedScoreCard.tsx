// web/src/components/stock-modal/UnifiedScoreCard.tsx
'use client';

import { useState, useEffect } from 'react';
import {
  LineChart, Line, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import type { StockRankItem } from '@/app/api/v1/stock-ranking/route';
import type { StockAnalysisResponse, AnalysisCategory } from '@/app/api/v1/stock-analysis/route';
import type { ScoreHistoryPoint } from '@/hooks/use-score-history';

interface Props {
  data: StockRankItem;
  history?: ScoreHistoryPoint[];
}

// ── 카테고리 메타 ──────────────────────────────────────────────────────────────
const CATEGORY_META: Record<AnalysisCategory['id'], { color: string; hex: string; bar: string; text: string }> = {
  technical:  { color: 'text-emerald-400', hex: '#34d399', bar: 'bg-emerald-500', text: '기술전환' },
  supply:     { color: 'text-sky-400',     hex: '#38bdf8', bar: 'bg-sky-500',     text: '수급강도' },
  valuation:  { color: 'text-violet-400',  hex: '#a78bfa', bar: 'bg-violet-500',  text: '가치매력' },
  signal:     { color: 'text-amber-400',   hex: '#fbbf24', bar: 'bg-amber-500',   text: '신호보너스' },
  risk:       { color: 'text-red-400',     hex: '#f87171', bar: 'bg-red-500',     text: '리스크'   },
};

// ── 레이더 축 정의 (4축 only) ─────────────────────────────────────────────────
const RADAR_AXES = [
  { id: 'technical' as const, label: '기술', scoreKey: 'score_momentum' as keyof StockRankItem, angle: -90 },
  { id: 'supply'    as const, label: '수급', scoreKey: 'score_supply'   as keyof StockRankItem, angle:   0 },
  { id: 'valuation' as const, label: '가치', scoreKey: 'score_value'    as keyof StockRankItem, angle:  90 },
  { id: 'signal'    as const, label: '신호', scoreKey: 'score_signal'   as keyof StockRankItem, angle: 180 },
];

function toRad(deg: number) { return (deg * Math.PI) / 180; }

// ── 커스텀 4축 레이더 차트 (SVG) ──────────────────────────────────────────────
function ColorRadar({ data }: { data: StockRankItem }) {
  const cx = 70, cy = 65, r = 42, labelOff = 14;

  // 축별 텍스트 앵커 (위=가운데, 오른쪽=왼쪽정렬, 아래=가운데, 왼쪽=오른쪽정렬)
  const anchorMap: Record<number, string> = { [-90]: 'middle', 0: 'start', 90: 'middle', 180: 'end' };
  const baselineMap: Record<number, string> = { [-90]: 'auto', 0: 'middle', 90: 'hanging', 180: 'middle' };

  const axes = RADAR_AXES.map(ax => {
    const val = Math.min(100, Math.max(0, (data[ax.scoreKey] as number) ?? 0));
    const ang = toRad(ax.angle);
    const meta = CATEGORY_META[ax.id];
    return {
      ...ax,
      val,
      hex: meta.hex,
      px: cx + Math.cos(ang) * r * val / 100,
      py: cy + Math.sin(ang) * r * val / 100,
      tipX: cx + Math.cos(ang) * r,
      tipY: cy + Math.sin(ang) * r,
      labelX: cx + Math.cos(ang) * (r + labelOff),
      labelY: cy + Math.sin(ang) * (r + labelOff),
      anchor: anchorMap[ax.angle],
      baseline: baselineMap[ax.angle],
    };
  });

  const polygon = axes.map(a => `${a.px},${a.py}`).join(' ');
  const gridLevels = [0.25, 0.5, 0.75, 1];

  return (
    <svg width="140" height="132" viewBox="0 0 140 132">
      {/* 배경 */}
      <rect x="1" y="1" width="138" height="130" rx="8"
        fill="var(--background)" fillOpacity="0.6"
        stroke="var(--border)" strokeWidth="0.5" />

      {/* 그리드 원 */}
      {gridLevels.map(lv => (
        <circle key={lv} cx={cx} cy={cy} r={r * lv}
          fill="none" stroke="var(--border)" strokeWidth="0.5" opacity="0.6" />
      ))}

      {/* 축 선 */}
      {axes.map(a => (
        <line key={a.id} x1={cx} y1={cy} x2={a.tipX} y2={a.tipY}
          stroke="var(--border)" strokeWidth="0.5" opacity="0.6" />
      ))}

      {/* 데이터 폴리곤 */}
      <polygon points={polygon}
        fill="var(--accent)" fillOpacity="0.15"
        stroke="var(--accent)" strokeWidth="1" strokeOpacity="0.4" />

      {/* 축별 컬러 라인 (중심 → 데이터 포인트) */}
      {axes.map(a => (
        <line key={a.id + 'ln'} x1={cx} y1={cy} x2={a.px} y2={a.py}
          stroke={a.hex} strokeWidth="1.5" strokeOpacity="0.7" />
      ))}

      {/* 데이터 포인트 점 */}
      {axes.map(a => (
        <circle key={a.id + 'dot'} cx={a.px} cy={a.py} r="3.5"
          fill={a.hex} stroke="var(--card)" strokeWidth="1" />
      ))}

      {/* 레이블 */}
      {axes.map(a => (
        <text key={a.id + 'lbl'} x={a.labelX} y={a.labelY}
          textAnchor={a.anchor} dominantBaseline={a.baseline}
          fontSize="8" fontWeight="600" fill={a.hex}>
          {a.label}
        </text>
      ))}
    </svg>
  );
}

// ── 등급 유틸 ─────────────────────────────────────────────────────────────────
function getGradeStyle(score: number): { badge: string; label: string } {
  if (score >= 90) return { badge: 'bg-red-600 text-white',       label: '적극매수' };
  if (score >= 80) return { badge: 'bg-red-500 text-white',       label: '매수'     };
  if (score >= 65) return { badge: 'bg-orange-400 text-white',    label: '관심'     };
  if (score >= 50) return { badge: 'bg-yellow-400 text-gray-900', label: '보통'     };
  if (score >= 35) return { badge: 'bg-gray-400 text-white',      label: '관망'     };
  return                   { badge: 'bg-gray-600 text-gray-200',  label: '주의'     };
}

function scoreColor(v: number): string {
  if (v >= 70) return 'text-green-400';
  if (v >= 40) return 'text-yellow-400';
  return 'text-red-400';
}

// ── 평면 카테고리 블록 ────────────────────────────────────────────────────────
function CategoryBlock({ category }: { category: AnalysisCategory }) {
  const meta = CATEGORY_META[category.id];
  const pct = Math.min(100, Math.max(0, category.score));
  const passedCount = category.reasons.filter((r) => r.passed).length;
  const isRisk = category.id === 'risk';

  return (
    <div>
      {/* 카테고리 헤더 */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-xs font-semibold w-16 shrink-0 ${meta.color}`}>{meta.text}</span>
        <div className="flex-1 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
          <div className={`h-full rounded-full ${meta.bar}`} style={{ width: `${pct}%` }} />
        </div>
        <span className={`tabular-nums text-xs font-bold w-7 text-right shrink-0 ${meta.color}`}>
          {category.score}
        </span>
        <span className="text-[10px] text-[var(--muted)] w-10 text-right shrink-0">
          {passedCount}/{category.reasons.length}
        </span>
      </div>

      {/* 조건 목록 — 전체 나열 */}
      <div className="space-y-0.5 pl-1">
        {category.reasons.map((r, i) => (
          <div key={i} className={`flex items-start gap-1.5 text-xs ${r.passed ? '' : 'opacity-50'}`}>
            <span className={`shrink-0 w-3 mt-px text-center leading-none ${
              r.passed ? 'text-green-400' : isRisk ? 'text-red-400' : 'text-[var(--muted)]'
            }`}>
              {r.passed ? '✓' : isRisk ? '⚠' : '✗'}
            </span>
            <span className={`flex-1 min-w-0 leading-snug ${r.passed ? 'text-[var(--text)]' : 'text-[var(--muted)]'}`}>
              {r.label}
            </span>
            {r.value && (
              <span className="text-[var(--muted)] shrink-0 text-right tabular-nums">{r.value}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export function UnifiedScoreCard({ data, history = [] }: Props) {
  const { badge, label: gradeLabel } = getGradeStyle(data.score_total);

  const [analysisData, setAnalysisData] = useState<StockAnalysisResponse | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(true);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  useEffect(() => {
    if (!data.symbol) return;
    const controller = new AbortController();

    fetch(`/api/v1/stock-analysis?symbol=${encodeURIComponent(data.symbol)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<StockAnalysisResponse>;
      })
      .then((json) => {
        setAnalysisData(json);
        setAnalysisError(null);
        setAnalysisLoading(false);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setAnalysisError('체크리스트 데이터를 불러오지 못했습니다.');
        setAnalysisLoading(false);
      });

    return () => controller.abort();
  }, [data.symbol]);

  return (
    <div className="p-4 space-y-4">

      {/* ── 헤더: 총점 + 등급 | 레이더 | 추이 ── */}
      <div className="flex items-center justify-between">

        {/* 총점 + 등급 */}
        <div className="shrink-0 space-y-1.5">
          <div className="flex items-end gap-1">
            <span className={`text-4xl font-bold tabular-nums leading-none ${scoreColor(data.score_total)}`}>
              {Math.round(data.score_total)}
            </span>
            <span className="text-xs text-[var(--muted)] mb-0.5">/ 100</span>
          </div>
          <span className={`inline-block px-2.5 py-0.5 rounded-full text-sm font-bold ${badge}`}>
            {gradeLabel}
          </span>
          {/* 7일 추이 (점수 아래) */}
          {history.length > 1 && (
            <div className="w-[120px] pt-1">
              <span className="text-[10px] text-[var(--muted)]">7일 추이</span>
              <div className="h-[36px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
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

        {/* 레이더 (4축, 컬러) */}
        <div className="shrink-0">
          <ColorRadar data={data} />
        </div>

      </div>

      {/* ── 체크리스트 ── */}
      <div className="border-t border-[var(--border)] pt-3">
        {analysisLoading && (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="space-y-1">
                <div className="h-4 w-32 rounded bg-[var(--border)] animate-pulse" />
                <div className="h-3 rounded bg-[var(--border)] animate-pulse opacity-60" />
                <div className="h-3 w-4/5 rounded bg-[var(--border)] animate-pulse opacity-40" />
              </div>
            ))}
          </div>
        )}

        {!analysisLoading && analysisError && (
          <p className="text-xs text-[var(--muted)] py-2">{analysisError}</p>
        )}

        {!analysisLoading && analysisData && (
          <div className="space-y-3">
            {analysisData.categories.map((category) => (
              <CategoryBlock key={category.id} category={category} />
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
