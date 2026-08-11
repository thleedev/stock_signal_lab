# UI 마무리 설계 — /investment 카드 전환과 잔여 정리

작성일: 2026-08-11

## 배경

앞선 사이클에서 `/stocks`와 `/my-portfolio`의 모바일 정보 손실을 해결했습니다. 그때
범위 밖으로 남긴 항목과 검증에서 새로 드러난 문제를 이 사이클에서 마무리합니다.

브라우저로 직접 계측한 값과 코드 확인 결과를 근거로 합니다.

## 문제 진단

### /investment — 9열 중 5열이 접근 불가

`web/src/components/investment/investment-client.tsx:322-332`의 테이블은 9개 컬럼 중
5개를 CSS로 숨깁니다. 감싸는 요소에 가로 스크롤이 없어 숨겨진 값을 볼 방법이 없습니다.

| 컬럼 | 숨김 기준 | 375px 표시 |
|---|---|---|
| 종목명, 현재가, 등락률, 수익률 | 없음 | 표시 |
| 코드, 구매가 | `hidden md:table-cell` | 숨김 |
| 손절가, 목표가, 액션 | `hidden lg:table-cell` | 숨김 |

구매가와 손절가와 목표가가 사라져 투자 판단의 근거가 없어집니다. `/my-portfolio`와
같은 성격의 결함이며 다음 사이클 최우선으로 기록되어 있던 항목입니다.

### /stocks — 768px 검색·필터 바 오버플로

`web/src/components/stocks/stock-list-client.tsx:746`의 `flex flex-col sm:flex-row gap-3`에
`flex-wrap`이 없습니다. 640px 이상에서 네 자식이 한 줄에 강제되는데, 시장·정렬·신호
버튼 그룹이 min-content 폭을 유지해 축소되지 않습니다. 검색창만 눌리다가 합계가
컨테이너를 넘어 768px에서 77px이 밀려납니다.

375px에서는 `flex-col`이라 발생하지 않아 앞선 사이클의 375px 점검에서 잡히지 않았습니다.
개선 전 커밋에도 같은 코드가 있어 회귀는 아닙니다.

### 죽은 UI 컴포넌트 네 개

`web/src/components/ui/index.ts`가 export 하지만 소비처가 없습니다.

`EmptyState`, `PriceText`, `SectionTitle`은 소비처가 0입니다. `Card`는 `EmptyState`
안에서만 쓰이는데(`EmptyState.tsx:1,11,17`) 그 `EmptyState`가 죽었으므로 연쇄로 죽은
상태입니다.

앞선 사이클에서 같은 상태였던 `ResponsiveTable`을 삭제했습니다. 남겨 두면 다음에 비슷한
필요가 생긴 사람이 집어들고, 그 선택이 이번에 고친 문제를 재생산합니다.

## 범위

`/investment`의 모바일 카드 전환, `/stocks`의 768px 오버플로 수정, 죽은 UI 컴포넌트
네 개 정리를 다룹니다.

성능 사이클에서 미뤄 둔 항목(요약·업종 뷰의 `source`·`sector` 공백, 나머지 페이지의
`force-dynamic` 정리)은 이 사이클 다음에 별도로 진행합니다.

## 설계

### 1. /investment 모바일 카드 전환

`StackedList`에 `breakpoint="lg"`를 넘깁니다. 이 테이블에서 가장 늦게 나타나는 컬럼이
`hidden lg:table-cell`이기 때문입니다. 전환점이 그보다 이르면 그 사이 폭에서 정보가
사라집니다. 앞선 사이클에서 이 실수가 세 번 발생했으므로 반드시 대조해 확인합니다.

카드는 두 줄로 구성합니다. 윗줄에 종목명과 코드, 현재가, 등락률, 수익률을 두고 아랫줄에
구매가, 손절가, 목표가를 둡니다. 수익률은 이 화면의 핵심 지표이므로 윗줄에서 눈에 띄게
배치합니다.

액션 버튼은 카드에서도 접근 가능해야 합니다. 버튼 클릭이 카드 클릭과 겹치지 않도록
`e.stopPropagation()`을 넣습니다.

가격 포맷과 수익률 색상은 기존 테이블 행이 쓰는 로직을 재사용합니다. 새로 만들면 두
표시가 어긋나 같은 종목이 폭에 따라 다르게 보입니다. `StackedList`의 `children`에는
`<table>` 전체를 넘깁니다. `<tbody>`만 감싸면 테이블 구조가 깨집니다.

