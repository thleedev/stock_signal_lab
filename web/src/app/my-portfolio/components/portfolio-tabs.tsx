"use client";

import { useState } from "react";

interface Portfolio {
  id: number;
  name: string;
  is_default: boolean;
  sort_order: number;
}

interface Props {
  portfolios: Portfolio[];
  activeId: number | null; // null = "전체"
  onSelect: (id: number | null) => void;
  onPortfoliosChange: () => void; // 포트 목록 갱신 트리거
}

export function PortfolioTabs({ portfolios, activeId, onSelect, onPortfoliosChange }: Props) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  const handleAdd = async () => {
    const name = prompt("새 포트 이름을 입력하세요:");
    if (!name?.trim()) return;

    const res = await fetch("/api/v1/user-portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });

    if (res.ok) {
      onPortfoliosChange();
    } else {
      const err = await res.json();
      alert(err.error ?? "생성 실패");
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`"${name}" 포트를 삭제하시겠습니까?\n거래 이력은 보존됩니다.`)) return;

    const res = await fetch(`/api/v1/user-portfolio?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      if (activeId === id) onSelect(null);
      onPortfoliosChange();
    }
  };

  const handleRename = async (id: number) => {
    if (!editName.trim()) {
      setEditingId(null);
      return;
    }

    const res = await fetch("/api/v1/user-portfolio", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name: editName.trim() }),
    });

    if (res.ok) onPortfoliosChange();
    setEditingId(null);
  };

  const defaultPort = portfolios.find((p) => p.is_default);
  const userPorts = portfolios.filter((p) => !p.is_default);

  return (
    <div className="flex items-center gap-0 border-b-2 border-gray-200 bg-gray-50 px-3 overflow-x-auto">
      {/* 전체 탭 (고정) */}
      <button
        onClick={() => onSelect(null)}
        className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-[2px] transition-colors ${
          activeId === null
            ? "bg-white border-gray-800 font-bold text-gray-900"
            : "border-transparent text-gray-500 hover:text-gray-700"
        }`}
      >
        전체 📌
      </button>

      {/* 사용자 포트 탭 */}
      {userPorts.map((p) => (
        <div key={p.id} className="relative group">
          {editingId === p.id ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => handleRename(p.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename(p.id);
                if (e.key === "Escape") setEditingId(null);
              }}
              autoFocus
              className="px-3 py-2 text-sm border border-blue-400 rounded outline-none w-24"
            />
          ) : (
            <button
              onClick={() => onSelect(p.id)}
              onDoubleClick={() => {
                setEditingId(p.id);
                setEditName(p.name);
              }}
              className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-[2px] transition-colors ${
                activeId === p.id
                  ? "bg-white border-gray-800 font-bold text-gray-900"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {p.name}
            </button>
          )}
          {/* 삭제 버튼 (호버 시) */}
          {editingId !== p.id && (
            <button
              onClick={() => handleDelete(p.id, p.name)}
              className="absolute -top-1 -right-1 hidden group-hover:flex w-4 h-4 items-center justify-center bg-gray-400 text-white rounded-full text-[10px] hover:bg-red-500"
            >
              ✕
            </button>
          )}
        </div>
      ))}

      {/* + 버튼 */}
      <button
        onClick={handleAdd}
        className="px-3 py-2.5 text-gray-400 hover:text-gray-600 font-bold text-lg"
      >
        +
      </button>
    </div>
  );
}
