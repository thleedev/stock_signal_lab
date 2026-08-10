# 모바일 정보 밀도와 데스크톱 여백 개선 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모바일에서 접근할 수 없던 테이블 컬럼을 카드 레이아웃으로 되살리고, 375px 가로 오버플로를 없애며, 1920px 화면에서 33%가 놀던 여백을 활용합니다.

**Architecture:** 데이터 구조를 강제하지 않는 `StackedList` 컴포넌트를 만들어 `md` 미만에서는 페이지가 넘긴 `renderCard`로 카드를 그리고, `md` 이상에서는 기존 테이블을 그대로 통과시킵니다. 소비처가 없는 `ResponsiveTable`은 삭제합니다. 전역 컨테이너 폭과 간격 토큰은 브레이크포인트별로 조정합니다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, Vitest, Playwright MCP(검증용)

## Global Constraints

근거가 되는 설계 문서는 `docs/superpowers/specs/2026-08-10-mobile-density-desktop-width-design.md`입니다. 모든 주석과 커밋 메시지는 한국어로 작성하며, 커밋 메시지에 `Co-Authored-By` 줄은 넣지 않습니다. 경로 별칭 `@/`는 `web/src/`를 가리키고, 이 계획의 모든 명령은 `web/` 디렉터리에서 실행합니다.

디자인 토큰 규칙(`.claude/steering/design-tokens.md`)을 따릅니다. 색상은 `var(--...)` 변수를 쓰고 하드코딩하지 않으며, 카드 패딩은 `p-4`(기본) 또는 `p-8`(빈 상태), 카드 라운드는 `rounded-xl`, hover는 `hover:bg-[var(--card-hover)]`입니다. 소스·시그널 색상과 라벨은 `signal-constants.ts`의 상수를 쓰고 인라인으로 재정의하지 않습니다.

이 사이클은 UI 변경이 전부이고 Vitest는 `src/**/*.test.ts`만 `node` 환경에서 돌리므로 **컴포넌트 단위 테스트를 작성할 수 없습니다.** 검증은 브라우저 실측이 담당합니다. 각 태스크는 개발 서버를 띄우고 Playwright로 지정된 폭에서 값을 재서 확인합니다. 기존 테스트 287개는 계속 통과해야 합니다.

저장소에는 이번 작업과 무관한 기존 lint 오류 12건과 tsc 오류 2건(`earnings-momentum-score.test.ts`의 `targetPrice`)이 있습니다. 만진 파일에서 새 오류가 생기지 않았는지만 확인하면 됩니다.

**검증 중 절대 하지 말 것.** 이 프로젝트는 운영 DB에 직접 연결됩니다. 앞선 사이클에서 브라우저 자동화로 즐겨찾기 별을 클릭해 실제 사용자 데이터가 삭제된 사고가 있었습니다. 즐겨찾기 별 클릭, 관심그룹 추가·삭제, 포트폴리오 담기, 메모 저장, 설정 변경을 하지 않습니다. 페이지 열기, 정렬·필터 변경, 검색어 입력, 스크롤, 탭 전환, 뷰 모드 전환은 읽기이므로 허용합니다.

---

### Task 1: StackedList 컴포넌트와 ResponsiveTable 정리

모바일 카드 전환을 담당할 공용 컴포넌트를 만들고, 소비처가 없는 죽은 코드를 걷어냅니다.

**Files:**
- Create: `web/src/components/ui/StackedList.tsx`
- Delete: `web/src/components/ui/ResponsiveTable.tsx`
- Modify: `web/src/components/ui/index.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `StackedList<T>` 컴포넌트. props는 `items: T[]`, `keyOf: (item: T) => string`, `renderCard: (item: T) => React.ReactNode`, `onItemClick?: (item: T, e: React.MouseEvent) => void`, `emptyMessage?: string`, `children: React.ReactNode`입니다. Task 2와 Task 3이 이것을 씁니다.

- [ ] **Step 1: ResponsiveTable 소비처가 정말 없는지 확인**

Run: `cd web && grep -rn "ResponsiveTable" src/ --include="*.tsx" --include="*.ts"`
Expected: `ui/ResponsiveTable.tsx` 자신과 `ui/index.ts`의 export 두 곳만 나와야 합니다. 다른 파일이 나오면 삭제를 멈추고 그 사실을 보고하십시오.

- [ ] **Step 2: StackedList 작성**

`web/src/components/ui/StackedList.tsx`를 새로 만듭니다.

```tsx
"use client";

