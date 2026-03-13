"use client";

import { useState } from "react";

interface Group {
  id: string;
  name: string;
}

interface Props {
  symbol: string;
  name: string;                    // 종목명 (POST body에 필요)
  allGroups: Group[];              // 전체 관심그룹 목록
  memberGroupIds: string[];        // 이 종목이 속한 그룹 id 목록
  onMembershipChange: (groupIds: string[]) => void;
}

export function GroupManagementSection({
  symbol, name, allGroups, memberGroupIds, onMembershipChange,
}: Props) {
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const memberSet = new Set(memberGroupIds);

  const toggle = async (group: Group) => {
    if (pendingIds.has(group.id)) return;
    const isMember = memberSet.has(group.id);

    setPendingIds((prev) => new Set(prev).add(group.id));
    try {
      if (isMember) {
        const res = await fetch(
          `/api/v1/watchlist-groups/${group.id}/stocks/${symbol}`,
          { method: "DELETE" }
        );
        if (!res.ok) throw new Error();
        onMembershipChange(memberGroupIds.filter((id) => id !== group.id));
      } else {
        const res = await fetch(`/api/v1/watchlist-groups/${group.id}/stocks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, name }),
        });
        if (!res.ok) throw new Error();
        onMembershipChange([...memberGroupIds, group.id]);
      }
    } catch {
      alert("관심그룹 변경 중 오류가 발생했습니다.");
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(group.id);
        return next;
      });
    }
  };

  return (
    <div id="group-section" className="px-6 py-4 border-b border-[var(--border)]">
      <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wide mb-3">
        관심그룹
      </h3>
      {allGroups.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">관심그룹이 없습니다.</p>
      ) : (
        <ul className="space-y-2">
          {allGroups.map((group) => {
            const isMember = memberSet.has(group.id);
            const isPending = pendingIds.has(group.id);
            return (
              <li key={group.id}>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isMember}
                    onChange={() => toggle(group)}
                    disabled={isPending}
                    className="rounded"
                  />
                  <span className={`text-sm ${isPending ? "opacity-50" : ""}`}>
                    {group.name}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
