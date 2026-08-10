# 모바일 정보 밀도와 데스크톱 여백 개선 설계

작성일: 2026-08-10

## 배경

앞선 사이클에서 `/signals`와 `/stocks`의 표시 속도를 개선했습니다. 사용자가 함께 제기한
나머지 두 문제, 화면 간격 활용과 모바일 정보 밀도를 이 사이클에서 다룹니다.

개발 서버를 띄우고 브라우저로 직접 계측했습니다. 추측이 아닌 실측값입니다.

## 문제 진단

### 모바일 — 정보에 접근할 경로가 없습니다

375px 폭에서 `/stocks`의 테이블은 컬럼 11개 중 4개만 표시합니다. 나머지 7개는
`hidden sm:table-cell`, `hidden md:table-cell`, `hidden lg:table-cell`로 숨겨집니다.
감싸는 요소에 가로 스크롤이 걸리지 않으므로 숨겨진 값을 볼 방법이 아예 없습니다.

| 화면 | 전체 컬럼 | 표시 | 사라지는 값 |
|---|---|---|---|
| `/stocks` | 11 | 4 | Gap, 코드, 거래량, PER, 알파캐치, 라씨, 스톡봇 |
| `/my-portfolio` | 10 | 5 | 코드, 등급, 매수가, 손절가, 목표가 |

`/stocks`에서 사라지는 것에 라씨·스톡봇·알파캐치 신호 3종이 포함됩니다. 이 서비스의
핵심 정보가 모바일에서 통째로 보이지 않습니다. `/my-portfolio`에서는 매수가·손절가·목표가가
사라져 보유 종목을 판단할 근거가 없어집니다.

### 모바일 — 가로 오버플로

`/signals`는 375px에서 문서 스크롤 폭이 415px입니다. 40px이 화면 밖으로 밀려납니다.
원인은 날짜 필터바를 감싼 `flex items-center gap-2 flex-nowrap`입니다. `flex-nowrap`이
줄바꿈을 막아 내부 버튼 묶음(251px)이 컨테이너를 밀어냅니다.

`/stocks`와 `/my-portfolio`는 같은 폭에서 오버플로가 없습니다.

### 데스크톱 — 여백 낭비

1920px 폭에서 `main` 내부 콘텐츠가 1280px입니다. `layout.tsx`의 `max-w-7xl`이 상한이며,
좌우로 각각 200px씩 빈 공간이 남습니다. 사이드바 240px을 제외하고도 전체의 33%를 쓰지
않습니다. 대시보드의 카드 그리드는 `lg:grid-cols-4`가 최대라 1248px 안에 4열까지만
배치됩니다.

### ResponsiveTable 은 죽은 코드입니다

`web/src/components/ui/ResponsiveTable.tsx`는 `ui/index.ts`에서 export 되지만 실제
소비처가 없습니다. 반응형 테이블 문제를 이 컴포넌트가 해결하고 있으리라는 예상과 달리,
각 페이지가 `<table>`을 직접 구현합니다. 해당 마크업이 있는 파일은 10개입니다.

이 컴포넌트가 쓰이지 않는 이유는 컬럼 스키마를 강제하는 구조 때문으로 보입니다. 각
페이지의 셀 내용이 배지, 팝오버, 액션 메뉴를 포함해 제각각이라 `Column<T>` 배열로
표현되지 않습니다. 새로 만들 컴포넌트는 같은 실패를 반복하지 않아야 합니다.

## 범위

`/stocks`와 `/my-portfolio`의 모바일 카드 전환, `/signals`의 가로 오버플로 수정,
그리고 전역 폭과 간격 토큰 조정을 다룹니다.

`/reports`, `/compare`, `/investment`, `/market`, 종목 모달 세 컴포넌트,
`SnapshotTracker`의 테이블은 이번 범위 밖입니다. 각각의 정보 손실 정도를 측정해 기록만
남기고 다음 사이클로 넘깁니다.

## 설계

### 1. StackedList — 모바일 카드 전환

`web/src/components/ui/StackedList.tsx`를 만듭니다. 브레이크포인트에 따라 카드와 테이블
중 하나를 렌더합니다.

핵심은 데이터 구조를 강제하지 않는 것입니다. `ResponsiveTable`이 실패한 지점이 그것입니다.
인터페이스는 다음과 같습니다.

```ts
type StackedListProps<T> = {
  items: T[];
  keyOf: (item: T) => string;
  renderCard: (item: T) => React.ReactNode;
  onItemClick?: (item: T, e: React.MouseEvent) => void;
  emptyMessage?: string;
  children: React.ReactNode;   // 데스크톱 테이블을 그대로 통과시킵니다
};
```

