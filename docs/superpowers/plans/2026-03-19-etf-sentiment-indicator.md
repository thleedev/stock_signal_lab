# ETF 신호 기반 시장 센티먼트 지표 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 투자시황 페이지에 ETF 매수/매도 신호 기반 섹터별 센티먼트 지표를 추가한다.

**Architecture:** 라씨매매 신호에서 ETF를 자동 분류(레버리지/인버스/일반)하고, 섹터별로 그룹화하여 시가총액 가중 정규화된 센티먼트를 계산한다. 서버 API에서 원본 데이터를 계산하고, 클라이언트에서 localStorage 오버라이드를 적용한다.

**Tech Stack:** Next.js App Router, Supabase, TypeScript, localStorage

**Spec:** `docs/superpowers/specs/2026-03-19-etf-sentiment-indicator-design.md`

---

## 파일 구조

| 파일 | 역할 |
|------|------|
| `web/src/lib/etf-sentiment.ts` | ETF 분류, 정규화, 센티먼트 계산 (순수 함수) |
| `web/src/app/api/v1/market-indicators/etf-sentiment/route.ts` | API 엔드포인트 |
| `web/src/components/market/etf-sentiment-section.tsx` | 센티먼트 섹션 UI + 오버라이드 적용 |
| `web/src/components/market/etf-override-modal.tsx` | 섹터 매핑 관리 모달 |
| `web/src/components/market/market-client.tsx` | 기존 페이지에 섹션 통합 (수정) |
| `web/src/app/market/page.tsx` | 서버 컴포넌트에 etf-sentiment fetch 추가 (수정) |

---

### Task 1: ETF 분류 및 센티먼트 계산 로직

**Files:**
- Create: `web/src/lib/etf-sentiment.ts`

- [ ] **Step 1: ETF 브랜드/유형/섹터 분류 함수 작성**

```typescript
// web/src/lib/etf-sentiment.ts

// ─── ETF 브랜드 키워드 ───
const ETF_BRANDS = [
  'KODEX', 'TIGER', 'KBSTAR', 'ARIRANG', 'SOL',
  'HANARO', 'ACE', 'KOSEF', 'PLUS',
] as const;

export type EtfType = 'leverage' | 'inverse' | 'normal';
export type EtfSide = 'bull' | 'bear';
export type SentimentLabel =
  | 'strong_positive' | 'positive' | 'caution'
  | 'negative' | 'strong_negative' | 'neutral';

export interface ClassifiedEtf {
  name: string;
  symbol: string | null;
  brand: string;
  type: EtfType;
  typeWeight: number;  // 1 or 2
  side: EtfSide;
  sector: string;
  held: boolean;
  marketCap: number | null;
  lastSignalDate: string;
  lastSignalType: string;
}

export interface SectorSentiment {
  label: string;
  bullScore: number;
  bearScore: number;
  netSentiment: number;
  sentiment: SentimentLabel;
  hasActivePositions: boolean;
  etfs: EtfSignalInfo[];
}

export interface EtfSignalInfo {
  name: string;
  symbol: string | null;
  type: EtfType;
  weight: number;       // typeWeight
  finalWeight: number;  // typeWeight × ratio
  side: EtfSide;
  held: boolean;
  marketCap: number | null;
  lastSignalDate: string;
  lastSignalType: string;
}

/** 종목명이 ETF인지 판별 */
export function isEtf(name: string): boolean {
  return ETF_BRANDS.some((b) => name.includes(b));
}

/** ETF 유형 감지 */
export function classifyEtfType(name: string): { type: EtfType; side: EtfSide; typeWeight: number } {
  const hasInverse = /인버스|곰/.test(name);
  const hasLeverage = /레버리지|2X/i.test(name);

  if (hasInverse) return { type: 'inverse', side: 'bear', typeWeight: 2 };
  if (hasLeverage) return { type: 'leverage', side: 'bull', typeWeight: 2 };
  return { type: 'normal', side: 'bull', typeWeight: 1 };
}

/** 섹터 추출: 브랜드 + 유형 키워드 제거 후 남는 부분 */
export function extractSector(name: string): string {
  let sector = name;

  // 브랜드 제거
  for (const brand of ETF_BRANDS) {
    sector = sector.replace(brand, '');
  }

  // 유형 키워드 제거
  sector = sector
    .replace(/인버스2X/gi, '')
    .replace(/인버스/g, '')
    .replace(/레버리지/g, '')
    .replace(/2X/gi, '')
    .replace(/곰/g, '')
    .trim();

  // 특수 매핑: 200 → KOSPI, 150 → KOSDAQ
  if (!sector || sector === '200' || /^200\b/.test(sector)) return 'KOSPI';
  if (sector === '150' || /코스닥150/.test(sector) || /^150\b/.test(sector)) return 'KOSDAQ';

  return sector;
}
```

