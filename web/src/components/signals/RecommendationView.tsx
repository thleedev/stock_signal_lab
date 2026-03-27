'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui';
import { UnifiedAnalysisSection, type SignalMap } from './UnifiedAnalysisSection';
import ShortTermRecommendationSection from './ShortTermRecommendationSection';
import type { WatchlistGroup } from '@/types/stock';

interface Props {
  initialTab: 'analysis' | 'short-term';
  signalMap: SignalMap;
  favoriteSymbols: string[];
  watchlistSymbols: string[];
  groups: WatchlistGroup[];
  symbolGroups: Record<string, string[]>;
}

/**
 * 종목추천 ↔ 단기추천 탭을 클라이언트 상태로 전환하는 래퍼.
 * URL은 replaceState로 동기화하되 서버 재요청 없이 즉시 전환.
 */
export default function RecommendationView({
  initialTab,
  signalMap,
  favoriteSymbols,
  watchlistSymbols,
  groups,
  symbolGroups,
}: Props) {
  const [activeTab, setActiveTab] = useState(initialTab);

  const handleTabChange = (tab: 'analysis' | 'short-term') => {
    setActiveTab(tab);
    // URL을 동기화하되 서버 네비게이션은 트리거하지 않음
    window.history.replaceState(null, '', `/signals?tab=${tab}`);
  };

  const tabCls = (tab: string) =>
    `px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
      activeTab === tab
        ? 'bg-[var(--accent)] text-white'
        : 'text-[var(--muted)] hover:text-[var(--text)]'
    }`;

  return (
    <>
      <PageHeader
        title="AI 신호"
        action={
          <div className="flex items-center gap-3">
            <div className="flex gap-1 rounded-lg border border-[var(--border)] p-1 bg-[var(--card)]">
              <Link
                href="/signals"
                className="px-3 py-1.5 text-sm font-medium rounded-md transition-colors text-[var(--muted)] hover:text-[var(--text)]"
              >
                AI 신호
              </Link>
              <button onClick={() => handleTabChange('analysis')} className={tabCls('analysis')}>
                종목추천
              </button>
              <button onClick={() => handleTabChange('short-term')} className={tabCls('short-term')}>
                단기추천
              </button>
            </div>
          </div>
        }
      />

      {activeTab === 'analysis' ? (
        <UnifiedAnalysisSection
          signalMap={signalMap}
          favoriteSymbols={favoriteSymbols}
          watchlistSymbols={watchlistSymbols}
          groups={groups}
          symbolGroups={symbolGroups}
        />
      ) : (
        <ShortTermRecommendationSection
          signalMap={signalMap}
          favoriteSymbols={favoriteSymbols}
          watchlistSymbols={watchlistSymbols}
          groups={groups}
          symbolGroups={symbolGroups}
        />
      )}
    </>
  );
}
