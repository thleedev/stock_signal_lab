"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { FolderPlus, Check, X, Tag } from "lucide-react";

interface Favorite {
  symbol: string;
  name: string;
  group_name?: string | null;
  added_at?: string;
}

interface Props {
  favorites: Favorite[];
}

export default function FavoritesManager({ favorites: initial }: Props) {
  const [favorites, setFavorites] = useState<Favorite[]>(initial);
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set());
  const [newGroup, setNewGroup] = useState("");
  const [showGroupInput, setShowGroupInput] = useState(false);
  const [assigning, setAssigning] = useState(false);

  // 그룹 목록 추출
  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const f of favorites) {
      set.add(f.group_name || "기본");
    }
    return Array.from(set).sort((a, b) => (a === "기본" ? -1 : b === "기본" ? 1 : a.localeCompare(b)));
  }, [favorites]);

  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!activeGroup) return favorites;
    return favorites.filter((f) => (f.group_name || "기본") === activeGroup);
  }, [favorites, activeGroup]);

  const toggleSelect = (symbol: string) => {
    setSelectedSymbols((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  const assignGroup = async (groupName: string) => {
    if (selectedSymbols.size === 0) return;
    setAssigning(true);
    try {
      const res = await fetch("/api/v1/favorites", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbols: Array.from(selectedSymbols),
          group_name: groupName,
        }),
      });
      if (res.ok) {
        setFavorites((prev) =>
          prev.map((f) =>
            selectedSymbols.has(f.symbol) ? { ...f, group_name: groupName } : f
          )
        );
        setSelectedSymbols(new Set());
        setShowGroupInput(false);
        setNewGroup("");
      }
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div>
      {/* 그룹 탭 */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] overflow-x-auto">
        <button
          onClick={() => setActiveGroup(null)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
            activeGroup === null
              ? "bg-[var(--accent)] text-white"
              : "bg-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
          }`}
        >
          전체 ({favorites.length})
        </button>
        {groups.map((g) => {
          const count = favorites.filter((f) => (f.group_name || "기본") === g).length;
          return (
            <button
              key={g}
              onClick={() => setActiveGroup(g)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                activeGroup === g
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {g} ({count})
            </button>
          );
        })}
      </div>

      {/* 그룹 할당 바 */}
      {selectedSymbols.size > 0 && (
        <div className="px-4 py-2 bg-[var(--accent)]/10 border-b border-[var(--border)] flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium">
            {selectedSymbols.size}개 선택
          </span>

          {/* 기존 그룹으로 이동 */}
          {groups.map((g) => (
            <button
              key={g}
              onClick={() => assignGroup(g)}
              disabled={assigning}
              className="text-xs px-2 py-1 rounded bg-[var(--card)] border border-[var(--border)] hover:bg-[var(--card-hover)] transition-colors"
            >
              <Tag className="w-3 h-3 inline mr-1" />
              {g}
            </button>
          ))}

          {/* 새 그룹 */}
          {showGroupInput ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
                placeholder="새 그룹명"
                className="text-xs px-2 py-1 rounded border border-[var(--border)] bg-[var(--background)] w-24 focus:outline-none focus:border-[var(--accent)]"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newGroup.trim()) assignGroup(newGroup.trim());
                  if (e.key === "Escape") { setShowGroupInput(false); setNewGroup(""); }
                }}
              />
              <button
                onClick={() => { if (newGroup.trim()) assignGroup(newGroup.trim()); }}
                disabled={!newGroup.trim() || assigning}
                className="p-1 text-green-400 hover:text-green-300"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { setShowGroupInput(false); setNewGroup(""); }}
                className="p-1 text-[var(--muted)] hover:text-[var(--foreground)]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowGroupInput(true)}
              className="text-xs px-2 py-1 rounded bg-[var(--card)] border border-[var(--border)] hover:bg-[var(--card-hover)] transition-colors"
            >
              <FolderPlus className="w-3 h-3 inline mr-1" />
              새 그룹
            </button>
          )}

          <button
            onClick={() => setSelectedSymbols(new Set())}
            className="ml-auto text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            선택 해제
          </button>
        </div>
      )}

      {/* 종목 목록 */}
      {filtered.length === 0 ? (
        <div className="p-8 text-center text-[var(--muted)]">
          {activeGroup ? `"${activeGroup}" 그룹에 종목이 없습니다` : "즐겨찾기 종목이 없습니다"}
        </div>
      ) : (
        <div className="divide-y divide-[var(--border)]">
          {filtered.map((fav) => (
            <div
              key={fav.symbol}
              className={`px-4 py-3 flex items-center gap-3 hover:bg-[var(--card-hover)] transition-colors ${
                selectedSymbols.has(fav.symbol) ? "bg-[var(--accent)]/5" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={selectedSymbols.has(fav.symbol)}
                onChange={() => toggleSelect(fav.symbol)}
                className="w-4 h-4 rounded border-[var(--border)] accent-[var(--accent)]"
              />
              <Link
                href={`/stock/${fav.symbol}`}
                className="flex-1 flex items-center gap-3 min-w-0"
              >
                <span className="font-medium text-sm">{fav.symbol}</span>
                {fav.name && (
                  <span className="text-sm text-[var(--muted)] truncate">{fav.name}</span>
                )}
              </Link>
              <span className="text-xs px-2 py-0.5 rounded bg-[var(--border)] text-[var(--muted)]">
                {fav.group_name || "기본"}
              </span>
              <span className="text-xs text-[var(--muted)]">
                {fav.added_at
                  ? new Date(fav.added_at).toLocaleDateString("ko-KR", {
                      timeZone: "Asia/Seoul",
                    })
                  : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