import React from "react";

interface StackedListProps<T> {
  /** 카드로 그릴 항목 목록 */
  items: T[];
  /** React key 로 쓸 값을 뽑습니다 */
  keyOf: (item: T) => string;
  /** 카드 한 장의 내용을 그립니다. 카드 껍데기는 이 컴포넌트가 씌웁니다 */
  renderCard: (item: T) => React.ReactNode;
  /** 카드를 눌렀을 때의 동작 */
  onItemClick?: (item: T, e: React.MouseEvent) => void;
  /** 항목이 없을 때 보여줄 문구 */
  emptyMessage?: string;
  /** 데스크톱에서 그대로 보여줄 기존 테이블 */
  children: React.ReactNode;
}

/**
 * 좁은 화면에서는 카드를, 넓은 화면에서는 기존 테이블을 보여줍니다.
 *
 * 컬럼 스키마를 요구하지 않고 renderCard 로 카드 내용을 위임합니다.
 * 앞서 있던 ResponsiveTable 은 Column<T> 배열을 강제해 배지·팝오버·액션 메뉴가
 * 섞인 실제 테이블을 표현하지 못했고 결국 아무 곳에서도 쓰이지 않았습니다.
 *
 * 전환은 CSS 로만 처리합니다. 자바스크립트 판정을 쓰면 서버 렌더링 결과와
 * 어긋나 첫 페인트가 깜빡입니다.
 */
export function StackedList<T>({
  items,
  keyOf,
  renderCard,
  onItemClick,
  emptyMessage = "데이터가 없습니다",
  children,
}: StackedListProps<T>) {
  if (items.length === 0) {
    return (
      <div className="card p-8 text-center text-[var(--muted)]">{emptyMessage}</div>
    );
  }

  return (
    <>
      {/* 좁은 화면: 카드 목록 */}
      <div className="md:hidden divide-y divide-[var(--border)]">
        {items.map((item) => (
          <div
            key={keyOf(item)}
            onClick={onItemClick ? (e) => onItemClick(item, e) : undefined}
            className={`px-3 py-3 ${onItemClick ? "cursor-pointer hover:bg-[var(--card-hover)]" : ""}`}
          >
            {renderCard(item)}
          </div>
        ))}
      </div>

      {/* 넓은 화면: 기존 테이블 */}
      <div className="hidden md:block">{children}</div>
    </>
  );
}
```

- [ ] **Step 3: index.ts 갱신**

`web/src/components/ui/index.ts`에서 다음 줄을 찾습니다.

```ts
export { ResponsiveTable } from "./ResponsiveTable";
```

다음으로 교체합니다.

```ts
export { StackedList } from "./StackedList";
```

- [ ] **Step 4: ResponsiveTable 삭제**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
rm web/src/components/ui/ResponsiveTable.tsx
```

- [ ] **Step 5: 타입 검사와 린트**

Run: `cd web && npx tsc --noEmit 2>&1 | grep -v earnings-momentum-score && npm run lint 2>&1 | tail -3`
Expected: `earnings-momentum-score.test.ts` 외 새 오류가 없어야 합니다. lint 문제 수가 이전과 같거나 줄어야 합니다.

- [ ] **Step 6: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/components/ui/
git commit -m "feat: 모바일 카드 전환용 StackedList 추가, ResponsiveTable 삭제