- [ ] **Step 2: 시가총액 비율 정규화 함수 작성**

같은 파일에 추가:

```typescript
interface RatioInput {
  name: string;
  marketCap: number | null;
}

/**
 * 진영 내 ETF들의 비율을 합 1.0으로 정규화
 * - 모두 시총 있음: 시총 비율
 * - 혼재: 시총 없는 ETF = 0.1, 나머지를 시총 비율로 배분
 * - 모두 시총 없음: 균등 분배
 */
export function calculateRatios(etfs: RatioInput[]): Map<string, number> {
  const result = new Map<string, number>();
  if (etfs.length === 0) return result;

  const withCap = etfs.filter((e) => e.marketCap != null && e.marketCap > 0);
  const withoutCap = etfs.filter((e) => e.marketCap == null || e.marketCap <= 0);

  // 모두 시총 없음
  if (withCap.length === 0) {
    const ratio = 1.0 / etfs.length;
    for (const e of etfs) result.set(e.name, ratio);
    return result;
  }

  // 시총 없는 ETF 비율 할당
  const unknownRatio = 0.1;
  const totalUnknownRatio = unknownRatio * withoutCap.length;
  let ratioPool = 1.0 - totalUnknownRatio;

  // 비율풀이 0 이하면 균등 분배
  if (ratioPool <= 0) {
    const ratio = 1.0 / etfs.length;
    for (const e of etfs) result.set(e.name, ratio);
    return result;
  }

  // 시총 없는 ETF
  for (const e of withoutCap) result.set(e.name, unknownRatio);

  // 시총 있는 ETF: 비율풀을 시총 비율로 배분
  const totalCap = withCap.reduce((sum, e) => sum + (e.marketCap ?? 0), 0);
  for (const e of withCap) {
    result.set(e.name, ratioPool * ((e.marketCap ?? 0) / totalCap));
  }

  return result;
}
```

- [ ] **Step 3: 섹터별 센티먼트 계산 함수 작성**

같은 파일에 추가:

