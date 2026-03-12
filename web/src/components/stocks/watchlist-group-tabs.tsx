"use client";

import { useState, useRef } from "react";
import { Plus, X } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { WatchlistGroup } from "@/types/stock";

export type TabId = "all" | string; // "all" = [전체], string = group.id

interface Props {
  groups: WatchlistGroup[];           // 기본 그룹 포함 전체 목록 (sort_order 순)
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  onGroupAdd: (name: string) => Promise<void>;
  onGroupDelete: (group: WatchlistGroup) => void;
  onGroupsReorder: (ids: string[]) => void; // 커스텀 그룹 id 배열 (순서)
  onGroupRename: (group: WatchlistGroup, newName: string) => Promise<void>; // 신규
}

function SortableTab({
  group,
  isActive,
  onSelect,
  onDelete,
  onRename,
}: {
  group: WatchlistGroup;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (newName: string) => Promise<void>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: group.id });
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(group.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  async function handleRenameConfirm() {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === group.name) {
      setIsEditing(false);
      setEditName(group.name);
      return;
    }
    try {
      await onRename(trimmed);
      setIsEditing(false);
    } catch {
      setEditName(group.name);
      setIsEditing(false);
    }
  }

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-1">
      {isEditing ? (
        <input
          ref={inputRef}
          autoFocus
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRenameConfirm();
            if (e.key === "Escape") { setIsEditing(false); setEditName(group.name); }
          }}
          onBlur={handleRenameConfirm}
          className="w-24 px-2 py-1 text-sm bg-[var(--card)] border border-[#6366f1] rounded-lg outline-none"
        />
      ) : (
        <button
          {...attributes}
          {...listeners}
          onClick={onSelect}
          onDoubleClick={(e) => {
            if (group.is_default) return;
            e.stopPropagation();
            setIsEditing(true);
            setEditName(group.name);
          }}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
            isActive
              ? "bg-[#6366f1] text-white"
              : "text-[var(--muted)] hover:bg-[var(--card-hover)] hover:text-[var(--foreground)]"
          }`}
        >
          {group.name}
        </button>
      )}
      {!group.is_default && (
        <button
          onClick={onDelete}
          className="p-0.5 rounded hover:bg-red-900/40 text-[var(--muted)] hover:text-red-400 transition-colors"
          title="그룹 삭제"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

export default function WatchlistGroupTabs({
  groups,
  activeTab,
  onTabChange,
  onGroupAdd,
  onGroupDelete,
  onGroupsReorder,
  onGroupRename,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const defaultGroup = groups.find((g) => g.is_default);
  const customGroups = groups.filter((g) => !g.is_default);
  const canAdd = groups.length < 20;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = customGroups.findIndex((g) => g.id === active.id);
    const newIndex = customGroups.findIndex((g) => g.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(customGroups, oldIndex, newIndex);
    onGroupsReorder(reordered.map((g) => g.id));
  }

  async function handleAddConfirm() {
    const name = newName.trim();
    if (!name) {
      setAdding(false);
      setNewName("");
      return;
    }
    setAddError("");
    try {
      await onGroupAdd(name);
      setAdding(false);
      setNewName("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "그룹 생성 실패";
      setAddError(msg);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {/* [전체] 탭 — 고정 */}
      <button
        onClick={() => onTabChange("all")}
        className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
          activeTab === "all"
            ? "bg-[#6366f1] text-white"
            : "text-[var(--muted)] hover:bg-[var(--card-hover)] hover:text-[var(--foreground)]"
        }`}
      >
        전체
      </button>

      {/* [기본] 탭 — 고정 */}
      {defaultGroup && (
        <button
          onClick={() => onTabChange(defaultGroup.id)}
          className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
            activeTab === defaultGroup.id
              ? "bg-[#6366f1] text-white"
              : "text-[var(--muted)] hover:bg-[var(--card-hover)] hover:text-[var(--foreground)]"
          }`}
        >
          {defaultGroup.name}
        </button>
      )}

      {/* 커스텀 탭 — 드래그 가능 */}
      <DndContext id="tabs-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={customGroups.map((g) => g.id)} strategy={horizontalListSortingStrategy}>
          {customGroups.map((group) => (
            <SortableTab
              key={group.id}
              group={group}
              isActive={activeTab === group.id}
              onSelect={() => onTabChange(group.id)}
              onDelete={() => onGroupDelete(group)}
              onRename={(newName) => onGroupRename(group, newName)}
            />
          ))}
        </SortableContext>
      </DndContext>

      {/* [+] 버튼 또는 인라인 입력 */}
      {canAdd && (
        adding ? (
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddConfirm();
                if (e.key === "Escape") { setAdding(false); setNewName(""); setAddError(""); }
              }}
              onBlur={handleAddConfirm}
              placeholder="그룹명"
              className="w-24 px-2 py-1 text-sm bg-[var(--card)] border border-[var(--border)] rounded-lg outline-none focus:border-[#6366f1]"
            />
            {addError && <span className="text-xs text-red-400">{addError}</span>}
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="p-1.5 rounded-lg text-[var(--muted)] hover:bg-[var(--card-hover)] hover:text-[var(--foreground)] transition-colors"
            title="그룹 추가"
          >
            <Plus className="w-4 h-4" />
          </button>
        )
      )}
    </div>
  );
}
