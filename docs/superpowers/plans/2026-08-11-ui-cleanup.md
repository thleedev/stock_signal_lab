# UI 마무리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/investment` 모바일에서 접근할 수 없던 5개 값을 되살리고, `/stocks`의 768px 오버플로를 없애며, 죽은 UI 컴포넌트 네 개를 정리합니다.

**Architecture:** 앞선 사이클이 만든 `StackedList`를 `/investment`에 적용합니다. 이 테이블의 가장 늦은 컬럼이 `lg`이므로 `breakpoint="lg"`를 씁니다. `/stocks` 필터 바에는 `flex-wrap`을 더하고, 소비처가 0인 UI 컴포넌트는 삭제합니다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, Vitest, Playwright MCP(검증용)

## Global Constraints

근거가 되는 설계 문서는 `docs/superpowers/specs/2026-08-11-ui-cleanup-design.md`입니다. 모든 주석과 커밋 메시지는 한국어로 작성하며 `Co-Authored-By` 줄은 넣지 않습니다. 경로 별칭 `@/`는 `web/src/`를 가리키고 모든 명령은 `web/` 디렉터리에서 실행합니다.

디자인 토큰 규칙(`.claude/steering/design-tokens.md`)을 따릅니다. 색상은 `var(--...)` 변수를 쓰고, 카드 패딩은 `p-4` 또는 `p-8`, 카드 라운드는 `rounded-xl`, hover는 `hover:bg-[var(--card-hover)]`입니다. 이 문서는 앞선 사이클에서 갱신되어 `StackedList` 병용 규칙과 전환점 정합 규칙을 담고 있으니 먼저 읽으십시오.

Vitest는 `src/**/*.test.ts`만 `node` 환경에서 돌리므로 **컴포넌트 단위 테스트를 작성할 수 없습니다.** 검증은 브라우저 실측이 담당합니다. 기존 테스트 287개는 계속 통과해야 합니다.

저장소에는 이번 작업과 무관한 기존 lint 오류 12건과 tsc 오류 2건(`earnings-momentum-score.test.ts`의 `targetPrice`)이 있습니다. 만진 파일에서 새 오류가 생기지 않았는지만 확인하면 됩니다.

**앞선 사이클의 교훈.** 카드 전환점이 컬럼이 나타나는 브레이크포인트보다 이르면 그 사이 폭에서 정보가 사라집니다. 이 실수가 세 번 발생했습니다. 데이터 행뿐 아니라 빈 상태 문구 같은 부속 요소의 브레이크포인트도 함께 맞춰야 합니다.

**검증 중 절대 하지 말 것.** 이 프로젝트는 운영 DB에 직접 연결됩니다. 앞선 사이클에서 브라우저 자동화로 즐겨찾기 별을 클릭해 실제 사용자 데이터가 삭제된 사고가 있었습니다. `/investment`는 투자 기록을 다루므로 특히 주의합니다. 액션 버튼, 즐겨찾기 별, 관심그룹 변경, 매매 등록·삭제, 메모 저장, 설정 변경을 하지 않습니다. 페이지 열기, 정렬·필터 변경, 검색어 입력, 스크롤, 탭 전환만 허용합니다.

---

### Task 1: /investment 모바일 카드 전환

9열 중 5열이 접근 불가인 상태를 해소합니다.

**Files:**
- Modify: `web/src/components/investment/investment-client.tsx:319-332` (테이블 래퍼와 헤더), 그리고 `<tbody>` 내부의 행 렌더

**Interfaces:**
- Consumes: `StackedList` (`@/components/ui`). props는 `items`, `keyOf`, `renderCard`, `onItemClick`, `breakpoint`, `children`이며 `breakpoint`는 `"md"` 또는 `"lg"`로 기본값이 `"md"`입니다. 빈 상태는 처리하지 않고 페이지 책임으로 둡니다.
- Produces: 없음

- [ ] **Step 1: 현재 구조와 참고 구현 파악**

이 파일은 426줄입니다. `:319`의 `card overflow-hidden` 래퍼, `:320`의 `overflow-x-auto`, `:321`의 `<table>`, `:322-333`의 `<thead>`, `:335`부터의 `<tbody>` 구조를 확인하십시오.