`md` 미만에서 `renderCard`로 그린 카드를 세로로 쌓고, `md` 이상에서 `children`으로 받은
기존 테이블을 그대로 보여줍니다. 컴포넌트는 카드 껍데기와 전환만 책임지고 셀 내용에는
관여하지 않습니다. 각 페이지가 자기 데이터에 맞는 카드를 직접 그리므로 배지든 팝오버든
자유롭게 넣습니다.

전환은 CSS 클래스로 처리합니다. `md:hidden`과 `hidden md:block` 두 블록을 두면 자바스크립트
없이 동작하고 서버 렌더링과도 어긋나지 않습니다. 다만 두 블록이 동시에 DOM 에 존재하므로,
목록이 큰 `/stocks`(약 900행)에서는 렌더 비용이 문제가 될 수 있습니다. 구현 시 실제
DOM 노드 수와 렌더 시간을 재서, 비용이 크면 `matchMedia` 기반 조건부 렌더로 바꿉니다.

### 2. /stocks 카드 구성

윗줄에 즐겨찾기 별, 종목명, 현재가, 등락률을 둡니다. 지금 모바일에서 보이는 값들입니다.

아랫줄에 지금 사라지는 값을 배치합니다. 라씨·스톡봇·알파캐치 배지 3종을 먼저 두고,
그 뒤에 Gap, 거래량, PER 을 작은 글씨로 나열합니다. 종목 코드는 종목명 옆에 붙입니다.

카드 하나가 세로로 지나치게 길어지면 목록 훑기가 어려워집니다. 두 줄 안에 담고, 값이
없는 항목은 자리를 차지하지 않게 처리합니다.

기존 테이블 마크업은 데스크톱용으로 그대로 둡니다. `hidden md:table-cell` 클래스도
`md` 이상에서는 정상 동작하므로 건드리지 않습니다.

### 3. /my-portfolio 카드 구성

윗줄에 종목명, 현재가, 등락률, 수익률을 둡니다. 아랫줄에 매수가, 손절가, 목표가, 등급을
둡니다. 손절가와 목표가는 현재가와의 거리를 함께 보여주면 판단에 도움이 되지만, 이번에는
값 자체를 보이게 하는 것에 집중하고 파생 표시는 넣지 않습니다.

행 끝의 액션 버튼은 카드에서도 접근 가능해야 합니다.

### 4. ResponsiveTable 삭제

`web/src/components/ui/ResponsiveTable.tsx`와 `ui/index.ts`의 export 를 삭제합니다.
남겨 두면 다음에 반응형 테이블이 필요한 사람이 이것을 집어들고, 그 선택이 지금 문제를
만든 패턴을 그대로 재생산합니다.

### 5. 가로 오버플로 수정

`web/src/app/signals/page.tsx`의 필터 줄을 두 겹으로 나눕니다. 바깥 요소가 `overflow-x-auto`로
가로 스크롤을 담당하고, 안쪽 요소가 `flex-nowrap`을 유지해 버튼이 줄바꿈되지 않게 합니다.
지금은 한 요소가 두 역할을 겸해 넘치는 폭이 그대로 페이지를 밀어냅니다. 수정 후에는 페이지
전체가 밀리는 대신 필터 한 줄만 가로로 흐릅니다.

수정 후 `/`, `/signals`, `/stocks`, `/my-portfolio`, `/market`, `/portfolio`, `/reports`를
375px에서 다시 재서 `documentElement.scrollWidth`가 뷰포트 폭을 넘지 않는지 확인합니다.
넘는 페이지가 있으면 원인 요소를 찾아 같은 방식으로 고칩니다.

### 6. 데스크톱 폭 확장

`web/src/app/layout.tsx`의 `max-w-7xl`을 `max-w-[1600px]`으로 바꿉니다. 1920px 화면에서
사이드바 240px 을 제외한 1680px 에 거의 들어맞고, 초광폭 모니터에서 글줄이 지나치게
길어지는 것은 막습니다.

넓어진 폭을 실제로 쓰려면 그리드 열도 늘려야 합니다. Tailwind v4 의 `2xl` 은 1536px 이며,
이 지점부터 열을 하나씩 더합니다. `lg:grid-cols-4` 인 그리드에는 `2xl:grid-cols-5`를,
`md:grid-cols-3` 인 그리드에는 `2xl:grid-cols-4`를 더합니다.

열을 늘리기 전에 각 카드가 좁아져도 읽히는지 확인해야 합니다. 1600px 에서 5열이면 카드
하나가 약 290px 입니다. 현재 4열일 때가 300px 이므로 큰 차이는 없으나, 카드 내부에 긴
숫자나 종목명이 들어가는 곳은 실제로 확인하고 좁아지면 그 그리드는 열을 늘리지 않습니다.

대상 파일은 `app/page.tsx`, `app/portfolio/page.tsx`, `app/portfolio/[source]/page.tsx`,
`app/settings/page.tsx`, `app/compare/compare-client.tsx` 와 각 `loading.tsx` 입니다.
`loading.tsx` 의 스켈레톤 그리드도 함께 바꿔야 로딩 중과 로딩 후의 열 수가 어긋나지
않습니다.

