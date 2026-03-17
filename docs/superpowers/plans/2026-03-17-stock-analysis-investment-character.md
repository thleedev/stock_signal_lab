# 종목분석 탭 투자 성격 분류 + 차트 패턴 강화 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 종목분석 탭에 투자 성격 태그(단기급등, 가치주 등) + 필터 + 미니 점수 바 시각화를 추가하여 투자 매력도를 직관적으로 파악할 수 있게 한다.

**Architecture:** `UnifiedAnalysisSection.tsx` 내에 투자 성격 분류 로직과 UI를 추가한다. 별도 파일 생성 없이, 기존 컴포넌트 내의 배지/필터/점수 표시 영역을 확장한다. FilterBar에는 새로운 `character` prop을 추가한다.

**Tech Stack:** React, TypeScript, Tailwind CSS (기존 스택 그대로)

---

### Task 1: 투자 성격 분류 로직 추가 (UnifiedAnalysisSection.tsx)

**Files:**
- Modify: `web/src/components/signals/UnifiedAnalysisSection.tsx:12-55` (타입/상수 영역)

- [ ] **Step 1: InvestmentCharacter 타입과 분류 함수 추가**

`UnifiedAnalysisSection.tsx`의 타입 정의 영역(12행 부근)에 추가:

```typescript
type InvestmentCharacter = 'short_surge' | 'value' | 'supply_strong' | 'tech_rebound' | 'multi_signal' | 'top_pick';

interface CharacterDef {
  key: InvestmentCharacter;
  label: string;
  icon: string;
  variant: BadgeVariant | 'purple' | 'gold';
}

const CHARACTER_DEFS: CharacterDef[] = [
  { key: 'short_surge',   label: '단기급등',  icon: '🔥', variant: 'red' },
  { key: 'value',         label: '가치주',    icon: '💎', variant: 'purple' },
  { key: 'supply_strong', label: '수급강세',  icon: '🏦', variant: 'blue' },
  { key: 'tech_rebound',  label: '기술반등',  icon: '📈', variant: 'green' },
  { key: 'multi_signal',  label: '다중신호',  icon: '⚡', variant: 'orange' },
  { key: 'top_pick',      label: '종합추천',  icon: '⭐', variant: 'gold' },
];

const CHARACTER_FILTER_OPTIONS = [
  { key: 'all', label: '전체' },
  ...CHARACTER_DEFS.map(d => ({ key: d.key, label: `${d.icon} ${d.label}` })),
];
```

- [ ] **Step 2: 분류 판정 함수 구현**

같은 파일에 `getInvestmentCharacters` 함수 추가:

```typescript
function getInvestmentCharacters(item: StockRankItem, weights: Weights): InvestmentCharacter[] {
  const chars: InvestmentCharacter[] = [];
  const { sig, tech, val, sup } = normScores(item);
  const weighted = computeWeighted(item, weights);

  // 단기급등: 기술점수 높고 + 모멘텀 패턴 감지
  if (item.ai) {
    if (tech >= 60 && (item.ai.golden_cross || item.ai.macd_cross || item.ai.volume_surge)) {
      chars.push('short_surge');
    }
  } else if (tech >= 60 && item.price_change_pct !== null && item.price_change_pct > 3) {
    chars.push('short_surge');
  }

  // 가치주: 밸류점수 70 이상 (PER<10, PBR<1, ROE>10% 중 2개 이상 충족)
  if (val >= 70) {
    chars.push('value');
  }

  // 수급강세: 수급점수 60 이상
  if (sup >= 60) {
    chars.push('supply_strong');
  }

  // 기술반등: 불새패턴 또는 (볼린저하단 + RSI<40)
  if (item.ai) {
    if (item.ai.phoenix_pattern || (item.ai.bollinger_bottom && item.ai.rsi !== null && item.ai.rsi < 40)) {
      chars.push('tech_rebound');
    }
  }

  // 다중신호: 30일내 3회 이상 또는 신호점수 80 이상
  if ((item.signal_count_30d ?? 0) >= 3 || sig >= 80) {
    chars.push('multi_signal');
  }

  // 종합추천: 가중합 70점 이상
  if (weighted >= 70) {
    chars.push('top_pick');
  }

  return chars;
}
```