```typescript
export interface EtfSentimentResult {
  sectors: Record<string, SectorSentiment>;
  overallSentiment: number;
  overallLabel: SentimentLabel;
}

function getSentimentLabel(net: number, hasActive: boolean): SentimentLabel {
  if (!hasActive) return 'neutral';
  if (net >= 1.0) return 'strong_positive';
  if (net > 0) return 'positive';
  if (net <= -1.0) return 'strong_negative';
  if (net < 0) return 'negative';
  return 'caution'; // net === 0 but hasActive
}

export function getOverallSentimentLabel(value: number, hasAnySector: boolean): SentimentLabel {
  if (!hasAnySector) return 'neutral';
  return getSentimentLabel(value, true);
}

/**
 * 분류된 ETF 배열로부터 섹터별 센티먼트를 계산
 */
export function calculateSectorSentiments(
  etfs: ClassifiedEtf[]
): EtfSentimentResult {
  // 섹터별 그룹화
  const sectorMap = new Map<string, ClassifiedEtf[]>();
  for (const etf of etfs) {
    const list = sectorMap.get(etf.sector) ?? [];
    list.push(etf);
    sectorMap.set(etf.sector, list);
  }

  const sectors: Record<string, SectorSentiment> = {};

  for (const [sector, sectorEtfs] of sectorMap) {
    // 진영별 분리
    const bulls = sectorEtfs.filter((e) => e.side === 'bull');
    const bears = sectorEtfs.filter((e) => e.side === 'bear');

    // 각 진영 비율 계산
    const bullRatios = calculateRatios(bulls.map((e) => ({ name: e.name, marketCap: e.marketCap })));
    const bearRatios = calculateRatios(bears.map((e) => ({ name: e.name, marketCap: e.marketCap })));

    // 보유 중인 ETF의 최종가중치 합산
    let bullScore = 0;
    let bearScore = 0;

    const etfInfos: EtfSignalInfo[] = [];

    for (const etf of bulls) {
      const ratio = bullRatios.get(etf.name) ?? 0;
      const finalWeight = etf.typeWeight * ratio;
      if (etf.held) bullScore += finalWeight;
      etfInfos.push({
        name: etf.name,
        symbol: etf.symbol,
        type: etf.type,
        weight: etf.typeWeight,
        finalWeight,
        side: 'bull',
        held: etf.held,
        marketCap: etf.marketCap,
        lastSignalDate: etf.lastSignalDate,
        lastSignalType: etf.lastSignalType,
      });
    }

    for (const etf of bears) {
      const ratio = bearRatios.get(etf.name) ?? 0;
      const finalWeight = etf.typeWeight * ratio;
      if (etf.held) bearScore += finalWeight;
      etfInfos.push({
        name: etf.name,
        symbol: etf.symbol,
        type: etf.type,
        weight: etf.typeWeight,
        finalWeight,
        side: 'bear',
        held: etf.held,
        marketCap: etf.marketCap,
        lastSignalDate: etf.lastSignalDate,
        lastSignalType: etf.lastSignalType,
      });
    }

    const netSentiment = bullScore - bearScore;
    const hasActivePositions = bullScore > 0 || bearScore > 0;

    sectors[sector] = {
      label: sector,
      bullScore: Math.round(bullScore * 1000) / 1000,
      bearScore: Math.round(bearScore * 1000) / 1000,
      netSentiment: Math.round(netSentiment * 1000) / 1000,
      sentiment: getSentimentLabel(netSentiment, hasActivePositions),
      hasActivePositions,
      etfs: etfInfos,
    };
  }

  // 전체 센티먼트 = 섹터 netSentiment 단순 평균
  const sectorValues = Object.values(sectors);
  const activeSectors = sectorValues.filter((s) => s.hasActivePositions);
  const overallSentiment = activeSectors.length > 0
    ? activeSectors.reduce((sum, s) => sum + s.netSentiment, 0) / activeSectors.length
    : 0;

  return {
    sectors,
    overallSentiment: Math.round(overallSentiment * 1000) / 1000,
    overallLabel: getOverallSentimentLabel(overallSentiment, activeSectors.length > 0),
  };
}
```

- [ ] **Step 4: 오버라이드 적용 함수 작성**

같은 파일에 추가:

```typescript
export interface EtfOverrides {
  [etfName: string]: {
    sector?: string;
    side?: EtfSide;
    excluded?: boolean;
  };
  __sectorRenames?: {
    [autoName: string]: string;
  };
}

/**
 * 클라이언트에서 localStorage 오버라이드 적용 후 재계산
 */
export function applyOverrides(
  etfs: ClassifiedEtf[],
  overrides: EtfOverrides
): ClassifiedEtf[] {
  const sectorRenames = (overrides as Record<string, unknown>).__sectorRenames as Record<string, string> | undefined;

  return etfs
    .filter((etf) => !overrides[etf.name]?.excluded)
    .map((etf) => {
      const o = overrides[etf.name];
      let sector = o?.sector ?? etf.sector;
      const side = o?.side ?? etf.side;

      // 섹터명 변경 적용
      if (sectorRenames?.[sector]) {
        sector = sectorRenames[sector];
      }

      return { ...etf, sector, side };
    });
}
```

- [ ] **Step 5: 커밋**

```bash
git add web/src/lib/etf-sentiment.ts
git commit -m "feat: ETF 분류 및 센티먼트 계산 로직 추가"
```

---

### Task 2: API 엔드포인트

