'use client';

import Link from 'next/link';
import { PageHeader } from '@/components/ui';
import { StockAnalysisSection } from './StockAnalysisSection';
import type { WatchlistGroup } from '@/types/stock';

interface Props {
  initialDateMode?: 'today' | 'signal_all';
  favoriteSymbols: string[];
  watchlistSymbols: string[];
  groups: WatchlistGroup[];
  symbolGroups: Record<string, string[]>;
}

export default function RecommendationView({
  initialDateMode = 'today',
  favoriteSymbols,
  watchlistSymbols,
  groups,
  symbolGroups,
}: Props) {
  return (
    <>
      <PageHeader
        title="종목분석"
        action={
          <div className="flex gap-1 rounded-lg border border-[var(--border)] p-1 bg-[var(--card)]">
            <Link
              href="/signals"
              className="px-3 py-1.5 text-sm font-medium rounded-md transition-colors text-[var(--muted)] hover:text-[var(--text)]"
            >
              AI 신호
            </Link>
            <span className="px-3 py-1.5 text-sm font-medium rounded-md bg-[var(--accent)] text-white">
              종목분석
            </span>
          </div>
        }
      />

      <StockAnalysisSection
        initialDateMode={initialDateMode}
        favoriteSymbols={favoriteSymbols}
        watchlistSymbols={watchlistSymbols}
        groups={groups}
        symbolGroups={symbolGroups}
      />
    </>
  );
}
