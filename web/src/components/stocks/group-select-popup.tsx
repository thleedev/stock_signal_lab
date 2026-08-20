"use client";

import { useRef, useEffect, useLayoutEffect, useState } from "react";
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
  const [clamped, setClamped] = useState<{ left: number; top: number } | null>(null);

  // 팝업을 실제 크기로 재서 화면 안으로 밀어 넣습니다. ★ 를 화면 오른쪽·아래쪽에서
  // 누르면 그대로는 목록이 화면 밖으로 나갑니다.
  useLayoutEffect(() => {
    if (!ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    const margin = 8;
    setClamped({
      left: Math.max(margin, Math.min(position.x, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(position.y, window.innerHeight - height - margin)),
    });
  }, [position, groups.length]);

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
      style={{
        position: "fixed",
        left: clamped?.left ?? position.x,
        top: clamped?.top ?? position.y,
        maxHeight: "calc(100dvh - 16px)",
        zIndex: 9999,
      }}
      className="bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl min-w-[160px] overflow-y-auto overscroll-contain"
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
              className="w-full flex items-center gap-2 h-11 sm:h-auto px-3 sm:py-2 text-sm hover:bg-[var(--card-hover)] transition-colors text-left"
            >
              <span className={`w-4 h-4 rounded border flex items-center justify-center ${
                checked ? "bg-[var(--accent)] border-[var(--accent)]" : "border-[var(--border)]"
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