ResponsiveTable 은 Column 배열을 강제해 실제 테이블을 표현하지 못했고
소비처가 하나도 없었습니다. renderCard 로 카드 내용을 위임하는 방식으로
바꿔 배지와 액션 메뉴가 섞인 목록도 담을 수 있게 했습니다."
```

---

### Task 2: /stocks 모바일 카드 적용

모바일에서 사라지던 7개 값을 되살립니다. 정보 손실이 가장 큰 화면입니다.

**Files:**
- Modify: `web/src/components/stocks/stock-list-client.tsx`

**Interfaces:**
- Consumes: Task 1의 `StackedList`
- Produces: 없음

- [ ] **Step 1: 현재 구조 파악**

이 파일은 1,000줄이 넘습니다. 먼저 다음을 읽어 구조를 파악하십시오.

`tableHeader` 정의(약 665행), `<tbody>` 두 곳(약 803행의 즐겨찾기용, 약 873행의 일반 목록용), `StockRow` memo 컴포넌트(약 956행), 그리고 `displayStocks`가 `favs`와 `nonFavs`로 나뉘는 지점입니다.

`StockRow`가 받는 props와 렌더하는 값을 확인하십시오. 카드도 같은 값을 써야 두 화면의 표시가 어긋나지 않습니다.

- [ ] **Step 2: 카드 렌더 함수 작성**

`StockRow` 정의 근처에 카드용 컴포넌트를 추가합니다. `StockRow`가 쓰는 표시 로직(가격 포맷, 등락률 색상, 신호 배지)을 그대로 재사용하십시오. 새로 만들지 말고 기존 헬퍼를 부르십시오.

카드는 두 줄로 구성합니다. 윗줄에 즐겨찾기 별, 종목명과 코드, 현재가, 등락률을 둡니다. 아랫줄에 알파캐치·라씨·스톡봇 배지 3종을 먼저 두고 Gap, 거래량, PER을 작은 글씨로 나열합니다.

값이 없는 항목은 자리를 차지하지 않게 처리합니다. 카드가 세로로 길어지면 목록을 훑기 어려워집니다.

즐겨찾기 별은 카드 클릭과 분리해야 합니다. 별을 누를 때 `e.stopPropagation()`으로 카드 클릭이 함께 발생하지 않게 하십시오. 기존 테이블 행이 같은 처리를 하고 있으니 그 방식을 따르십시오.

- [ ] **Step 3: StackedList 로 감싸기**

`<tbody>` 두 곳을 각각 `StackedList`로 감쌉니다. `items`에는 해당 목록(`displayStocks.favs` 또는 `displayStocks.nonFavs`)을 넘기고, `children`에는 기존 `<table>` 마크업 전체를 그대로 넘깁니다.

`import { StackedList } from "@/components/ui";`를 추가하십시오.

주의할 점이 있습니다. `<table>`은 `StackedList`의 `children`으로 들어가므로 `<thead>`와 `<tbody>`가 함께 있어야 합니다. `<tbody>`만 감싸면 테이블 구조가 깨집니다. 감싸는 단위는 `<table>` 전체입니다.

드래그 앤 드롭(`DndContext`, `@dnd-kit`)이 이 목록에 걸려 있다면 카드 쪽에서도 동작해야 하는지 판단하십시오. 모바일에서 드래그 정렬이 필요 없다면 카드에는 걸지 않아도 됩니다. 어느 쪽을 택했는지 보고서에 남기십시오.

- [ ] **Step 4: 타입 검사와 린트**

Run: `cd web && npx tsc --noEmit 2>&1 | grep -v earnings-momentum-score && npm run lint 2>&1 | tail -3`
Expected: 새 오류 없음

- [ ] **Step 5: 브라우저 실측 검증**

개발 서버를 백그라운드로 띄웁니다.

```bash
cd web && npm run dev
```

Playwright로 375px에서 `/stocks`를 열고 다음 함수를 실행해 사라지던 값이 실제로 나오는지 확인합니다.

```js
() => {
  const de = document.documentElement;
  const text = document.body.innerText;
  return {
    overflow: de.scrollWidth - window.innerWidth,
    hasCards: document.querySelectorAll('.md\\:hidden [class*="cursor-pointer"]').length,
    // 사라지던 값들이 화면 텍스트에 나타나는지
    hasGap: /Gap|갭/.test(text),
    hasVolume: /거래량/.test(text),
    hasPer: /PER/.test(text),
    hasSignals: /라씨|스톡봇|알파캐치/.test(text),
  };
}
```

Expected: `overflow`가 0 이하, `hasCards`가 0보다 큼, 나머지 네 항목이 모두 true

이어서 1280px로 넓혀 기존 테이블이 그대로 나오는지 확인합니다. 컬럼 11개가 모두 보여야 합니다.

```js
() => {
  const t = document.querySelector('table');
  const ths = [...t.querySelectorAll('thead th')];
  return {
    total: ths.length,
    visible: ths.filter(th => th.offsetParent !== null).length,
  };
}
```

Expected: 1280px에서 `total`이 11, `visible`이 11

확인이 끝나면 개발 서버를 종료하십시오.

- [ ] **Step 6: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/components/stocks/stock-list-client.tsx
git commit -m "feat: /stocks 모바일 카드 전환으로 숨겨진 7개 값 복구

375px 에서 컬럼 11개 중 4개만 보이고 가로 스크롤도 없어
라씨·스톡봇·알파캐치 신호와 Gap·거래량·PER·코드에 접근할 수
없었습니다. 카드 두 줄로 모두 표시합니다."
```