**Files:**
- Create: `web/src/app/api/v1/market-indicators/etf-sentiment/route.ts`

- [ ] **Step 1: API 라우트 작성**

```typescript
// web/src/app/api/v1/market-indicators/etf-sentiment/route.ts

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import {
  isEtf, classifyEtfType, extractSector,
  calculateSectorSentiments,
  type ClassifiedEtf,
} from '@/lib/etf-sentiment';

export const dynamic = 'force-dynamic';

const BUY_TYPES = ['BUY'];
const SELL_TYPES = ['SELL', 'SELL_COMPLETE'];

export async function GET() {
  try {
    const supabase = createServiceClient();

    // 1. 라씨매매 소스의 ETF 신호 조회 (BUY, SELL, SELL_COMPLETE)
    const { data: signals, error } = await supabase
      .from('signals')
      .select('name, symbol, signal_type, timestamp')
      .eq('source', 'lassi')
      .in('signal_type', [...BUY_TYPES, ...SELL_TYPES])
      .order('timestamp', { ascending: false });

    if (error || !signals) {
      return NextResponse.json({
        success: true,
        sectors: {},
        overallSentiment: 0,
        overallLabel: 'neutral',
        updatedAt: new Date().toISOString(),
      });
    }

    // 2. ETF만 필터 + 종목별 최신 신호로 보유 여부 판정
    const latestByName = new Map<string, {
      symbol: string | null;
      signalType: string;
      timestamp: string;
    }>();

    for (const sig of signals) {
      if (!isEtf(sig.name)) continue;
      // 이미 더 최신 신호가 있으면 스킵 (timestamp desc 정렬이므로 첫 번째가 최신)
      if (latestByName.has(sig.name)) continue;
      latestByName.set(sig.name, {
        symbol: sig.symbol,
        signalType: sig.signal_type,
        timestamp: sig.timestamp,
      });
    }

    if (latestByName.size === 0) {
      return NextResponse.json({
        success: true,
        sectors: {},
        overallSentiment: 0,
        overallLabel: 'neutral',
        updatedAt: new Date().toISOString(),
      });
    }

    // 3. 시가총액 조회
    const symbols = [...latestByName.values()]
      .map((v) => v.symbol)
      .filter((s): s is string => s != null);

    let marketCapMap = new Map<string, number>();
    if (symbols.length > 0) {
      const { data: caches } = await supabase
        .from('stock_cache')
        .select('symbol, market_cap')
        .in('symbol', symbols);

      if (caches) {
        for (const c of caches) {
          if (c.market_cap != null) marketCapMap.set(c.symbol, c.market_cap);
        }
      }
    }

    // 4. ETF 분류
    const classifiedEtfs: ClassifiedEtf[] = [];
    for (const [name, info] of latestByName) {
      const { type, side, typeWeight } = classifyEtfType(name);
      const sector = extractSector(name);
      const held = BUY_TYPES.includes(info.signalType);
      const marketCap = info.symbol ? (marketCapMap.get(info.symbol) ?? null) : null;

      classifiedEtfs.push({
        name,
        symbol: info.symbol,
        brand: '',
        type,
        typeWeight,
        side,
        sector,
        held,
        marketCap,
        lastSignalDate: info.timestamp,
        lastSignalType: info.signalType,
      });
    }

    // 5. 센티먼트 계산
    const result = calculateSectorSentiments(classifiedEtfs);

    const response = NextResponse.json({
      success: true,
      ...result,
      // 클라이언트 오버라이드용 원본 ETF 데이터
      rawEtfs: classifiedEtfs,
      updatedAt: new Date().toISOString(),
    });

    response.headers.set('Cache-Control', 'public, max-age=300');
    return response;
  } catch (e) {
    console.error('[etf-sentiment] error:', e);
    return NextResponse.json({
      success: false,
      sectors: {},
      overallSentiment: 0,
      overallLabel: 'neutral',
      updatedAt: new Date().toISOString(),
    }, { status: 500 });
  }
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/app/api/v1/market-indicators/etf-sentiment/route.ts
git commit -m "feat: ETF 센티먼트 API 엔드포인트 추가"
```

