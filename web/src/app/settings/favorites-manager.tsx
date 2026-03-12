"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Tag } from "lucide-react";
import type { WatchlistGroup } from "@/types/stock";

interface Favorite { symbol: string; name: string; added_at?: string; }

interface Props {
  favorites: Favorite[];
  groups: WatchlistGroup[];
  symbolGroupIds: Record<string, string[]>; // symbol → group_id[]
}

export default function FavoritesManager({ favorites: initial, groups: initialGroups, symbolGroupIds: initialSymGrps }: Props) {
  const [favorites] = useState<Favorite[]>(initial);
  const [groups] = useState<WatchlistGroup[]>(initialGroups);
  const [symbolGroupIds, setSymbolGroupIds] = useState<Record<string, string[]>>(initialSymGrps);
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set());
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null); // null = 전체
  const [assigning, setAssigning] = useState(false);

  const filtered = useMemo(() => {
    if (!activeGroupId) return favorites;
    return favorites.filter((f) => (symbolGroupIds[f.symbol] ?? []).includes(activeGroupId));
  }, [favorites, activeGroupId, symbolGroupIds]);

  const toggleSelect = (symbol: string) => {
    setSelectedSymbols((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  // 그룹 이동 (배타적): 대상 그룹에 먼저 추가 → 그 다음 다른 그룹에서 제거
  // NOTE: POST-first 순서로 favorite_stocks orphan 상태 방지
  const assignGroup = async (targetGroupId: string) => {
    if (selectedSymbols.size === 0) return;
    setAssigning(true);
    try {
      for (const sym of selectedSymbols) {
        const fav = favorites.find((f) => f.symbol === sym);
        if (!fav) continue;
        // 1. 대상 그룹에 먼저 추가 (이미 있으면 409 무시)
        await fetch(`/api/v1/watchlist-groups/${targetGroupId}/stocks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: sym, name: fav.name }),
        });
        // 2. 대상 그룹이 아닌 기존 그룹들에서 제거
        const currentGroupIds = symbolGroupIds[sym] ?? [];
        const otherGroupIds = currentGroupIds.filter((gid) => gid !== targetGroupId);
        await Promise.all(
          otherGroupIds.map((gid) =>
            fetch(`/api/v1/watchlist-groups/${gid}/stocks/${sym}`, { method: "DELETE" })
          )
        );
      }
      setSymbolGroupIds((prev) => {
        const next = { ...prev };
        for (const sym of selectedSymbols) next[sym] = [targetGroupId];
        return next;
      });
      setSelectedSymbols(new Set());
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 그룹 탭 필터 */}
      <div className="flex gap-1 flex-wrap px-4 pt-4">
        <button
          onClick={() => setActiveGroupId(null)}
          className={`px-3 py-1.5 rounded-lg text-sm ${!activeGroupId ? "bg-[#6366f1] text-white" : "text-[var(--muted)] hover:bg-[var(--card-hover)]"}`}
        >
          전체 ({favorites.length})
        </button>
        {groups.map((g) => {
          const count = favorites.filter((f) => (symbolGroupIds[f.symbol] ?? []).includes(g.id)).length;
          return (
            <button key={g.id} onClick={() => setActiveGroupId(g.id)}
              className={`px-3 py-1.5 rounded-lg text-sm ${activeGroupId === g.id ? "bg-[#6366f1] text-white" : "text-[var(--muted)] hover:bg-[var(--card-hover)]"}`}
            >
              {g.name} ({count})
            </button>
          );
        })}
      </div>

      {/* 선택 종목 그룹 이동 */}
      {selectedSymbols.size > 0 && (
        <div className="flex items-center gap-2 mx-4 p-3 bg-[var(--card)] border border-[var(--border)] rounded-lg flex-wrap">
          <Tag className="w-4 h-4 text-[var(--muted)]" />
          <span className="text-sm text-[var(--muted)]">{selectedSymbols.size}개 선택 → 이동:</span>
          {groups.map((g) => (
            <button key={g.id} onClick={() => assignGroup(g.id)} disabled={assigning}
              className="px-2 py-1 text-xs rounded bg-[var(--border)] hover:bg-[var(--accent)] hover:text-white transition-colors disabled:opacity-50"
            >
              {g.name}
            </button>
          ))}
          <button
            onClick={() => setSelectedSymbols(new Set())}
            className="ml-auto text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            선택 해제
          </button>
        </div>
      )}

      {/* 종목 리스트 */}
      <div className="divide-y divide-[var(--border)]">
        {filtered.map((fav) => {
          const groupNames = (symbolGroupIds[fav.symbol] ?? [])
            .map((gid) => groups.find((g) => g.id === gid)?.name)
            .filter(Boolean).join(", ");
          return (
            <div key={fav.symbol}
              className={`px-4 py-3 flex items-center gap-3 hover:bg-[var(--card-hover)] transition-colors ${
                selectedSymbols.has(fav.symbol) ? "bg-[var(--accent)]/5" : ""
              }`}
            >
              <input type="checkbox" checked={selectedSymbols.has(fav.symbol)}
                onChange={() => toggleSelect(fav.symbol)}
                className="w-4 h-4 accent-[#6366f1]"
              />
              <Link href={`/stock/${fav.symbol}`} className="flex-1 flex items-center gap-3 min-w-0 hover:text-[var(--accent)]">
                <span className="font-medium text-sm">{fav.symbol}</span>
                {fav.name && <span className="text-sm text-[var(--muted)] truncate">{fav.name}</span>}
              </Link>
              {groupNames && (
                <span className="text-xs px-2 py-0.5 rounded bg-[var(--border)] text-[var(--muted)]">{groupNames}</span>
              )}
              <span className="text-xs text-[var(--muted)]">
                {fav.added_at ? new Date(fav.added_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }) : ""}
              </span>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-8 text-[var(--muted)] text-sm">관심종목이 없습니다.</div>
        )}
      </div>

    </div>
  );
}