- [ ] **Step 3: BADGE_CLS에 purple, gold 변형 추가**

기존 `BADGE_CLS` 객체 확장:

```typescript
const BADGE_CLS: Record<string, string> = {
  green:  'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  blue:   'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  red:    'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  gold:   'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
};
```

- [ ] **Step 4: 빌드 확인**

Run: `cd /Users/thlee/GoogleDrive/DashboardStock/web && npx next build --no-lint 2>&1 | tail -5`
Expected: 빌드 성공 (새 함수/타입은 아직 UI에서 사용하지 않으므로 unused 경고 가능)

---

### Task 2: FilterBar에 투자성격 필터 추가

**Files:**
- Modify: `web/src/components/common/filter-bar.tsx:14-50` (FilterBarProps)
- Modify: `web/src/components/signals/UnifiedAnalysisSection.tsx:380-400` (state, FilterBar 호출부)

- [ ] **Step 1: FilterBar에 character prop 추가**

`filter-bar.tsx`의 `FilterBarProps`에 추가:

```typescript
character?: {
  options: { key: string; label: string }[];
  selected: string;
  onChange: (c: string) => void;
  label?: string;
};
```

FilterBar 컴포넌트의 JSX에서 source 드롭다운 바로 다음에 character 드롭다운 렌더링:

```tsx
{/* 투자성격 드롭다운 */}
{character && (
  <LabeledSelect
    label={character.label}
    value={character.selected}
    onChange={character.onChange}
    options={character.options}
  />
)}
```

모바일 ⋯ 팝업에도 동일하게 추가.

- [ ] **Step 2: UnifiedAnalysisSection에 character 필터 state 추가**

```typescript
const [charFilter, setCharFilter] = useState<string>('all');
```

FilterBar 호출부에 character prop 전달:

```tsx
<FilterBar
  ...existing props...
  character={{
    options: CHARACTER_FILTER_OPTIONS,
    selected: charFilter,
    onChange: setCharFilter,
    label: '성격',
  }}
/>
```

- [ ] **Step 3: 정렬 로직에 character 필터 적용**

`sortedItems` useMemo에서 필터 적용:

```typescript
const filteredByChar = useMemo(() => {
  if (charFilter === 'all') return sortedItems;
  return sortedItems.filter(item => {
    const chars = getInvestmentCharacters(item, weights);
    return chars.includes(charFilter as InvestmentCharacter);
  });
}, [sortedItems, charFilter, weights]);
```

렌더링에서 `sortedItems` 대신 `filteredByChar` 사용.

- [ ] **Step 4: 빌드 확인**

Run: `cd /Users/thlee/GoogleDrive/DashboardStock/web && npx next build --no-lint 2>&1 | tail -5`
Expected: 빌드 성공

---

### Task 3: RankCard에 투자 성격 태그 표시

**Files:**
- Modify: `web/src/components/signals/UnifiedAnalysisSection.tsx:207-326` (RankCard)

- [ ] **Step 1: RankCard props에 characters 추가**

```typescript
function RankCard({
  item, rank, weighted, favs, gapInfo, onClick, characters,
}: {
  ...existing props...
  characters: InvestmentCharacter[];
}) {
```

- [ ] **Step 2: 기존 배지 위에 투자 성격 태그 행 추가**

RankCard JSX에서 줄1과 줄2(배지) 사이에 투자 성격 태그 렌더링:

```tsx
{/* ── 줄 1.8: 투자 성격 태그 ── */}
{characters.length > 0 && (
  <div className="flex flex-wrap gap-1 mt-1 pl-7">
    {characters.map(charKey => {
      const def = CHARACTER_DEFS.find(d => d.key === charKey)!;
      return (
        <span
          key={charKey}
          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${BADGE_CLS[def.variant]}`}
        >
          {def.icon} {def.label}
        </span>
      );
    })}
  </div>
)}
```

- [ ] **Step 3: RankCard 호출부에서 characters 전달**

```tsx
{filteredByChar.map((item, idx) => {
  const weighted = computeWeighted(item, weights);
  const gapInfo = getGapInfo(item, signalMap, sourceFilter, livePrices);
  const characters = getInvestmentCharacters(item, weights);
  return (
    <RankCard
      key={item.symbol}
      item={item}
      rank={offset + idx + 1}
      weighted={weighted}
      favs={favs}
      gapInfo={gapInfo}
      onClick={(e) => openMenu(e, item.symbol, item.name, item.current_price)}
      characters={characters}
    />
  );
})}
```

- [ ] **Step 4: 빌드 확인**

Run: `cd /Users/thlee/GoogleDrive/DashboardStock/web && npx next build --no-lint 2>&1 | tail -5`
Expected: 빌드 성공

---

### Task 4: 미니 점수 바 시각화

**Files:**
- Modify: `web/src/components/signals/UnifiedAnalysisSection.tsx:207-326` (RankCard)

- [ ] **Step 1: ScoreBars 인라인 컴포넌트 추가**

```typescript
function ScoreBars({ sig, tech, val, sup }: { sig: number; tech: number; val: number; sup: number }) {
  const bars = [
    { label: '신호', value: sig, color: 'bg-amber-400' },
    { label: '기술', value: tech, color: 'bg-emerald-400' },
    { label: '밸류', value: val, color: 'bg-violet-400' },
    { label: '수급', value: sup, color: 'bg-sky-400' },
  ];
  return (
    <div className="flex items-center gap-2 pl-7 mt-1">
      {bars.map(b => (
        <div key={b.label} className="flex items-center gap-1 min-w-0">
          <span className="text-[9px] text-[var(--muted)] w-5 shrink-0">{b.label}</span>
          <div className="w-12 sm:w-16 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
            <div
              className={`h-full rounded-full ${b.color} transition-all`}
              style={{ width: `${Math.max(0, Math.min(100, b.value))}%` }}
            />
          </div>
          <span className="text-[9px] tabular-nums text-[var(--muted)] w-5 shrink-0 text-right">{b.value}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: RankCard에서 기존 텍스트 점수를 ScoreBars로 교체**

기존 `신{sig}·기{tech}·밸{val}·수{sup}` 텍스트 줄 대신 ScoreBars 컴포넌트 사용:

데스크탑 메타영역(`hidden sm:flex`)에서 점수 텍스트 제거하고, 줄2(배지) 아래에 ScoreBars 추가:

```tsx
{/* ── 줄 3: 점수 바 ── */}
<ScoreBars sig={sig} tech={tech} val={val} sup={sup} />
```

모바일 줄1.5에서도 `신{sig}·기{tech}·밸{val}·수{sup}` 텍스트를 제거하고 ScoreBars로 대체.

- [ ] **Step 3: 빌드 확인**

Run: `cd /Users/thlee/GoogleDrive/DashboardStock/web && npx next build --no-lint 2>&1 | tail -5`
Expected: 빌드 성공

---

### Task 5: 종목수 표시에 성격별 카운트 추가 + 최종 정리

**Files:**
- Modify: `web/src/components/signals/UnifiedAnalysisSection.tsx:577-585` (종목수 표시 영역)

- [ ] **Step 1: 성격별 카운트 표시**

기존 종목수 표시 영역 확장:

```tsx
<div className="text-xs text-[var(--muted)] flex flex-wrap items-center gap-2">
  <span>{filteredByChar.length.toLocaleString()}종목</span>
  {aiCount > 0 && (
    <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
      AI분석 {aiCount}
    </span>
  )}
  {charFilter !== 'all' && (
    <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
      {CHARACTER_DEFS.find(d => d.key === charFilter)?.icon} {CHARACTER_DEFS.find(d => d.key === charFilter)?.label} 필터 적용
    </span>
  )}
</div>
```

- [ ] **Step 2: 최종 빌드 + 시각 확인**

Run: `cd /Users/thlee/GoogleDrive/DashboardStock/web && npx next build --no-lint 2>&1 | tail -10`
Expected: 빌드 성공

- [ ] **Step 3: 커밋**

```bash
git add web/src/components/signals/UnifiedAnalysisSection.tsx web/src/components/common/filter-bar.tsx
git commit -m "feat: 종목분석 탭에 투자 성격 분류(태그+필터) + 미니 점수 바 시각화 추가"
```