---

### Task 3: /my-portfolio 모바일 카드 적용

매수가·손절가·목표가를 모바일에서 되살립니다. 보유 종목 판단에 필요한 값입니다.

**Files:**
- Modify: `web/src/app/my-portfolio/page.tsx`

**Interfaces:**
- Consumes: Task 1의 `StackedList`
- Produces: 없음

- [ ] **Step 1: 현재 구조 파악**

`web/src/app/my-portfolio/page.tsx`의 약 461행에 `<table>`이 있고 약 470행에 `손절가`·`목표가` 헤더가 있습니다. 이 테이블이 렌더하는 행 구조와 각 셀의 값 계산 로직을 확인하십시오.

이 파일은 654줄이고 클라이언트 컴포넌트입니다. 행 클릭과 액션 버튼의 동작을 파악한 뒤 카드에서도 같게 동작하도록 맞추십시오.

- [ ] **Step 2: 카드 렌더 함수 작성**

윗줄에 종목명과 코드, 현재가, 등락률, 수익률을 둡니다. 아랫줄에 매수가, 손절가, 목표가, 등급을 둡니다.

수익률은 이 화면의 핵심 지표이므로 윗줄에서 눈에 띄게 배치하십시오. 색상은 기존 테이블이 쓰는 것과 같은 방식을 따르십시오. 새 색상을 정의하지 마십시오.

행 끝의 액션 버튼은 카드에서도 접근할 수 있어야 합니다. 버튼 클릭이 카드 클릭과 겹치지 않도록 `e.stopPropagation()`을 넣으십시오.

- [ ] **Step 3: StackedList 로 감싸기**

`<table>` 전체를 `StackedList`의 `children`으로 넘기고 `items`에 목록 데이터를 넘깁니다.

`import { StackedList } from "@/components/ui";`를 추가하십시오. 이 파일이 이미 `@/components/ui`에서 무언가를 import 하고 있다면 그 줄에 합치십시오.

- [ ] **Step 4: 타입 검사와 린트**

Run: `cd web && npx tsc --noEmit 2>&1 | grep -v earnings-momentum-score && npm run lint 2>&1 | tail -3`
Expected: 새 오류 없음

- [ ] **Step 5: 브라우저 실측 검증**

개발 서버를 띄우고 375px에서 `/my-portfolio`를 열어 확인합니다.

```js
() => {
  const de = document.documentElement;
  const text = document.body.innerText;
  return {
    overflow: de.scrollWidth - window.innerWidth,
    hasBuyPrice: /매수가/.test(text),
    hasStopLoss: /손절가/.test(text),
    hasTarget: /목표가/.test(text),
    hasGrade: /등급/.test(text),
  };
}
```

Expected: `overflow`가 0 이하, 나머지 네 항목이 모두 true

1280px에서 기존 테이블이 컬럼 10개를 모두 보여주는지도 확인하십시오.

