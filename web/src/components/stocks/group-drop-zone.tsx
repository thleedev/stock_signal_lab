"use client";

import { useDroppable } from "@dnd-kit/core";
import { Check } from "lucide-react";
import type { WatchlistGroup } from "@/types/stock";

interface GroupDropZoneProps {
  groups: WatchlistGroup[];
  draggingSymbol: string;
  symGroups: Record<string, string[]>;
}

function DroppableGroupButton({
  group,
  isAlreadyIn,
}: {
  group: WatchlistGroup;
  isAlreadyIn: boolean;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: group.id });

  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-2 px-4 py-3 rounded-xl border-2 transition-all cursor-pointer min-w-[100px] justify-center ${
        isOver
          ? "border-[var(--accent)] bg-[var(--accent)]/20 scale-105"
          : isAlreadyIn
          ? "border-[var(--accent)]/50 bg-[var(--card)]"
          : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)]/50"
      }`}
    >
      {isAlreadyIn && <Check className="w-4 h-4 text-[var(--accent)]" />}
      <span className={`text-sm font-medium ${isAlreadyIn ? "text-[var(--accent)]" : "text-[var(--foreground)]"}`}>
        {group.name}
      </span>
    </div>
  );
}

export default function GroupDropZone({ groups, draggingSymbol, symGroups }: GroupDropZoneProps) {
  const currentGroupIds = symGroups[draggingSymbol] ?? [];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up">
      <div className="bg-[var(--background)]/95 backdrop-blur border-t border-[var(--border)] px-6 py-4">
        <p className="text-xs text-[var(--muted)] mb-3 text-center">드롭하여 관심그룹에 추가</p>
        <div className="flex gap-3 justify-center flex-wrap">
          {groups.map((group) => (
            <DroppableGroupButton
              key={group.id}
              group={group}
              isAlreadyIn={currentGroupIds.includes(group.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