`<tbody>` 안의 `watchlist.map` 콜백이 `currentPrice`, `change`, `buyPrice`, `profitPct`, `stopLoss`, `target`, `nearStopLoss`, `nearTarget`을 계산합니다(`:336-353`). 카드도 같은 계산을 써야 두 표시가 어긋나지 않습니다.

`/my-portfolio`가 같은 구조에서 이미 카드 전환을 마쳤습니다. `web/src/app/my-portfolio/page.tsx:460-553`을 읽으면 패턴을 빨리 파악할 수 있습니다.

빈 상태는 `:310-317`에서 이미 자체 처리합니다. 건드리지 마십시오.

- [ ] **Step 2: 전환점 확인**

테이블 헤더에서 가장 늦게 나타나는 컬럼의 브레이크포인트를 직접 확인하십시오.

Run: `cd web && grep -n "hidden .*:table-cell" src/components/investment/investment-client.tsx`
Expected: `md:table-cell` 두 개(코드, 구매가)와 `lg:table-cell` 세 개(손절가, 목표가, 액션)

가장 늦은 것이 `lg`이므로 `StackedList`에 `breakpoint="lg"`를 넘깁니다. `md`를 쓰면 768~1023px에서 손절가·목표가·액션이 사라집니다.

- [ ] **Step 3: 카드 렌더 함수 작성**

`<tbody>` 안의 계산 로직을 카드와 공유할 수 있도록 정리한 뒤 카드를 그립니다. 계산식을 복사해 두 벌로 두지 말고 한 곳에서 뽑아 쓰는 구조를 만드십시오.

카드는 두 줄입니다. 윗줄에 종목명과 코드, 현재가, 등락률, 수익률을 둡니다. 아랫줄에 구매가, 손절가, 목표가를 둡니다. 수익률은 이 화면의 핵심 지표이므로 윗줄에서 눈에 띄게 배치하십시오.

가격 포맷과 수익률 색상은 기존 테이블 행이 쓰는 로직을 그대로 부르십시오. 새로 만들면 같은 종목이 폭에 따라 다르게 보입니다.

`nearStopLoss`와 `nearTarget`일 때 테이블 행은 `bg-blue-900/10`과 `bg-red-900/10`으로 배경을 강조합니다(`:356-358`). 카드에서도 같은 상태를 알 수 있게 하십시오. 배경색을 쓰든 텍스트 색상을 쓰든 무방하나, 근접 여부가 드러나야 합니다.

값이 없는 항목은 자리를 차지하지 않게 처리하십시오.

액션 버튼은 카드에서도 접근 가능해야 합니다. 버튼 클릭이 카드 클릭과 겹치지 않도록 `e.stopPropagation()`을 넣으십시오.

- [ ] **Step 4: StackedList 로 감싸기**

`import { StackedList } from "@/components/ui";`를 추가합니다. 이 파일이 이미 `@/components/ui`에서 무언가를 import 하고 있다면 그 줄에 합치십시오.

`<table>` 전체를 `children`으로 넘깁니다. `<tbody>`만 감싸면 테이블 구조가 깨집니다. `:319`의 `card overflow-hidden` 래퍼 안에 `StackedList`를 배치해 `.card`가 중첩되지 않게 하십시오.

`breakpoint="lg"`를 잊지 마십시오.

- [ ] **Step 5: 타입 검사와 린트**

Run: `cd web && npx tsc --noEmit 2>&1 | grep -v earnings-momentum-score && npm run lint 2>&1 | tail -3`
Expected: 새 오류 없음

- [ ] **Step 6: 네 폭 브라우저 실측**

개발 서버를 백그라운드로 띄웁니다.

```bash
cd web && npm run dev
```

Playwright로 `/investment`를 375px, 900px, 1100px, 1280px 네 폭에서 열고 각각 다음을 실행합니다. 900px은 `md`를 넘었지만 `lg` 미만인 구간이고 1100px은 `lg`를 막 넘긴 지점입니다.

```js
() => {
  const t = document.querySelector('table');
  const ths = t ? [...t.querySelectorAll('thead th')] : [];
  const text = document.body.innerText;
  return {
    w: window.innerWidth,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    hasCode: /코드/.test(text),
    hasBuyPrice: /구매가/.test(text),
    hasStopLoss: /손절가/.test(text),
    hasTarget: /목표가/.test(text),
    tableVisibleCols: ths.filter(th => th.offsetParent !== null).length,
    tableTotalCols: ths.length,
  };
}
```