---

### Task 3: 섹터 매핑 관리 모달

**Files:**
- Create: `web/src/components/market/etf-override-modal.tsx`

> Task 3과 4의 순서를 바꿈: 모달을 먼저 생성해야 센티먼트 섹션에서 import 가능

- [ ] **Step 1: 모달 컴포넌트 작성**

```typescript
// web/src/components/market/etf-override-modal.tsx
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

export function EtfOverrideModal({ rawEtfs, overrides: initial, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<EtfOverrides>({ ...initial });
  const [editingSector, setEditingSector] = useState<string | null>(null);
  const [sectorDraft, setSectorDraft] = useState("");

  // 섹터별 그룹
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

  // 사용 가능한 섹터 목록
  const allSectors = useMemo(() => {
    const set = new Set<string>();
    for (const [sector] of grouped) set.add(sector);
    return [...set].sort();
  }, [grouped]);

  function updateEtf(name: string, patch: Partial<{ sector?: string; side?: EtfSide; excluded?: boolean }>) {
    setDraft((prev) => ({
      ...prev,
      [name]: { ...(prev[name] as object), ...patch },
    }));
  }

  function startRenameSector(sector: string) {
    setEditingSector(sector);
    setSectorDraft(sector);
  }

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

  function handleReset() {
    setDraft({});
  }

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

        {/* 본문 */}
        <div className="overflow-y-auto flex-1 px-5 py-3">
          {grouped.map(([sector, etfs]) => (
            <div key={sector} className="mb-4">
              {/* 섹터 헤더 — 클릭으로 인라인 편집 */}
              <div className="flex items-center gap-2 mb-2">
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
                    <button onClick={() => startRenameSector(sector)} className="p-0.5 hover:bg-[var(--card-hover)] rounded opacity-0 group-hover:opacity-100">
                      <Pencil className="w-3 h-3 text-[var(--muted)]" />
                    </button>
                  </>
                )}
              </div>
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
                      <input
                        type="checkbox"
                        checked={!isExcluded}
                        onChange={(e) => updateEtf(etf.name, { excluded: !e.target.checked })}
                        className="accent-blue-500"
                      />
                      <span className="flex-1 truncate">{etf.name}</span>
                      <span className="text-xs text-[var(--muted)] w-14">
                        {etf.type === 'leverage' ? '레버리지' : etf.type === 'inverse' ? '인버스' : '일반'}
                      </span>
                      <select
                        value={currentSide}
                        onChange={(e) => updateEtf(etf.name, { side: e.target.value as EtfSide })}
                        className="text-xs bg-[var(--card)] border border-[var(--border)] rounded px-1 py-0.5"
                      >
                        <option value="bull">강세</option>
                        <option value="bear">약세</option>
                      </select>
                      <select
                        value={o?.sector ?? etf.sector}
                        onChange={(e) => updateEtf(etf.name, { sector: e.target.value === etf.sector ? undefined : e.target.value })}
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
          <button onClick={handleSave} className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium">저장</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add web/src/components/market/etf-override-modal.tsx
git commit -m "feat: ETF 섹터 매핑 관리 모달 추가"
```

---

### Task 4: 센티먼트 섹션 UI 컴포넌트

**Files:**
- Create: `web/src/components/market/etf-sentiment-section.tsx`

- [ ] **Step 1: 센티먼트 배지/색상 상수 및 배너 작성**

