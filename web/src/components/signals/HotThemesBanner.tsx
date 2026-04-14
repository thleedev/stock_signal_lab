'use client';

import { useEffect, useState } from 'react';

interface HotTheme {
  theme_id: string;
  theme_name: string;
  avg_change_pct: number | null;
  momentum_score: number | null;
  is_hot: boolean;
}

export function HotThemesBanner() {
  const [themes, setThemes] = useState<HotTheme[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/hot-themes')
      .then((r) => r.json())
      .then((data) => setThemes(data.themes ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (themes.length === 0) return null;

  return (
    <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-4 py-2.5 mb-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-orange-400 whitespace-nowrap">
          🔥 오늘의 핫 테마
        </span>
        <div className="flex gap-3 flex-wrap">
          {themes.slice(0, 5).map((t, i) => {
            const pct = t.avg_change_pct ?? 0;
            const isPos = pct >= 0;
            return (
              <span key={t.theme_id} className="text-sm whitespace-nowrap">
                <span className="text-zinc-400">{i + 1}위</span>{' '}
                <span className="text-zinc-200">{t.theme_name}</span>{' '}
                <span className={isPos ? 'text-red-400' : 'text-blue-400'}>
                  {isPos ? '+' : ''}{pct.toFixed(2)}%
                </span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
