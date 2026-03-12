"use client";

import { useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface Portfolio {
  id: number;
  name: string;
  is_default: boolean;
  sort_order: number;
}

interface Props {
  portfolios: Portfolio[];
  activeId: number | null;
  onSelect: (id: number | null) => void;
  onPortfoliosChange: () => void;
  onMoveStock?: (tradeId: number, toPortfolioId: number) => void;
}

/* ── 정렬 가능한 탭 (+ 종목 드롭 대상) ── */
function SortableTab({
  portfolio,
  isActive,
  isEditing,
  editName,
  onSelect,
  onStartEdit,
  onEditChange,
  onEditSubmit,
  onEditCancel,
  onDelete,
  onStockDrop,
}: {
  portfolio: Portfolio;
  isActive: boolean;
  isEditing: boolean;
  editName: string;
  onSelect: () => void;
  onStartEdit: () => void;
  onEditChange: (v: string) => void;
  onEditSubmit: () => void;
  onEditCancel: () => void;
  onDelete: () => void;
  onStockDrop?: (tradeId: number) => void;
}) {
  const [isStockOver, setIsStockOver] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: portfolio.id, disabled: isEditing });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  // 네이티브 HTML5 드롭 (종목 행 → 탭)
  const handleNativeDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("text/trade-id")) {
      e.preventDefault();
      setIsStockOver(true);
    }
  };
  const handleNativeDragLeave = () => setIsStockOver(false);
  const handleNativeDrop = (e: React.DragEvent) => {
    setIsStockOver(false);
    const tradeId = parseInt(e.dataTransfer.getData("text/trade-id"), 10);
    if (tradeId && onStockDrop) onStockDrop(tradeId);
  };

  if (isEditing) {
    return (
      <div ref={setNodeRef} style={style}>
        <input
          type="text"
          value={editName}
          onChange={(e) => onEditChange(e.target.value)}
          onBlur={onEditSubmit}
          onKeyDown={(e) => {
            if (e.key === "Enter") onEditSubmit();
            if (e.key === "Escape") onEditCancel();
          }}
          autoFocus
          className="px-3 py-2 text-sm border border-[var(--accent)] rounded bg-[var(--background)] text-[var(--foreground)] outline-none w-24"
        />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative group ${isStockOver ? "ring-2 ring-[var(--accent)] rounded" : ""}`}
      onDragOver={handleNativeDragOver}
      onDragLeave={handleNativeDragLeave}
      onDrop={handleNativeDrop}
    >
      <button
        {...attributes}
        {...listeners}
        onClick={onSelect}
        onDoubleClick={onStartEdit}
        className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-[1px] transition-colors cursor-grab active:cursor-grabbing ${
          isActive
            ? "border-[var(--accent)] font-bold text-[var(--foreground)]"
            : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"
        }`}
      >
        {portfolio.name}
      </button>
      <button
        onClick={onDelete}
        className="absolute -top-1 -right-1 hidden group-hover:flex w-4 h-4 items-center justify-center bg-[var(--border)] text-[var(--muted)] rounded-full text-[10px] hover:bg-red-500 hover:text-white"
      >
        ✕
      </button>
    </div>
  );
}

/* ── 메인 컴포넌트 ── */
export function PortfolioTabs({ portfolios, activeId, onSelect, onPortfoliosChange, onMoveStock }: Props) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const userPorts = portfolios.filter((p) => !p.is_default);
  const userPortIds = userPorts.map((p) => p.id);

  const handleAdd = async () => {
    if (!newName.trim()) {
      setAddingNew(false);
      setNewName("");
      return;
    }
    const res = await fetch("/api/v1/user-portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (res.ok) {
      onPortfoliosChange();
    } else {
      const err = await res.json();
      alert(err.error ?? "생성 실패");
    }
    setAddingNew(false);
    setNewName("");
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

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = userPorts.findIndex((p) => p.id === active.id);
    const newIndex = userPorts.findIndex((p) => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(userPorts, oldIndex, newIndex);
    const orders = reordered.map((p, i) => ({ id: p.id, sort_order: i + 1 }));

    // optimistic → API → refresh
    onPortfoliosChange();
    await fetch("/api/v1/user-portfolio", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders }),
    });
    onPortfoliosChange();
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="flex items-center gap-0 border-b border-[var(--border)] bg-[var(--card)] px-3 overflow-x-auto">
        {/* 전체 탭 (고정, 정렬/드롭 불가) */}
        <button
          onClick={() => onSelect(null)}
          className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-[1px] transition-colors ${
            activeId === null
              ? "border-[var(--accent)] font-bold text-[var(--foreground)]"
              : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"
          }`}
        >
          전체
        </button>

        {/* 사용자 포트 탭 */}
        <SortableContext items={userPortIds} strategy={horizontalListSortingStrategy}>
          {userPorts.map((p) => (
            <SortableTab
              key={p.id}
              portfolio={p}
              isActive={activeId === p.id}
              isEditing={editingId === p.id}
              editName={editName}
              onSelect={() => onSelect(p.id)}
              onStartEdit={() => {
                setEditingId(p.id);
                setEditName(p.name);
              }}
              onEditChange={setEditName}
              onEditSubmit={() => handleRename(p.id)}
              onEditCancel={() => setEditingId(null)}
              onDelete={() => handleDelete(p.id, p.name)}
              onStockDrop={(tradeId) => onMoveStock?.(tradeId, p.id)}
            />
          ))}
        </SortableContext>

        {/* + 버튼 / 인라인 입력 */}
        {addingNew ? (
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={() => handleAdd()}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
              if (e.key === "Escape") { setAddingNew(false); setNewName(""); }
            }}
            autoFocus
            placeholder="포트 이름"
            className="px-3 py-2 text-sm border border-[var(--accent)] rounded bg-[var(--background)] text-[var(--foreground)] outline-none w-24"
          />
        ) : (
          <button
            onClick={() => setAddingNew(true)}
            className="px-3 py-2.5 text-[var(--muted)] hover:text-[var(--accent)] font-bold text-lg"
          >
            +
          </button>
        )}
      </div>
    </DndContext>
  );
}