### 7. 간격 토큰 브레이크포인트 대응

`web/src/app/globals.css` 의 `--section-gap` 은 1.5rem 단일 값이고 `PageLayout` 이 쓰는
`.section-gap` 클래스가 이를 참조합니다.

모바일에서는 1rem 으로 좁혀 한 화면에 더 담고, `xl`(1280px) 이상에서는 2rem 으로 벌려
넓은 화면에서 섹션 구분이 뚜렷해지게 합니다. 미디어 쿼리로 변수만 재정의하면 이 값을 쓰는
모든 곳에 한 번에 적용됩니다.

```css
:root { --section-gap: 1rem; }
@media (min-width: 768px) { :root { --section-gap: 1.5rem; } }
@media (min-width: 1280px) { :root { --section-gap: 2rem; } }
```

디자인 토큰 규칙 문서(`.claude/steering/design-tokens.md`)가 섹션 간격을 `space-y-6`
으로 통일하라고 명시합니다. 이 변경으로 `--section-gap` 과 `space-y-6`(1.5rem)이 어긋나므로
규칙 문서도 함께 갱신합니다.

## 파일 변경 목록

| 파일 | 변경 |
|---|---|
| `web/src/components/ui/StackedList.tsx` | 신규 — 모바일 카드·데스크톱 테이블 전환 |
| `web/src/components/ui/ResponsiveTable.tsx` | 삭제 — 소비처 없음 |
| `web/src/components/ui/index.ts` | ResponsiveTable export 제거, StackedList 추가 |
| `web/src/components/stocks/stock-list-client.tsx` | 모바일 카드 적용 |
| `web/src/app/my-portfolio/page.tsx` | 모바일 카드 적용 |
| `web/src/app/signals/page.tsx` | 필터 줄 가로 오버플로 수정 |
| `web/src/app/layout.tsx` | `max-w-7xl` → `max-w-[1600px]` |
| `web/src/app/globals.css` | `--section-gap` 브레이크포인트 대응 |
| 그리드가 있는 페이지와 `loading.tsx` | `2xl` 열 추가 |
| `.claude/steering/design-tokens.md` | 간격 규칙 갱신 |

## 검증

`npm run build`, `npm run lint`, `npm run test` 를 통과시킵니다.

브라우저로 375px, 768px, 1280px, 1920px 네 폭에서 대상 페이지를 열어 두 가지를 잽니다.
첫째, `documentElement.scrollWidth` 가 뷰포트 폭을 넘지 않는지 확인합니다. 둘째, 375px 에서
지금 사라지는 값들이 실제로 화면에 나타나는지 텍스트로 확인합니다. `/stocks` 는 라씨·스톡봇·
알파캐치·Gap·거래량·PER·코드가, `/my-portfolio` 는 매수가·손절가·목표가·등급·코드가
대상입니다.

데스크톱에서는 1920px 기준 콘텐츠 폭이 1600px 에 도달하는지, 그리드가 실제로 열을 더
쓰는지 확인합니다.

### 검증 중 금지 사항

이 프로젝트는 운영 DB 에 직접 연결됩니다. 앞선 사이클에서 브라우저 자동화로 즐겨찾기
별을 클릭해 실제 사용자 데이터가 삭제된 사고가 있었습니다.

즐겨찾기 별 클릭, 관심그룹 추가·삭제, 포트폴리오 담기, 메모 저장, 설정 변경을 하지
않습니다. 페이지 열기, 정렬·필터 변경, 검색어 입력, 스크롤, 탭 전환은 읽기이므로 허용합니다.

## 예상 효과

`/stocks` 모바일에서 접근 가능한 정보가 4개에서 11개로 늘어납니다. `/my-portfolio` 는
5개에서 10개로 늘어납니다. `/signals` 의 40px 가로 오버플로가 사라집니다. 1920px 화면의
콘텐츠 폭이 1280px 에서 1600px 로 늘어 미사용 공간이 33% 에서 17% 로 줄어듭니다.

## 후속 작업

범위 밖으로 남기는 항목입니다.

`/reports`, `/compare`, `/investment`, `/market`, 종목 모달 세 컴포넌트,
`SnapshotTracker` 의 테이블은 모바일 정보 손실 정도를 측정해 기록만 남깁니다. 측정 결과에
따라 다음 사이클의 우선순위를 정합니다.

앞선 성능 사이클에서 미뤄 둔 항목도 남아 있습니다. 요약·업종 뷰의 `source`·`sector` 공백,
나머지 9개 페이지의 `force-dynamic` 정리, 스켈레톤 전환 시 40px 세로 밀림,
`use-global-price-refresh` 의 심볼별 기준시각, `live-prices` 응답의 서버 시각 `asOf` 가
그것입니다.
