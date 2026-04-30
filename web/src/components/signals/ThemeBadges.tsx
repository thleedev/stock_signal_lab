'use client';

import type { ThemeTag } from '@/types/theme';

interface ThemeBadgesProps {
  theme_tags: ThemeTag[] | null;
  is_leader: boolean;
  is_hot_theme: boolean;
}

export function ThemeBadges({ theme_tags, is_leader, is_hot_theme }: ThemeBadgesProps) {
  const tags = theme_tags ?? [];
  if (tags.length === 0 && !is_leader && !is_hot_theme) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {is_leader && (
        <span className="inline-flex items-center gap-0.5 px-1 sm:px-1.5 py-0.5 rounded text-[10px] sm:text-xs font-medium bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 whitespace-nowrap">
          👑 주도주
        </span>
      )}
      {tags.map((tag) => (
        <span
          key={tag.theme_id}
          className={`inline-flex items-center gap-0.5 px-1 sm:px-1.5 py-0.5 rounded text-[10px] sm:text-xs font-medium border max-w-[10rem] sm:max-w-none ${
            tag.is_hot
              ? 'bg-red-500/20 text-red-400 border-red-500/30'
              : 'bg-blue-500/20 text-blue-400 border-blue-500/30'
          }`}
          title={`${tag.theme_name} · 테마 강도: ${tag.momentum_score.toFixed(0)}`}
        >
          <span className="truncate">🏷 {tag.theme_name}</span>
          {tag.is_hot && <span className="shrink-0">🔥</span>}
        </span>
      ))}
      {is_hot_theme && (
        <span className="inline-flex items-center gap-0.5 px-1 sm:px-1.5 py-0.5 rounded text-[10px] sm:text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 whitespace-nowrap">
          ⚠️ 과열
        </span>
      )}
    </div>
  );
}