```typescript
// web/src/components/market/etf-sentiment-section.tsx
"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Settings, ChevronDown, ChevronUp, TrendingUp, TrendingDown, AlertTriangle, Minus } from "lucide-react";
import {
  type SectorSentiment, type EtfSignalInfo, type SentimentLabel,
  type ClassifiedEtf, type EtfOverrides,
  applyOverrides, calculateSectorSentiments,
} from "@/lib/etf-sentiment";
import { EtfOverrideModal } from "./etf-override-modal";

const SENTIMENT_CONFIG: Record<SentimentLabel, { label: string; color: string; bg: string; text: string; border: string }> = {
  strong_positive: { label: "강한 긍정", color: "#10b981", bg: "bg-emerald-900/20", text: "text-emerald-400", border: "border-emerald-800/40" },
  positive:        { label: "긍정",     color: "#22c55e", bg: "bg-green-900/20",   text: "text-green-400",   border: "border-green-800/40" },
  caution:         { label: "주의",     color: "#eab308", bg: "bg-yellow-900/20",  text: "text-yellow-400",  border: "border-yellow-800/40" },
  neutral:         { label: "중립",     color: "#6b7280", bg: "bg-gray-900/20",    text: "text-gray-400",    border: "border-gray-800/40" },
  negative:        { label: "부정",     color: "#f97316", bg: "bg-orange-900/20",  text: "text-orange-400",  border: "border-orange-800/40" },
  strong_negative: { label: "강한 부정", color: "#ef4444", bg: "bg-red-900/20",     text: "text-red-400",     border: "border-red-800/40" },
};

function SentimentBadge({ sentiment }: { sentiment: SentimentLabel }) {
  const c = SENTIMENT_CONFIG[sentiment];
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${c.bg} ${c.text} ${c.border}`}>
      {c.label}
    </span>
  );
}

function SentimentIcon({ sentiment }: { sentiment: SentimentLabel }) {
  if (sentiment === "strong_positive" || sentiment === "positive")
    return <TrendingUp className="w-5 h-5 text-emerald-400" />;
  if (sentiment === "strong_negative" || sentiment === "negative")
    return <TrendingDown className="w-5 h-5 text-red-400" />;
  if (sentiment === "caution")
    return <AlertTriangle className="w-5 h-5 text-yellow-400" />;
  return <Minus className="w-5 h-5 text-gray-400" />;
}
```

- [ ] **Step 2: 센티먼트 배너 컴포넌트 작성**

같은 파일에 추가:

```typescript
function SentimentBanner({
  overallSentiment, overallLabel, sectorCount,
}: {
  overallSentiment: number;
  overallLabel: SentimentLabel;
  sectorCount: number;
}) {
  const c = SENTIMENT_CONFIG[overallLabel];
  return (
    <div
      className="card p-5 flex items-center gap-4"
      style={{ borderColor: c.color + "60", background: c.color + "08" }}
    >
      <SentimentIcon sentiment={overallLabel} />
      <div className="flex-1">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xl font-bold" style={{ color: c.color }}>{c.label}</span>
          <span className="text-2xl font-black tabular-nums" style={{ color: c.color }}>
            {overallSentiment > 0 ? "+" : ""}{overallSentiment.toFixed(2)}
          </span>
        </div>
        <p className="text-sm text-[var(--muted)] mt-1">
          {sectorCount}개 섹터 ETF 신호 기반 시장 센티먼트
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 섹터 카드 컴포넌트 작성**

같은 파일에 추가:

```typescript
function SectorCard({ sector }: { sector: SectorSentiment }) {
  const [expanded, setExpanded] = useState(false);
  const c = SENTIMENT_CONFIG[sector.sentiment];
  const maxScore = Math.max(sector.bullScore, sector.bearScore, 0.01);

  return (
    <div className="border-b border-[var(--border)] last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[var(--card-hover)] transition-colors"
      >
        <SentimentBadge sentiment={sector.sentiment} />
        <span className="font-medium text-sm flex-1 text-left">{sector.label}</span>

        {/* 강세/약세 바 */}
        <div className="flex items-center gap-1 w-32">
          <div className="flex-1 h-2 rounded-full bg-[var(--border)] overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${(sector.bullScore / maxScore) * 100}%` }}
            />
          </div>
          <div className="flex-1 h-2 rounded-full bg-[var(--border)] overflow-hidden">
            <div
              className="h-full rounded-full bg-red-500 ml-auto"
              style={{ width: `${(sector.bearScore / maxScore) * 100}%` }}
            />
          </div>
        </div>

        <span className="text-xs tabular-nums w-12 text-right" style={{ color: c.color }}>
          {sector.netSentiment > 0 ? "+" : ""}{sector.netSentiment.toFixed(2)}
        </span>

        {expanded ? <ChevronUp className="w-4 h-4 text-[var(--muted)]" /> : <ChevronDown className="w-4 h-4 text-[var(--muted)]" />}
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-1">
          {sector.etfs.map((etf) => (
            <EtfRow key={etf.name} etf={etf} />
          ))}
        </div>
      )}
    </div>
  );
}