확인이 끝나면 개발 서버를 종료하십시오.

- [ ] **Step 6: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/app/my-portfolio/page.tsx
git commit -m "feat: /my-portfolio 모바일 카드 전환으로 숨겨진 5개 값 복구

375px 에서 매수가·손절가·목표가·등급·코드가 보이지 않아
보유 종목을 판단할 근거가 없었습니다."
```

---

### Task 4: 가로 오버플로 수정과 전 페이지 점검

`/signals`의 40px 오버플로를 없애고, 다른 페이지에도 같은 문제가 있는지 재서 고칩니다.

**Files:**
- Modify: `web/src/app/signals/signal-filter-bar.tsx:96`
- Modify: 점검에서 오버플로가 발견된 파일

**Interfaces:**
- Consumes: 없음
- Produces: 없음

- [ ] **Step 1: 필터 줄 수정**

`web/src/app/signals/signal-filter-bar.tsx:96`의 다음 줄을 찾습니다.

```tsx
    <div className="flex items-center gap-2 flex-nowrap">
```

다음으로 교체합니다. 바깥 요소가 가로 스크롤을 담당하고 안쪽이 줄바꿈을 막습니다.

```tsx
    // 좁은 화면에서 버튼 묶음이 페이지 전체를 밀어내지 않도록
    // 바깥이 가로 스크롤을 맡고 안쪽만 줄바꿈을 막습니다.
    <div className="overflow-x-auto -mx-1 px-1">
      <div className="flex items-center gap-2 flex-nowrap w-max">
```

닫는 태그도 하나 더 추가해야 합니다. 이 컴포넌트의 반환 JSX 끝에서 `</div>`를 하나 더 넣으십시오.

스크롤바가 보이면 지저분하므로 필요하면 `globals.css`의 스크롤바 스타일을 확인하십시오. 이 프로젝트는 이미 6px 얇은 스크롤바를 정의하고 있습니다.

- [ ] **Step 2: 375px 에서 수정 확인**

개발 서버를 띄우고 Playwright로 375px에서 `/signals`를 열어 확인합니다.

```js
() => {
  const de = document.documentElement;
  const off = [];
  document.querySelectorAll('*').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > window.innerWidth + 1) {
      off.push({ tag: el.tagName.toLowerCase(), cls: (el.className||'').toString().slice(0,60) });
    }
  });
  return { overflow: de.scrollWidth - window.innerWidth, offenders: off.slice(0,5) };
}
```

Expected: `overflow`가 0 이하, `offenders`가 빈 배열

수정 전에는 `overflow`가 40이고 `offenders`에 `flex items-center gap-2 flex-nowrap`이 있었습니다.

- [ ] **Step 3: 나머지 페이지 점검**

같은 함수로 다음 경로를 375px에서 하나씩 재십시오. `/`, `/stocks`, `/my-portfolio`, `/market`, `/portfolio`, `/reports`, `/compare`, `/investment`입니다.

`overflow`가 0보다 큰 페이지가 있으면 `offenders`에서 원인 요소를 찾아 Step 1과 같은 방식으로 고치십시오. 원인이 `flex-nowrap`이 아닌 경우도 있으니 실제 클래스를 보고 판단하십시오. 고정 폭(`w-[...]`)이나 `min-w`가 원인이면 그에 맞게 처리하십시오.

측정 결과를 페이지별로 표로 정리해 보고서에 남기십시오. 고친 페이지와 원래 문제가 없던 페이지를 구분해 적으십시오.

- [ ] **Step 4: 타입 검사와 린트**

Run: `cd web && npx tsc --noEmit 2>&1 | grep -v earnings-momentum-score && npm run lint 2>&1 | tail -3`
Expected: 새 오류 없음

확인이 끝나면 개발 서버를 종료하십시오.

- [ ] **Step 5: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/app/
git commit -m "fix: 375px 가로 오버플로 제거

/signals 필터 줄의 flex-nowrap 이 페이지 전체를 40px 밀어냈습니다.
바깥이 가로 스크롤을 맡고 안쪽만 줄바꿈을 막도록 나눴습니다."
```

