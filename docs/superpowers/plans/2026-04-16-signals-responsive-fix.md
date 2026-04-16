# Signals 반응형 수정 + 필터 UI 일관성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** signals 페이지 모바일 깨짐 4곳 수정 + stocks ↔ signals 종목분석 필터 버튼 높이 통일

**Architecture:** 구조 변경 없이 Tailwind 클래스만 수정. 5개 파일, 각 파일 독립적으로 수정 가능. 테스트는 dev 서버에서 375px 뷰포트 시각 검증으로 대체 (CSS 클래스 변경은 unit test 대상 아님).

**Tech Stack:** Next.js 16, React 19, Tailwind CSS v4

---

## 파일 맵

| 파일 | 변경 이유 |
|------|---------|
| `web/src/components/signals/UnifiedAnalysisSection.tsx` | A-1: RankCard 종목명 max-w 확대 |
| `web/src/components/signals/AiRecommendationSection.tsx` | A-2: 점수 그리드 모바일 2×2 반응형 |
| `web/src/components/signals/HotThemesBanner.tsx` | A-3: 테마명 말줄임표 처리 |
| `web/src/components/signals/RecommendationFilterBar.tsx` | A-4: 더보기 팝업 화면 이탈 방지 |
| `web/src/components/stocks/stock-list-client.tsx` | B-1: 필터 컨테이너 py 패딩 제거로 높이 통일 |

---

## Task 1: RankCard 종목명 너비 확대 (A-1)

**Files:**
- Modify: `web/src/components/signals/UnifiedAnalysisSection.tsx:340,347`

### 현재 코드 위치
- 340번줄: 줄1 flex 컨테이너 (`gap-1.5 sm:gap-2`)
- 347번줄: 종목명 span (`max-w-[6rem] sm:max-w-[10rem]`)

- [ ] **Step 1: 종목명 max-w 확대 및 gap 축소**

`web/src/components/signals/UnifiedAnalysisSection.tsx` 340번줄:
```tsx
// Before
<div className="flex items-center gap-1.5 sm:gap-2 min-w-0">

// After
<div className="flex items-center gap-1 sm:gap-1.5 min-w-0">
```

347번줄:
```tsx
// Before
<span className="font-semibold text-sm sm:text-[15px] truncate max-w-[6rem] sm:max-w-[10rem]">{item.name}</span>

// After
<span className="font-semibold text-sm sm:text-[15px] truncate max-w-[8rem] sm:max-w-[12rem]">{item.name}</span>
```

- [ ] **Step 2: dev 서버에서 확인**

```bash
cd web && npm run dev
```

브라우저에서 `localhost:3000/signals?tab=stock-analysis` 접속.
DevTools → 디바이스 툴바 → 375px 폭으로 설정.
종목명이 이전보다 더 많이 보이는지 확인 (예: "삼성전자" 전체가 표시되어야 함).

- [ ] **Step 3: 커밋**

```bash
git add web/src/components/signals/UnifiedAnalysisSection.tsx
git commit -m "fix: RankCard 종목명 모바일 max-w 확대 (6rem→8rem)"
```

---

## Task 2: 점수 그리드 모바일 2×2 반응형 (A-2)

**Files:**
- Modify: `web/src/components/signals/AiRecommendationSection.tsx:100,107`

### 현재 코드 위치
- 100번줄: `<div className="grid grid-cols-4 gap-1 mt-3 text-center">`
- 107번줄: `<div key={label} className="bg-gray-50 dark:bg-gray-700/50 rounded p-1">`

- [ ] **Step 1: grid-cols-4 → grid-cols-2 sm:grid-cols-4**

`web/src/components/signals/AiRecommendationSection.tsx` 100번줄:
```tsx
// Before
<div className="grid grid-cols-4 gap-1 mt-3 text-center">

// After
<div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mt-3 text-center">
```

107번줄 (셀 패딩 확대 — 2×2일 때 여유 공간 활용):
```tsx
// Before
<div key={label} className="bg-gray-50 dark:bg-gray-700/50 rounded p-1">

// After
<div key={label} className="bg-gray-50 dark:bg-gray-700/50 rounded p-1.5">
```

- [ ] **Step 2: dev 서버에서 확인**

`localhost:3000/signals` 접속 → 종목추천 탭 → 375px 뷰포트.
점수 그리드가 신호강도/추세 (1열), 밸류/수급 (2열) 2×2로 표시되는지 확인.
1024px 이상에서는 기존 4열 그대로인지 확인.

- [ ] **Step 3: 커밋**

```bash
git add web/src/components/signals/AiRecommendationSection.tsx
git commit -m "fix: 점수 그리드 모바일 2×2 반응형 (grid-cols-2 sm:grid-cols-4)"
```

---

## Task 3: 핫테마 배너 테마명 말줄임표 (A-3)

**Files:**
- Modify: `web/src/components/signals/HotThemesBanner.tsx:39-41`

