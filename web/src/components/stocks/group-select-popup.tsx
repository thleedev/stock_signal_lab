"use client";

import { useRef, useEffect } from "react";
import { Check } from "lucide-react";
import type { WatchlistGroup } from "@/types/stock";

interface Props {
  groups: WatchlistGroup[];
  selectedGroupIds: Set<string>;      // 현재 이 종목이 속한 그룹 ids
  onToggle: (group: WatchlistGroup) => void;
  onClose: () => void;
  position: { x: number; y: number };
}

export default function GroupSelectPopup({
  groups,
  selectedGroupIds,
  onToggle,
  onClose,
  position,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{ position: "fixed", left: position.x, top: position.y, zIndex: 9999 }}
      className="bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl min-w-[160px] overflow-hidden"
    >
      <div className="px-3 py-2 border-b border-[var(--border)] text-xs text-[var(--muted)] font-medium">
        관심그룹 선택
      </div>
      <div className="py-1">
        {groups.map((group) => {
          const checked = selectedGroupIds.has(group.id);
          return (
            <button
              key={group.id}
              onClick={() => onToggle(group)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--card-hover)] transition-colors text-left"
            >
              <span className={`w-4 h-4 rounded border flex items-center justify-center ${
                checked ? "bg-[#6366f1] border-[#6366f1]" : "border-[var(--border)]"
              }`}>
                {checked && <Check className="w-3 h-3 text-white" />}
              </span>
              <span>{group.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