---

### Task 5: 데스크톱 폭 확장과 그리드 열 추가

1920px에서 33%가 놀던 여백을 씁니다.

**Files:**
- Modify: `web/src/app/layout.tsx`
- Modify: 그리드가 있는 페이지와 대응하는 `loading.tsx`

**Interfaces:**
- Consumes: 없음
- Produces: 없음

- [ ] **Step 1: 컨테이너 폭 확장**

`web/src/app/layout.tsx`에서 다음 줄을 찾습니다.

```tsx
              <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
```

다음으로 교체합니다.

```tsx
              <div className="max-w-[1600px] mx-auto px-3 sm:px-4 py-4 sm:py-6">
```

- [ ] **Step 2: 그리드 열 추가 대상 확인**

Run: `cd web && grep -rn "lg:grid-cols-4\|md:grid-cols-3" src/app src/components --include="*.tsx"`

나온 목록을 보고 각 그리드가 무엇을 담는지 확인하십시오. 통계 카드처럼 내용이 짧으면 열을 늘려도 되지만, 종목명과 여러 숫자가 들어가는 카드는 좁아지면 읽기 어려워집니다.

- [ ] **Step 3: 2xl 열 추가**

내용이 짧아 좁아져도 읽히는 그리드에만 `2xl` 열을 더합니다. `lg:grid-cols-4`에는 `2xl:grid-cols-5`를, `md:grid-cols-3`에는 `2xl:grid-cols-4`를 추가합니다.

`loading.tsx`의 스켈레톤 그리드도 대응하는 페이지와 같은 클래스로 맞추십시오. 어긋나면 로딩 중과 로딩 후에 열 수가 달라져 화면이 튑니다.

열을 늘리지 않기로 판단한 그리드가 있으면 그 이유를 보고서에 남기십시오.

- [ ] **Step 4: 1920px 실측 검증**

개발 서버를 띄우고 Playwright로 1920px에서 `/`를 열어 확인합니다.

```js
() => {
  const main = document.querySelector('main');
  const inner = main.querySelector(':scope > div');
  const ir = inner.getBoundingClientRect();
  const mr = main.getBoundingClientRect();
  const grids = [...document.querySelectorAll('[class*="grid-cols"]')].slice(0,6).map(g => ({
    cols: getComputedStyle(g).gridTemplateColumns.split(' ').length,
    cardWidth: Math.round(g.getBoundingClientRect().width / getComputedStyle(g).gridTemplateColumns.split(' ').length),
  }));
  return {
    contentWidth: Math.round(ir.width),
    unusedPct: Math.round((1 - ir.width / mr.width) * 100),
    grids,
  };
}
```

Expected: `contentWidth`가 1600, `unusedPct`가 20 이하, 그리드의 `cols`가 이전보다 늘어남

측정 전 값은 `contentWidth` 1280, `unusedPct` 33, 그리드 최대 4열이었습니다.

각 그리드의 `cardWidth`가 260px보다 좁아지면 카드가 찌그러질 수 있으니, 그런 그리드는 열 추가를 되돌리십시오.

- [ ] **Step 5: 좁은 폭 회귀 확인**

같은 페이지를 375px, 768px, 1280px에서 열어 레이아웃이 깨지지 않는지 확인하십시오. 특히 1280px은 기존 `max-w-7xl`과 같은 값이라 이전과 동일하게 보여야 합니다.

확인이 끝나면 개발 서버를 종료하십시오.

- [ ] **Step 6: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/app/
git commit -m "feat: 데스크톱 콘텐츠 폭을 1600px 로 확장하고 그리드 열 추가

1920px 화면에서 콘텐츠가 1280px 로 제한되어 33% 가 빈 공간이었습니다.
2xl 부터 그리드 열을 하나씩 늘려 넓어진 폭을 실제로 씁니다."
```

---

### Task 6: 간격 토큰 브레이크포인트 대응

단일 값이던 섹션 간격을 화면 폭에 맞춰 조정합니다.

**Files:**
- Modify: `web/src/app/globals.css:41`
- Modify: `.claude/steering/design-tokens.md`

**Interfaces:**
- Consumes: 없음
- Produces: 없음

- [ ] **Step 1: 간격 변수 브레이크포인트 대응**

`web/src/app/globals.css`의 `:root` 블록에서 다음 줄을 찾습니다.

```css
  --section-gap: 1.5rem;