빈 상태 문구가 이미 있다면 그 클래스의 브레이크포인트도 `lg`로 맞춥니다. 앞선 사이클
최종 검토에서 이 불일치가 발견되어 고쳤습니다.

### 2. /stocks 768px 오버플로 수정

`stock-list-client.tsx:746`에 `flex-wrap`을 더합니다.

`/signals`에서 쓴 가로 스크롤 이중 래핑도 같은 효과를 내지만 이 경우에는 줄바꿈이
낫습니다. 가로 스크롤은 필터가 화면 밖에 숨는 반면 줄바꿈은 모두 보입니다. 필터는
사용자가 전체를 훑고 고르는 요소이므로 숨기지 않는 편이 맞습니다.

### 3. 죽은 UI 컴포넌트 정리

`EmptyState.tsx`, `Card.tsx`, `PriceText.tsx`, `SectionTitle.tsx` 네 파일을 삭제하고
`ui/index.ts`의 해당 export를 지웁니다.

삭제 전에 각각의 소비처가 정말 0인지 다시 확인합니다. `Card`는 `EmptyState`를 지운 뒤에
0이 되므로 순서에 주의합니다. 하나라도 소비처가 나오면 그 컴포넌트는 삭제 대상에서
빼고 그 사실을 기록합니다.

## 파일 변경 목록

| 파일 | 변경 |
|---|---|
| `web/src/components/investment/investment-client.tsx` | 모바일 카드 적용 |
| `web/src/components/stocks/stock-list-client.tsx` | 필터 바에 `flex-wrap` 추가 |
| `web/src/components/ui/EmptyState.tsx` | 삭제 |
| `web/src/components/ui/Card.tsx` | 삭제 |
| `web/src/components/ui/PriceText.tsx` | 삭제 |
| `web/src/components/ui/SectionTitle.tsx` | 삭제 |
| `web/src/components/ui/index.ts` | 네 개 export 제거 |

## 검증

`npm run build`, `npm run lint`, `npm run test`를 통과시킵니다. 테스트는 287개가
통과해야 하고 lint는 기존 12 errors / 60 warnings 수준을 유지해야 합니다.

브라우저로 `/investment`를 375px, 900px, 1100px, 1280px 네 폭에서 엽니다. 1100px이
`lg` 경계를 막 넘긴 지점이고 900px이 그 아래입니다. 두 폭 모두에서 구매가·손절가·목표가·
코드가 화면에 나타나야 합니다. 1280px에서는 기존 테이블이 9열을 모두 보여야 합니다.

`/stocks`는 768px에서 `documentElement.scrollWidth`가 뷰포트 폭을 넘지 않는지 재고,
필터가 줄바꿈된 뒤에도 조작 가능한지 확인합니다.

### 검증 중 금지 사항

이 프로젝트는 운영 DB에 직접 연결됩니다. 앞선 사이클에서 브라우저 자동화로 즐겨찾기
별을 클릭해 실제 사용자 데이터가 삭제된 사고가 있었습니다.

`/investment`는 투자 기록을 다루므로 특히 주의합니다. 액션 버튼, 즐겨찾기 별, 관심그룹
변경, 매매 등록·삭제, 메모 저장, 설정 변경을 하지 않습니다. 페이지 열기, 정렬·필터
변경, 검색어 입력, 스크롤, 탭 전환만 허용합니다.

## 예상 효과

`/investment` 모바일에서 접근 가능한 값이 4개에서 9개로 늘어납니다. `/stocks`의 768px
오버플로 77px이 사라집니다. 죽은 컴포넌트 네 개가 정리되어 `ui/` 디렉터리에 남는 것은
실제로 쓰이는 컴포넌트뿐이 됩니다.

## 후속 작업

성능 사이클에서 미뤄 둔 항목이 남아 있습니다. 요약·업종 뷰의 `source`·`sector` 공백으로
분류 기능이 동작하지 않는 문제, 나머지 9개 페이지의 `force-dynamic` 정리,
`use-global-price-refresh`의 심볼별 기준시각, `live-prices` 응답의 서버 시각 `asOf`가
그것입니다.

UI 쪽으로는 종목 모달 세 컴포넌트와 `SnapshotTracker`의 테이블이 남아 있습니다. 앞선
사이클 측정에서 `/reports`, `/compare`, `/market`은 테이블이 없거나 컬럼 숨김 구조가
없어 손볼 것이 없다고 확인되었습니다.

`/collector`, `/market`, `/reports`의 `loading.tsx`와 실제 페이지 그리드 클래스가
640~768px 구간에서 어긋나는 기존 결함도 남아 있습니다.