Expected: 네 폭 모두에서 `overflow`가 0 이하이고 `hasCode`·`hasBuyPrice`·`hasStopLoss`·`hasTarget`이 모두 true입니다. 1280px에서는 `tableVisibleCols`가 9여야 합니다.

375px과 900px에서 값이 하나라도 false면 전환점이 잘못된 것입니다. Step 2로 돌아가 확인하십시오.

확인이 끝나면 개발 서버를 종료하십시오.

- [ ] **Step 7: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/components/investment/investment-client.tsx
git commit -m "feat: /investment 모바일 카드 전환으로 숨겨진 5개 값 복구

375px 에서 9열 중 4열만 보이고 가로 스크롤도 없어 코드·구매가·
손절가·목표가와 액션에 접근할 수 없었습니다. 가장 늦은 컬럼이
lg 이므로 카드 전환점도 lg 로 맞췄습니다."
```

---

### Task 2: 잔여 정리와 통합 검증

`/stocks`의 768px 오버플로를 없애고 죽은 UI 컴포넌트를 걷어낸 뒤 전체를 검증합니다.

**Files:**
- Modify: `web/src/components/stocks/stock-list-client.tsx:746`
- Delete: `web/src/components/ui/EmptyState.tsx`, `Card.tsx`, `PriceText.tsx`, `SectionTitle.tsx`
- Modify: `web/src/components/ui/index.ts`
- Modify: `docs/superpowers/specs/2026-08-11-ui-cleanup-design.md` (측정 결과 추가)

**Interfaces:**
- Consumes: Task 1의 결과
- Produces: 없음

- [ ] **Step 1: 필터 바 오버플로 수정**

`web/src/components/stocks/stock-list-client.tsx:746`의 다음 줄을 찾습니다.

```tsx
        <div className="flex flex-col sm:flex-row gap-3">