function EtfRow({ etf }: { etf: EtfSignalInfo }) {
  const typeLabel = etf.type === 'leverage' ? '레버리지' : etf.type === 'inverse' ? '인버스' : '일반';
  const sideColor = etf.side === 'bull' ? 'text-emerald-400' : 'text-red-400';

  return (
    <div className="flex items-center gap-2 text-xs py-1 px-2 rounded hover:bg-[var(--card-hover)]">
      <span className={`w-2 h-2 rounded-full ${etf.held ? (etf.side === 'bull' ? 'bg-emerald-400' : 'bg-red-400') : 'bg-gray-600'}`} />
      <span className="flex-1 truncate">{etf.name}</span>
      <span className={`${sideColor} w-14`}>{typeLabel}</span>
      <span className={`w-10 text-center ${etf.held ? 'text-white font-medium' : 'text-[var(--muted)]'}`}>
        {etf.held ? '보유' : '미보유'}
      </span>
      <span className="text-[var(--muted)] w-16 text-right tabular-nums">
        {etf.finalWeight.toFixed(3)}
      </span>
      <span className="text-[var(--muted)] w-20 text-right">
        {etf.lastSignalDate.slice(0, 10)}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: 메인 섹션 컴포넌트 (export) 작성**

같은 파일에 추가:

```typescript
interface EtfSentimentSectionProps {
  rawEtfs: ClassifiedEtf[];
  sectors: Record<string, SectorSentiment>;
  overallSentiment: number;
  overallLabel: SentimentLabel;
}

export function EtfSentimentSection({
  rawEtfs: initialRawEtfs,
  sectors: initialSectors,
  overallSentiment: initialOverall,
  overallLabel: initialLabel,
}: EtfSentimentSectionProps) {
  const [showModal, setShowModal] = useState(false);
  const [overrides, setOverrides] = useState<EtfOverrides>({});

  // localStorage에서 오버라이드 로드
  useEffect(() => {
    try {
      const stored = localStorage.getItem("etf-sector-overrides");
      if (stored) setOverrides(JSON.parse(stored));
    } catch {}
  }, []);

  // 오버라이드 적용 후 재계산
  const { sectors, overallSentiment, overallLabel } = useMemo(() => {
    if (Object.keys(overrides).length === 0) {
      return { sectors: initialSectors, overallSentiment: initialOverall, overallLabel: initialLabel };
    }
    const adjusted = applyOverrides(initialRawEtfs, overrides);
    return calculateSectorSentiments(adjusted);
  }, [initialRawEtfs, initialSectors, initialOverall, initialLabel, overrides]);

  // 센티먼트 순 정렬 (강한부정 → 강한긍정)
  const sortedSectors = useMemo(() => {
    return Object.values(sectors).sort((a, b) => a.netSentiment - b.netSentiment);
  }, [sectors]);

  const handleSaveOverrides = useCallback((newOverrides: EtfOverrides) => {
    setOverrides(newOverrides);
    localStorage.setItem("etf-sector-overrides", JSON.stringify(newOverrides));
  }, []);

  if (sortedSectors.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">ETF 신호 기반 시장 센티먼트</h2>
        <button
          onClick={() => setShowModal(true)}
          className="p-1.5 rounded-lg hover:bg-[var(--card-hover)] transition-colors"
          title="섹터 매핑 관리"
        >
          <Settings className="w-4 h-4 text-[var(--muted)]" />
        </button>
      </div>

      <SentimentBanner
        overallSentiment={overallSentiment}
        overallLabel={overallLabel}
        sectorCount={sortedSectors.length}
      />

      <div className="card mt-4 overflow-hidden">
        {sortedSectors.map((sector) => (
          <SectorCard key={sector.label} sector={sector} />
        ))}
      </div>

      {showModal && (
        <EtfOverrideModal
          rawEtfs={initialRawEtfs}
          overrides={overrides}
          onSave={handleSaveOverrides}
          onClose={() => setShowModal(false)}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 5: 커밋**

```bash
git add web/src/components/market/etf-sentiment-section.tsx
git commit -m "feat: ETF 센티먼트 섹션 UI 컴포넌트 추가"
```

### Task 5: 투자시황 페이지 통합

**Files:**
- Modify: `web/src/app/market/page.tsx`
- Modify: `web/src/components/market/market-client.tsx`

- [ ] **Step 1: market page.tsx에 ETF 센티먼트 데이터 fetch 추가**

`page.tsx`에서 API를 직접 호출하지 않고, 기존 패턴대로 Supabase 서버 쿼리 + 클라이언트에서 API fetch 방식을 사용. `market-client.tsx`에서 클라이언트 사이드로 `/api/v1/market-indicators/etf-sentiment`를 호출.

`page.tsx`는 수정 불필요.

- [ ] **Step 2: market-client.tsx에 ETF 센티먼트 fetch 및 섹션 추가**

`market-client.tsx` 상단 import 추가:

```typescript
import { EtfSentimentSection } from "./etf-sentiment-section";
import type { ClassifiedEtf, SectorSentiment, SentimentLabel } from "@/lib/etf-sentiment";
```

MarketClient 컴포넌트 내부에 상태 및 fetch 로직 추가 (기존 `fetchRealtime` 근처):

```typescript
// ─── ETF 센티먼트 ─────────────────────────────────
const [etfData, setEtfData] = useState<{
  rawEtfs: ClassifiedEtf[];
  sectors: Record<string, SectorSentiment>;
  overallSentiment: number;
  overallLabel: SentimentLabel;
} | null>(null);

const fetchEtfSentiment = useCallback(async () => {
  try {
    const res = await fetch("/api/v1/market-indicators/etf-sentiment");
    if (!res.ok) return;
    const json = await res.json();
    if (!json.success) return;
    setEtfData({
      rawEtfs: json.rawEtfs ?? [],
      sectors: json.sectors ?? {},
      overallSentiment: json.overallSentiment ?? 0,
      overallLabel: json.overallLabel ?? 'neutral',
    });
  } catch (e) {
    console.error("[market] etf-sentiment fetch failed:", e);
  }
}, []);

// 페이지 진입 시 ETF 센티먼트도 로드
useEffect(() => {
  fetchEtfSentiment();
}, [fetchEtfSentiment]);
```

JSX에서 "지표별 위험 현황" `</section>` 뒤, "최근 30일 위험 지수 추이" 앞에 삽입:

```tsx
{/* ETF 신호 기반 시장 센티먼트 */}
{etfData && Object.keys(etfData.sectors).length > 0 && (
  <EtfSentimentSection
    rawEtfs={etfData.rawEtfs}
    sectors={etfData.sectors}
    overallSentiment={etfData.overallSentiment}
    overallLabel={etfData.overallLabel}
  />
)}
```

- [ ] **Step 3: 커밋**

```bash
git add web/src/components/market/market-client.tsx
git commit -m "feat: 투자시황 페이지에 ETF 센티먼트 섹션 통합"
```

---

### Task 6: 수동 검증

- [ ] **Step 1: 개발 서버 실행 및 확인**

```bash
cd web && npm run dev
```

브라우저에서 확인:
1. `/market` 페이지 접속
2. "ETF 신호 기반 시장 센티먼트" 섹션 표시 여부
3. 섹터 카드 클릭 → ETF 상세 펼침
4. 설정 버튼 → 모달 오픈 → 제외/섹터이동/진영변경 → 저장 → 센티먼트 재계산
5. API 직접 호출: `curl localhost:3000/api/v1/market-indicators/etf-sentiment | jq`

- [ ] **Step 2: 빌드 확인**

```bash
cd web && npm run build
```

에러 없이 빌드되는지 확인.

- [ ] **Step 3: 최종 커밋 (필요시)**

빌드 중 발견된 이슈 수정 후 커밋.
