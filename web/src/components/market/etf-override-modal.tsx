"use client";

import { useState, useMemo } from "react";
import { X, RotateCcw, Pencil, Check } from "lucide-react";
import {
  type ClassifiedEtf, type EtfOverrides, type EtfSide,
} from "@/lib/etf-sentiment";

interface Props {
  rawEtfs: ClassifiedEtf[];
  overrides: EtfOverrides;
  onSave: (overrides: EtfOverrides) => void;
  onClose: () => void;
}

/**
 * ETF 섹터 매핑 관리 모달
 * - 섹터명 인라인 변경 (Pencil 아이콘 클릭)
 * - ETF 포함/제외 토글 (체크박스)
 * - 강세/약세 방향 변경 (select)
 * - ETF 섹터 재배정 (select)
 * - 전체 초기화 버튼
 */
export function EtfOverrideModal({ rawEtfs, overrides: initial, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<EtfOverrides>({ ...initial });
  const [editingSector, setEditingSector] = useState<string | null>(null);
  const [sectorDraft, setSectorDraft] = useState("");

  /** 오버라이드 + 섹터 리네임 적용 후 섹터별 그룹핑 */
  const grouped = useMemo(() => {
    const map = new Map<string, ClassifiedEtf[]>();
    const renames = (draft as Record<string, unknown>).__sectorRenames as Record<string, string> | undefined;
    for (const etf of rawEtfs) {
      let sector = (draft[etf.name] as { sector?: string })?.sector ?? etf.sector;
      if (renames?.[sector]) sector = renames[sector];
      const list = map.get(sector) ?? [];
      list.push(etf);
      map.set(sector, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rawEtfs, draft]);

  /** 섹터 재배정 드롭다운용 전체 섹터 목록 */
  const allSectors = useMemo(() => {
    const set = new Set<string>();
    for (const [sector] of grouped) set.add(sector);
    return [...set].sort();
  }, [grouped]);

  /** ETF 단건 오버라이드 업데이트 */
  function updateEtf(name: string, patch: Partial<{ sector?: string; side?: EtfSide; excluded?: boolean }>) {
    setDraft((prev) => ({
      ...prev,
      [name]: { ...(prev[name] as object), ...patch },
    }));
  }

  /** 섹터 리네임 편집 시작 */
  function startRenameSector(sector: string) {
    setEditingSector(sector);
    setSectorDraft(sector);
  }

  /** 섹터 리네임 확정 */
  function confirmRenameSector(oldName: string) {
    if (sectorDraft && sectorDraft !== oldName) {
      const renames = ((draft as Record<string, unknown>).__sectorRenames as Record<string, string>) ?? {};
      setDraft((prev) => ({
        ...prev,
        __sectorRenames: { ...renames, [oldName]: sectorDraft },
      }));
    }
    setEditingSector(null);
  }

  /** 모든 오버라이드 초기화 */
  function handleReset() {
    setDraft({});
  }

  /** 빈 값 정리 후 저장 */
  function handleSave() {
    const cleaned: EtfOverrides = {};
    for (const [key, val] of Object.entries(draft)) {
      if (key === '__sectorRenames') {
        const renames = val as Record<string, string>;
        if (Object.keys(renames).length > 0) cleaned.__sectorRenames = renames;
        continue;
      }
      const o = val as { sector?: string; side?: EtfSide; excluded?: boolean };
      if (o?.sector || o?.side || o?.excluded) cleaned[key] = o;
    }
    onSave(cleaned);
    onClose();
  }

  /** 오버라이드가 하나라도 존재하는지 확인 (초기화 버튼 표시 여부) */
  const hasOverrides = Object.keys(draft).some((k) => {
    if (k === '__sectorRenames') {
      const r = (draft as Record<string, unknown>).__sectorRenames as Record<string, string> | undefined;
      return r && Object.keys(r).length > 0;
    }
    return draft[k];
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-[var(--card)] border border-[var(--border)] rounded-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-lg font-semibold">섹터 매핑 관리</h3>
          <div className="flex items-center gap-2">
            {hasOverrides && (
              <button
                onClick={handleReset}
                className="text-xs px-2 py-1 rounded bg-[var(--card-hover)] hover:bg-[var(--border)] flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" /> 초기화
              </button>
            )}
            <button onClick={onClose} className="p-1 hover:bg-[var(--card-hover)] rounded">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 본문: 섹터별 ETF 목록 */}
        <div className="overflow-y-auto flex-1 px-5 py-3">
          {grouped.map(([sector, etfs]) => (
            <div key={sector} className="mb-4">
              {/* 섹터 헤더 (group 클래스: hover 시 Pencil 아이콘 표시) */}
              <div className="flex items-center gap-2 mb-2 group">
                {editingSector === sector ? (
                  <>
                    <input
                      value={sectorDraft}
                      onChange={(e) => setSectorDraft(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && confirmRenameSector(sector)}
                      className="text-sm font-semibold bg-[var(--card)] border border-blue-500 rounded px-2 py-0.5 w-32"
                      autoFocus
                    />
                    <button onClick={() => confirmRenameSector(sector)} className="p-0.5 hover:bg-[var(--card-hover)] rounded">
                      <Check className="w-3.5 h-3.5 text-blue-400" />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-semibold text-[var(--muted)]">{sector}</span>
                    <button
                      onClick={() => startRenameSector(sector)}
                      className="p-0.5 hover:bg-[var(--card-hover)] rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Pencil className="w-3 h-3 text-[var(--muted)]" />
                    </button>
                  </>
                )}
              </div>

              {/* ETF 행 목록 */}
              <div className="space-y-1">
                {etfs.map((etf) => {
                  const o = draft[etf.name] as { sector?: string; side?: EtfSide; excluded?: boolean } | undefined;
                  const isExcluded = o?.excluded ?? false;
                  const currentSide = o?.side ?? etf.side;
                  const isOverridden = o?.sector || o?.side || o?.excluded;

                  return (
                    <div
                      key={etf.name}
                      className={`flex items-center gap-2 text-sm py-2 px-3 rounded ${
                        isOverridden ? 'bg-blue-900/10 border border-blue-800/30' : 'bg-[var(--card-hover)]'
                      } ${isExcluded ? 'opacity-50' : ''}`}
                    >
                      {/* 포함/제외 체크박스 */}
                      <input
                        type="checkbox"
                        checked={!isExcluded}
                        onChange={(e) => updateEtf(etf.name, { excluded: !e.target.checked })}
                        className="accent-blue-500"
                      />
                      {/* ETF 이름 */}
                      <span className="flex-1 truncate">{etf.name}</span>
                      {/* ETF 유형 레이블 */}
                      <span className="text-xs text-[var(--muted)] w-14">
                        {etf.type === 'leverage' ? '레버리지' : etf.type === 'inverse' ? '인버스' : '일반'}
                      </span>
                      {/* 강세/약세 방향 변경 */}
                      <select
                        value={currentSide}
                        onChange={(e) => updateEtf(etf.name, { side: e.target.value as EtfSide })}
                        className="text-xs bg-[var(--card)] border border-[var(--border)] rounded px-1 py-0.5"
                      >
                        <option value="bull">강세</option>
                        <option value="bear">약세</option>
                      </select>
                      {/* 섹터 재배정 */}
                      <select
                        value={o?.sector ?? etf.sector}
                        onChange={(e) =>
                          updateEtf(etf.name, { sector: e.target.value === etf.sector ? undefined : e.target.value })
                        }
                        className="text-xs bg-[var(--card)] border border-[var(--border)] rounded px-1 py-0.5 w-24"
                      >
                        {allSectors.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* 푸터 */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--border)]">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg hover:bg-[var(--card-hover)]">취소</button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