```

다음으로 교체합니다.

```css
  --section-gap: 1rem;
```

그리고 `:root` 블록이 끝난 뒤, `@theme inline` 블록보다 앞에 다음을 추가합니다.

```css
/* 섹션 간격은 화면 폭에 맞춥니다.
   좁은 화면은 한 번에 더 담고, 넓은 화면은 구분을 뚜렷하게 합니다. */
@media (min-width: 768px) {
  :root { --section-gap: 1.5rem; }
}
@media (min-width: 1280px) {
  :root { --section-gap: 2rem; }
}
```

- [ ] **Step 2: 디자인 토큰 문서 갱신**

`.claude/steering/design-tokens.md`의 간격 절에서 다음 줄을 찾습니다.

```
- 섹션 간격: `space-y-6` 또는 `gap: var(--section-gap)` — **통일** (space-y-4, space-y-8 사용 금지)
```

다음으로 교체합니다.

```
- 섹션 간격: `var(--section-gap)` 을 쓰는 `.section-gap` 클래스 또는 `PageLayout` 사용
  - 값은 화면 폭에 따라 자동으로 바뀝니다. 모바일 1rem, `md` 이상 1.5rem, `xl` 이상 2rem
  - 고정값 `space-y-6` 을 섹션 간격으로 쓰지 않습니다. 브레이크포인트 대응이 사라집니다
```

이 문서는 한국어 문체 검사 대상입니다. 서술은 -습니다/-입니다로 끝내고 금지 표현을 쓰지 마십시오.

- [ ] **Step 3: 세 폭에서 간격 확인**

개발 서버를 띄우고 375px, 768px, 1280px에서 `/`를 열어 실제 간격을 잽니다.

```js
() => {
  const el = document.querySelector('.section-gap');
  return {
    viewport: window.innerWidth,
    gap: getComputedStyle(el).gap,
    sectionGapVar: getComputedStyle(document.documentElement).getPropertyValue('--section-gap').trim(),
  };
}
```

Expected: 375px에서 1rem(16px), 768px에서 1.5rem(24px), 1280px에서 2rem(32px)

- [ ] **Step 4: 시각 확인**

같은 세 폭에서 화면이 어색하지 않은지 눈으로 보십시오. 모바일에서 섹션이 너무 붙어 구분이 안 되거나, 데스크톱에서 지나치게 벌어져 허전하면 값을 조정하고 그 근거를 보고서에 남기십시오.

확인이 끝나면 개발 서버를 종료하십시오.

- [ ] **Step 5: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/app/globals.css .claude/steering/design-tokens.md
git commit -m "feat: 섹션 간격을 화면 폭에 맞춰 조정

단일 값 1.5rem 이던 --section-gap 을 모바일 1rem, md 이상 1.5rem,
xl 이상 2rem 으로 나눴습니다. 디자인 토큰 문서도 함께 갱신했습니다."
```

---

### Task 7: 범위 밖 페이지 측정과 통합 검증

