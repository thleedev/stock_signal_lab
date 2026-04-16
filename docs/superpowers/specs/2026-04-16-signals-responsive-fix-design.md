# 설계 문서: Signals 페이지 반응형 수정 + 필터 UI 일관성

**날짜**: 2026-04-16
**범위**: signals 페이지 모바일 깨짐 수정 + stocks ↔ signals 종목분석 필터 UI 스타일 통일
**접근 방식**: 표적 수정 — 구조 변경 없이 Tailwind 클래스와 스타일만 교정

---

## 1. 배경 및 문제

지속적인 기능 추가(테마 배지, 핫테마 배너, 필터 바 등)로 signals 페이지가 모바일(375–414px)에서 깨지고, stocks 페이지와 종목분석 탭 간 필터 UI 스타일이 일관되지 않음.

### 주요 문제 목록

| # | 위치 | 문제 |
|---|------|------|
| 1 | `UnifiedAnalysisSection` / RankCard | 종목명 `max-w-[6rem]` (≈48px) → 모바일에서 "삼성전" 수준으로 잘림 |
| 2 | `AiRecommendationSection` | 점수 그리드 `grid-cols-4` 고정 → 모바일에서 각 셀 ≈90px로 너무 촘촘 |
| 3 | `HotThemesBanner` | 테마명 `whitespace-nowrap` → 긴 이름 줄바꿈 불가 |
| 4 | `RecommendationFilterBar` | 더보기 팝업 `w-56`(224px) 고정 → 375px 폰에서 화면 거의 가득 참 |
| 5 | `stock-list-client` ↔ `RecommendationFilterBar` | 버튼 높이·폰트·padding이 미묘하게 달라 UI 톤 불일치 |

---

## 2. 수정 설계

### 섹션 A: 모바일 깨짐 수정

#### A-1. RankCard 종목명 너비 (`UnifiedAnalysisSection.tsx`)

**변경 전**
```tsx
className="... truncate max-w-[6rem] sm:max-w-[10rem]"
```

**변경 후**
```tsx
className="... truncate max-w-[8rem] sm:max-w-[12rem]"
```

- 모바일: 48px → 128px(8rem)으로 확대
- sm 이상: 160px → 192px(12rem)으로 확대
- 줄1 gap: `gap-1.5` → `gap-1` 로 좁혀 공간 확보

#### A-2. 점수 그리드 반응형화 (`AiRecommendationSection.tsx` 내 RecommendationCard)

**변경 전**
```tsx
<div className="grid grid-cols-4 gap-1 mt-3 text-center">
  <div className="... p-1">
```

**변경 후**
```tsx
<div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mt-3 text-center">
  <div className="... p-1.5">
```

- 모바일: 4열 → 2×2 배치
- 셀 패딩 `p-1` → `p-1.5` (2×2일 때 여유 공간 활용)

#### A-3. HotThemesBanner 테마명 처리 (`HotThemesBanner.tsx`)

**변경 전**
```tsx
<span className="... whitespace-nowrap">
  {theme.name}
</span>
```

**변경 후**
```tsx
<span className="... max-w-[7rem] truncate">
  {theme.name}
</span>
```

- `whitespace-nowrap` 제거
- `max-w-[7rem] truncate` 추가 → 너무 긴 이름은 말줄임표 처리

#### A-4. 더보기 팝업 너비 (`RecommendationFilterBar.tsx`)

**변경 전**
```tsx
className="... w-56 ..."
```

**변경 후**
```tsx
className="... w-56 max-w-[calc(100vw-2rem)] ..."
```

- 화면 너비 초과 방지 (최소 좌우 1rem 여백 보장)

---

### 섹션 B: 필터 UI 스타일 통일

stocks와 signals 종목분석의 필터 버튼이 사용하는 스타일 기준을 `RecommendationFilterBar`의 버튼 스타일로 통일.

**통일 기준값**
```
font-size : text-xs
padding   : px-2.5 py-1
border-radius : rounded-md
height    : h-7 (28px)
```

#### B-1. stocks 필터 버튼 스타일 (`stock-list-client.tsx`)

시장 필터(전체/KOSPI/KOSDAQ/ETF) 및 신호 필터 버튼의 padding·font·border-radius를 위 기준값에 맞춤.
정렬 `<select>` 드롭다운: `h-7 text-xs` 로 높이 통일 (구조는 유지).

---

## 3. 변경 파일 목록

| 파일 | 변경 내용 |
|------|---------|
| `web/src/components/signals/UnifiedAnalysisSection.tsx` | A-1: RankCard 종목명 max-w 확대, gap 축소 |
| `web/src/components/signals/AiRecommendationSection.tsx` | A-2: 점수 그리드 grid-cols-2 sm:grid-cols-4 |
| `web/src/components/signals/HotThemesBanner.tsx` | A-3: whitespace-nowrap 제거, max-w truncate |
| `web/src/components/signals/RecommendationFilterBar.tsx` | A-4: 팝업 max-w calc 추가 |
| `web/src/components/stocks/stock-list-client.tsx` | B-1: 필터 버튼 스타일 통일 |

---

## 4. 비변경 항목

- 필터 컴포넌트 구조 (공용 컴포넌트 추출 없음)
- 정렬 UI 방식 (stocks: select 유지, signals: ButtonGroup 유지)
- 모바일 탭 바 / 사이드바 레이아웃
- 테이블 vs 카드 레이아웃 방식
- API, 데이터 페칭 로직

---

## 5. 성공 기준

- [ ] 모바일(375px) 에서 RankCard 종목명이 최소 2글자 이상 온전히 표시됨
- [ ] 점수 그리드가 모바일에서 2×2 배치로 전환됨
- [ ] HotThemesBanner 테마명이 너무 길면 말줄임표로 처리됨
- [ ] 더보기 팝업이 화면 밖으로 나가지 않음
- [ ] stocks와 signals 종목분석 필터 버튼의 높이·폰트가 동일하게 보임