### 현재 코드 위치
- 39번줄: `<span key={t.theme_id} className="text-sm whitespace-nowrap">`
- 41번줄: `<span className="text-zinc-200">{t.theme_name}</span>`

- [ ] **Step 1: 테마명 span에 inline-block + max-w + truncate 추가**

`web/src/components/signals/HotThemesBanner.tsx` 41번줄:
```tsx
// Before
<span className="text-zinc-200">{t.theme_name}</span>

// After
<span className="text-zinc-200 inline-block max-w-[6rem] truncate align-bottom">{t.theme_name}</span>
```

> 주의: 39번줄의 `whitespace-nowrap`은 유지 (순위·이름·등락률이 한 항목 내에서 줄바꿈 안 되도록 보호). 이름 span에만 max-w 적용.

- [ ] **Step 2: dev 서버에서 확인**

`localhost:3000/signals` 접속 → 375px 뷰포트.
긴 테마명(예: "반도체장비/소재")이 말줄임표로 처리되는지 확인.
짧은 테마명은 그대로 표시되는지 확인.

- [ ] **Step 3: 커밋**

```bash
git add web/src/components/signals/HotThemesBanner.tsx
git commit -m "fix: 핫테마 배너 테마명 max-w truncate 처리"
```

---

## Task 4: 더보기 팝업 화면 이탈 방지 (A-4)

**Files:**
- Modify: `web/src/components/signals/RecommendationFilterBar.tsx:294`

### 현재 코드 위치
- 294번줄: `<div className="absolute top-full mt-1 left-0 z-50 w-56 rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg p-3 space-y-3">`

- [ ] **Step 1: 팝업에 max-w calc 추가**

`web/src/components/signals/RecommendationFilterBar.tsx` 294번줄:
```tsx
// Before
<div className="absolute top-full mt-1 left-0 z-50 w-56 rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg p-3 space-y-3">

// After
<div className="absolute top-full mt-1 left-0 z-50 w-56 max-w-[calc(100vw-2rem)] rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg p-3 space-y-3">
```

- [ ] **Step 2: dev 서버에서 확인**

`localhost:3000/signals?tab=stock-analysis` → 375px 뷰포트.
`⋯` 더보기 버튼 클릭 → 팝업이 화면 오른쪽 바깥으로 넘어가지 않는지 확인.
최소 좌우 16px 여백이 유지되는지 확인.

- [ ] **Step 3: 커밋**

```bash
git add web/src/components/signals/RecommendationFilterBar.tsx
git commit -m "fix: 더보기 팝업 모바일 화면 이탈 방지 (max-w calc)"
```

---

## Task 5: stocks 필터 버튼 높이 통일 (B-1)

**Files:**
- Modify: `web/src/components/stocks/stock-list-client.tsx:693,710,735`

### 배경
- **signals ButtonGroup** 컨테이너: `flex rounded-lg border overflow-hidden shrink-0` (내부 패딩 없음)
- **stocks 필터 컨테이너**: `flex items-center gap-1 rounded-lg border bg-[var(--background)] px-1 py-1` (py-1 추가 패딩 있음)
- 이로 인해 stocks 필터 그룹이 signals보다 4px 더 높게 보임

### 현재 코드 (3개 필터 그룹 — 시장, 정렬, 신호)

693번줄 (시장):
```tsx
<div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-1 py-1">
```

710번줄 (정렬):
```tsx
<div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-1 py-1">
```

735번줄 (신호):
```tsx
<div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-1 py-1">
```

- [ ] **Step 1: 3개 필터 컨테이너에서 py-1 제거**

`web/src/components/stocks/stock-list-client.tsx` 693번줄:
```tsx
// Before
<div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-1 py-1">

// After
<div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-1">
```

710번줄 (정렬 그룹):
```tsx
// Before
<div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-1 py-1">

// After
<div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-1">
```

735번줄 (신호 그룹):
```tsx
// Before
<div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-1 py-1">

// After
<div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-1">
```

- [ ] **Step 2: dev 서버에서 확인**

`localhost:3000/stocks` 와 `localhost:3000/signals?tab=stock-analysis` 를 나란히 열기.
두 페이지의 필터 버튼 높이가 시각적으로 동일한지 확인.
1024px 데스크톱 뷰에서도 깨지지 않는지 확인.

- [ ] **Step 3: 커밋**

```bash
git add web/src/components/stocks/stock-list-client.tsx
git commit -m "fix: stocks 필터 그룹 py-1 제거로 signals 버튼 높이와 통일"
```

---

## 완료 기준 체크

- [ ] 모바일(375px) RankCard 종목명 2글자 이상 온전히 표시
- [ ] 점수 그리드 모바일 2×2, 데스크탑 4열
- [ ] 핫테마 배너 긴 테마명 말줄임표 처리
- [ ] 더보기 팝업 화면 이탈 없음
- [ ] stocks ↔ signals 필터 버튼 높이 동일