다음 사이클의 우선순위를 정할 근거를 남기고 전체를 검증합니다.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-10-mobile-density-desktop-width-design.md`

**Interfaces:**
- Consumes: Task 1~6의 결과 전부
- Produces: 없음

- [ ] **Step 1: 전체 테스트와 빌드**

Run: `cd web && npm run test && npm run lint 2>&1 | tail -3 && npm run build 2>&1 | tail -5`
Expected: 테스트 287개 통과, lint 문제 수가 이전과 같거나 감소, 빌드 성공

- [ ] **Step 2: 범위 밖 페이지의 모바일 손실 측정**

개발 서버를 띄우고 375px에서 `/reports`, `/compare`, `/investment`, `/market`을 열어 각각 다음을 실행합니다.

```js
() => {
  const tables = [...document.querySelectorAll('table')].map(t => {
    const wrap = t.closest('.overflow-x-auto');
    const ths = [...t.querySelectorAll('thead th')];
    return {
      cols: ths.length,
      visible: ths.filter(th => th.offsetParent !== null).length,
      hidden: ths.filter(th => th.offsetParent === null).map(th => th.textContent.trim().slice(0,10)),
      hasHScroll: wrap ? t.scrollWidth > wrap.clientWidth + 1 : false,
    };
  });
  return { url: location.pathname, overflow: document.documentElement.scrollWidth - window.innerWidth, tables };
}
```

가로 스크롤이 없으면서 컬럼이 숨겨지는 화면이 접근 불가 상태입니다. 그런 화면을 우선순위 높음으로 분류하십시오.

- [ ] **Step 3: 네 폭 전체 회귀 확인**

375px, 768px, 1280px, 1920px에서 `/`, `/signals`, `/stocks`, `/my-portfolio`를 열어 가로 오버플로가 0인지 다시 확인하십시오. 이번 변경이 다른 폭을 깨뜨리지 않았는지 보는 단계입니다.

`/stocks`와 `/my-portfolio`에서는 768px과 1280px에서 기존 테이블이 정상 표시되는지도 확인하십시오. `md`가 768px이므로 그 경계에서 카드와 테이블이 바뀝니다.

확인이 끝나면 개발 서버를 종료하십시오.

- [ ] **Step 4: 설계 문서에 측정 결과 기록**

`docs/superpowers/specs/2026-08-10-mobile-density-desktop-width-design.md` 끝에 "## 측정 결과" 절을 추가합니다.

개선 전후를 표로 정리하십시오. 개선 전 값은 문서의 "문제 진단" 절에 있습니다. `/stocks` 11개 중 4개, `/my-portfolio` 10개 중 5개, `/signals` 40px 오버플로, 1920px에서 콘텐츠 1280px과 미사용 33%입니다.

Step 2에서 측정한 범위 밖 페이지의 손실 정도도 함께 표로 남기고, 다음 사이클 우선순위를 한 문단으로 정리하십시오.

이 문서는 한국어 문체 검사 대상입니다. 불릿이나 번호 목록이 7줄 이상 연속되면 저장이 거부되므로 긴 나열은 표로 쓰고 결론은 문단으로 쓰십시오.

- [ ] **Step 5: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add docs/superpowers/specs/2026-08-10-mobile-density-desktop-width-design.md
git commit -m "docs: 모바일 밀도·데스크톱 폭 개선 전후 측정 결과 기록"
```

---

## 자체 검토 결과

**스펙 커버리지** — 설계 문서의 7개 절이 모두 태스크에 대응합니다. 1절(StackedList)은 Task 1, 2절(/stocks 카드)은 Task 2, 3절(/my-portfolio 카드)은 Task 3, 4절(ResponsiveTable 삭제)은 Task 1에 합쳤습니다. 5절(가로 오버플로)은 Task 4, 6절(데스크톱 폭)은 Task 5, 7절(간격 토큰)은 Task 6입니다. 검증과 범위 밖 측정은 Task 7입니다.

**타입 일관성** — `StackedList`의 props 이름(`items`, `keyOf`, `renderCard`, `onItemClick`, `emptyMessage`, `children`)을 Task 1에서 정의하고 Task 2와 Task 3이 같은 이름으로 씁니다.

**주의 사항** — 이 사이클은 컴포넌트 단위 테스트를 쓸 수 없습니다. Vitest가 `node` 환경에서 `.ts`만 돌리기 때문입니다. 각 태스크의 검증은 브라우저 실측이 담당하며, 재는 함수와 기대값을 단계마다 구체적으로 적었습니다.

Task 2의 `stock-list-client.tsx`는 1,000줄이 넘고 `<tbody>`가 두 곳입니다. `<tbody>`만 감싸면 테이블 구조가 깨지므로 `<table>` 전체를 감싸야 한다는 점을 계획에 명시했습니다.