```

다음으로 교체합니다.

```tsx
        {/* flex-wrap 이 없으면 640px 이상에서 네 자식이 한 줄에 강제되어
            버튼 그룹의 min-content 폭 합계가 컨테이너를 넘칩니다. */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
```

- [ ] **Step 2: 768px 에서 수정 확인**

개발 서버를 띄우고 Playwright로 768px에서 `/stocks`를 열어 확인합니다.

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

Expected: `overflow`가 0 이하, `offenders`가 빈 배열. 수정 전에는 77px이었습니다.

이어서 640px과 1024px에서도 재서 다른 폭이 깨지지 않았는지 확인하십시오. 필터가 줄바꿈된 뒤에도 시장·정렬·신호 선택이 모두 보이고 조작 가능한지 눈으로 보십시오.

- [ ] **Step 3: 죽은 컴포넌트 소비처 재확인**

삭제 전에 각각의 소비처가 정말 0인지 확인합니다.

Run: `cd web && for c in EmptyState Card PriceText SectionTitle; do echo "--- $c ---"; grep -rn "\b$c\b" src/ --include="*.tsx" --include="*.ts" | grep -v "ui/$c.tsx" | grep -v "ui/index.ts"; done`

Expected: `EmptyState`, `PriceText`, `SectionTitle`은 아무것도 나오지 않습니다. `Card`는 `ui/EmptyState.tsx`의 세 줄(import와 사용)만 나옵니다.

`Card`가 다른 곳에서도 나오면 그 컴포넌트는 삭제 대상에서 빼고 그 사실을 보고서에 기록하십시오. `PriceText`나 `SectionTitle`도 마찬가지입니다.

주의할 점이 있습니다. `Card`는 흔한 단어라 `StockCard`, `SignalCard`, `CardSignal` 같은 다른 이름에 섞여 나올 수 있습니다. `\b` 경계를 썼지만 결과를 눈으로 확인하십시오.

- [ ] **Step 4: 삭제와 export 정리**

`EmptyState`를 먼저 지운 뒤 `Card`를 지웁니다. `Card`의 유일한 소비처가 `EmptyState`이기 때문입니다.

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
rm web/src/components/ui/EmptyState.tsx
rm web/src/components/ui/Card.tsx
rm web/src/components/ui/PriceText.tsx
rm web/src/components/ui/SectionTitle.tsx
```

`web/src/components/ui/index.ts`에서 다음 네 줄을 찾아 삭제합니다.

```ts
export { SectionTitle } from "./SectionTitle";
export { Card } from "./Card";
export { EmptyState } from "./EmptyState";
export { PriceText } from "./PriceText";
```

파일에 남는 것은 `PageLayout`, `PageHeader`, `SourceBadge`, `SignalBadge`, `StackedList` export입니다.

- [ ] **Step 5: 전체 검증**

Run: `cd web && npx tsc --noEmit 2>&1 | grep -v earnings-momentum-score && npm run test 2>&1 | tail -4 && npm run lint 2>&1 | tail -3 && npm run build 2>&1 | grep -E "Compiled successfully|Failed|Error"`

Expected: tsc 새 오류 없음, 테스트 287개 통과, lint 12 errors / 60 warnings 수준 유지, 빌드 성공

삭제한 컴포넌트를 어딘가에서 import 하고 있었다면 여기서 빌드가 깨집니다. 깨지면 Step 3의 확인이 불충분했던 것이므로 되돌아가 다시 보십시오.

- [ ] **Step 6: 회귀 확인**

개발 서버를 띄우고 375px, 768px, 1280px 세 폭에서 `/`, `/investment`, `/stocks`, `/my-portfolio`, `/signals`를 열어 가로 오버플로가 0인지 확인하십시오.

Task 1이 바꾼 `/investment`와 Step 1이 바꾼 `/stocks`를 특히 보십시오. 삭제한 컴포넌트가 어디에도 쓰이지 않았으므로 다른 화면은 영향이 없어야 하지만, 실제로 그런지 눈으로 확인하십시오.

확인이 끝나면 개발 서버를 종료하십시오.

- [ ] **Step 7: 설계 문서에 측정 결과 기록**

`docs/superpowers/specs/2026-08-11-ui-cleanup-design.md` 끝에 "## 측정 결과" 절을 추가합니다.

개선 전후를 표로 정리하십시오. 개선 전 값은 문서의 "문제 진단" 절에 있습니다. `/investment` 9열 중 4열, `/stocks` 768px 77px 오버플로, 죽은 컴포넌트 4개입니다.

Task 1의 네 폭 측정 결과와 Step 2의 세 폭 측정 결과를 함께 남기십시오. 삭제한 컴포넌트 목록과 `ui/`에 남은 컴포넌트 목록도 적으면 다음 사람이 현황을 바로 압니다.

이 문서는 한국어 문체 검사 대상입니다. 서술은 -습니다/-입니다로 끝내고 "박혀/박아/박은", "본 작업", "~을 통해", "~에 대해", "~를 가진다", "~되어지다"를 쓰지 마십시오. 불릿이나 번호 목록이 7줄 이상 연속되면 저장이 거부되므로 긴 나열은 표로 쓰고 결론은 문단으로 쓰십시오.

- [ ] **Step 8: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/components/ docs/superpowers/specs/2026-08-11-ui-cleanup-design.md
git commit -m "fix: /stocks 768px 필터 바 오버플로 제거, 죽은 UI 컴포넌트 정리

flex-wrap 이 없어 640px 이상에서 버튼 그룹이 축소되지 않고
컨테이너를 77px 넘쳤습니다. 소비처가 0인 EmptyState, Card,
PriceText, SectionTitle 을 삭제했습니다."
```

---

## 자체 검토 결과

**스펙 커버리지** — 설계 문서의 세 항목이 모두 태스크에 대응합니다. 1절(`/investment` 카드)은 Task 1, 2절(`/stocks` 오버플로)은 Task 2 Step 1~2, 3절(죽은 컴포넌트)은 Task 2 Step 3~4입니다. 검증은 Task 2 Step 5~7입니다.

**전환점 정합** — `/investment`의 가장 늦은 컬럼이 `lg`임을 Step 2에서 확인하게 했고, Step 6의 900px 측정이 그 검증입니다. 앞선 사이클에서 이 실수가 세 번 나왔으므로 확인 단계를 명시적으로 분리했습니다.

**주의 사항** — 컴포넌트 단위 테스트를 쓸 수 없으므로 각 단계에 브라우저에서 실행할 측정 함수와 기대값을 구체적으로 적었습니다. `Card`는 흔한 단어라 다른 이름에 섞여 검색될 수 있어 Step 3에 주의를 명시했습니다.
