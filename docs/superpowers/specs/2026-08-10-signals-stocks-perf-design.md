# /signals·/stocks 초기 표시 속도 개선 설계

작성일: 2026-08-10

## 배경

웹앱 전반의 화면 표시가 느립니다. 사용자가 지목한 화면은 `/signals`와 `/stocks`입니다.
서비스 DB(운영)에 직접 계측한 결과는 다음과 같습니다.

| 측정 항목 | 값 |
|---|---|
| `stock_cache` 전체 행수 | 4,398 |
| BUY 상태 행수 (`has_active_sell=false` 且 `latest_signal_date` 존재) | 1,678 |
| SELL 상태 행수 (`has_active_sell=true` 且 `latest_sell_date` 존재) | 1,570 |
| BUY 1,000행 1회 조회 소요 | 336ms / JSON 161KB |
| `/stocks`의 `select("*")` 100행 | 155ms / JSON 102KB / 컬럼 47개 |

## 문제 진단

### /signals — 직렬 왕복과 과다 페이로드

`web/src/app/signals/page.tsx`의 기본 진입 경로는 `date=all` 모드입니다. 이 경로는
BUY 목록을 1,000행 단위 루프로 모으고, 루프가 끝난 뒤 SELL 목록을 다시 같은 방식으로
모읍니다. 두 루프가 서로 직렬이고 루프 내부도 직렬이므로 1,678행과 1,570행을 받는 데
왕복 4회, 약 1.3초가 소요됩니다. 앞단에는 오늘 신호 유무를 판정하는 `count` 쿼리가
별도 직렬로 한 번 더 실행됩니다.

이렇게 모은 3,248행 전량이 `SignalColumns` 클라이언트 컴포넌트에 props로 직렬화되어
RSC 페이로드가 약 500KB에 이릅니다. `web/src/app/signals/signal-columns.tsx`에는 표시
행 제한도 가상화도 없어 브라우저가 3천 행을 통째로 DOM에 그립니다. 서버 대기와 클라이언트
렌더 지연이 겹치는 구조입니다.

### /stocks — 외부 API 대기와 컬럼 과다

`web/src/app/stocks/page.tsx`는 장중(KST 평일 08~20시)에 네이버 전종목 시세를 서버
렌더링 중에 호출하며 최대 4초를 기다립니다. 타임아웃 래퍼가 있어 실패하지는 않지만 그
시간만큼 첫 페인트가 지연됩니다. 또 `select("*")`가 47개 컬럼을 전부 가져와 100행에
102KB를 씁니다. `stock_info`·`signals` 조회는 첫 `Promise.all`에 합류하지 못하고 두
번째 라운드로 밀려 있습니다.

### 공통 — 캐시 무효화

두 페이지 모두 `export const dynamic = 'force-dynamic'`을 선언합니다. `/signals`는
`revalidate` 선언조차 없고, 다른 페이지들은 `revalidate`를 선언했으나 `force-dynamic`에
무효화됩니다. 결과적으로 페이지 캐시가 전혀 동작하지 않습니다. Suspense 경계도 없어
모든 대기가 끝날 때까지 사용자는 `loading.tsx` 스켈레톤만 봅니다.

## 범위

두 페이지의 데이터 계층과 로딩 방식만 변경합니다. 레이아웃과 시각 디자인은 이 설계의
범위 밖입니다. 사용자가 함께 제기한 간격 활용과 모바일 정보 밀도는 이 작업이 끝난 뒤
별도 사이클로 다룹니다.

## 설계

### 1. /signals 데이터 계층 — 왕복 1라운드

BUY·SELL 조회를 공통 4개 쿼리(즐겨찾기, 관심종목, 관심그룹, 그룹종목)와 같은
`Promise.all`에 넣어 왕복을 1라운드로 접습니다. 각 목록은 최신순 200행만 가져옵니다.
1,000행 루프는 제거합니다.

전체 건수는 `select('*', { count: 'exact', head: true })`로 별도 취득합니다. 본문 전송이
없어 비용이 사실상 0이고, 화면에는 "BUY 1,678건 중 200건 표시" 형태로 노출합니다. 이
count 쿼리도 같은 `Promise.all`에 합류시킵니다.

오늘 신호 유무를 판정하는 선행 `count` 쿼리는 결과에 따라 `selectedDate`가 갈리므로
앞으로 뺄 수 없습니다. 이 쿼리만 1라운드로 먼저 실행하고, 나머지 전부를 2라운드 하나로
묶습니다. 기존 5라운드가 2라운드로 줄어듭니다.

### 2. 이어받기 API

신규 라우트 `web/src/app/api/v1/signals/active/route.ts`를 만듭니다. 기존
`web/src/app/api/v1/signals/route.ts`는 `signals` 테이블을 조회하지만, `date=all`
모드는 `stock_cache`의 `has_active_sell` 기준이라 의미가 다릅니다. 기존 라우트를 확장하지
않고 별도 라우트로 분리합니다.

- 파라미터: `type=buy|sell`, `offset`(기본 0), `limit`(기본 200, 최대 1000)
- 응답: `{ items: Signal[], total: number, hasMore: boolean }`
- 인증: 기존 읽기 라우트(`/api/v1/stocks`)와 동일하게 `verifyCollectorKey` 없이 공개
- `page.tsx`의 `toSignal` 변환 로직을 `web/src/lib/signal-constants.ts`로 옮겨 페이지와
  라우트가 같은 함수를 씁니다. 형태가 어긋나면 무한 스크롤로 이어 붙인 행만 다르게
  렌더링되므로, 이 공유는 선택이 아니라 필수입니다.

### 3. 무한 스크롤

`signal-columns.tsx`의 `list` 뷰 하단에 `IntersectionObserver` 감시 요소를 두고, 화면에
들어오면 다음 200행을 이어 받습니다. 로드 중에는 하단에 스피너를 표시하고, `hasMore`가
false면 감시를 해제합니다. 이미 받은 행은 `symbol` 기준으로 중복을 제거합니다.

### 4. summary·industry 뷰 정합성

`signal-columns.tsx`의 `summary`(소스 × 시장별 종목 칩 나열)와 `industry`(업종별 종목
나열)는 전달받은 배열 전체를 클라이언트에서 집계합니다. 200행만 넘기면 두 뷰의 내용이
모두 틀어집니다.

두 뷰 모두 **뷰 전환 시점에 전량을 lazy 로드**합니다. 위 API를 `limit=1000`으로 반복
호출해 전체를 채우고, 로드가 끝날 때까지 스켈레톤을 보여줍니다. 한 번 받은 전량은
컴포넌트 상태에 보관해 뷰를 오갈 때 다시 받지 않습니다. 소스 헤더의 "매수 N / 매도 M"
숫자는 서버 count로 즉시 표시하므로 로딩 중에도 정확합니다.

최초 진입은 `list` 뷰이므로 이 lazy 로드는 초기 표시 속도에 영향을 주지 않습니다.

참고로 `date=all` 모드는 `toSignal`에서 `source: ""`를 넣기 때문에 summary 뷰의 소스
구분이 현재도 동작하지 않습니다. 이는 기존 동작이며 이 설계에서 바꾸지 않습니다.

### 5. Suspense 스트리밍

`PageHeader`, `SignalFilterBar`, 주도주 필터 링크, `CollectingBanner`는 서버 데이터에
의존하지 않습니다. 무거운 `SignalColumns`와 `HotThemesBanner`를 각각 Suspense 경계로
감싸면 헤더와 필터가 먼저 페인트되어 사용자가 빈 스켈레톤 대신 조작 가능한 화면을 먼저
봅니다. 각 경계의 fallback은 기존 `loading.tsx`와 시각적으로 일관되게 맞춥니다.

### 6. /stocks 개선

`select("*")` 두 곳을 화면이 실제로 쓰는 컬럼만 명시로 교체합니다. 대상 컬럼은
`web/src/components/stocks/stock-list-client.tsx`가 참조하는 필드에서 도출합니다.

서버의 네이버 시세 대기를 제거합니다. `isMarketHours`·`withTimeout`·`livePricePromise`
및 `applyLive` 병합을 페이지에서 걷어내고, `stock_cache` 가격으로 즉시 렌더합니다.
클라이언트는 마운트 후 신규 라우트 `web/src/app/api/v1/stocks/live-prices/route.ts`를
호출해 받은 시세를 상태에 병합합니다. 기존 `fetchAllStockPrices`를 그대로 재사용하고,
장중이 아니면 빈 응답을 즉시 반환합니다. 갱신 시각은 기존 `PriceUpdateBadge`로 표시합니다.

`stock_info`·`signals` 조회는 `uniqueSymbols`에 의존하고, 이 심볼 집합은 `stock_cache`
조회 결과에서만 나옵니다. 따라서 첫 라운드에 합칠 수 없으며 2라운드 구조를 유지합니다.
두 쿼리는 이미 서로 병렬이므로 현재 코드에서 바꿀 것이 없습니다. `/stocks`의 개선 효과는
네이버 대기 제거와 컬럼 축소에서 나옵니다.

### 7. 캐시 전략

이 앱은 인증이 없고 `user_id` 개념이 없는 단일 사용자 앱이므로 페이지 캐시를 공유해도
사용자별 데이터가 섞이지 않습니다.

두 페이지에서 `force-dynamic`을 제거하고 `export const revalidate = 30`을 적용합니다.
신호 수집 크론 주기보다 짧아 신선도 손실이 없습니다. 즐겨찾기·관심그룹을 변경한 직후에는
클라이언트에서 `router.refresh()`를 호출해 즉시 반영합니다.

`/signals`는 `searchParams`를 읽으므로 Next.js가 자동으로 동적 렌더링합니다. 이 경우
`revalidate`는 페이지 캐시가 아니라 `fetch` 캐시와 `staleTimes`의 클라이언트 라우터
캐시에 작용합니다. `next.config.ts`의 `staleTimes.dynamic`은 현재 30초이므로 뒤로 가기와
탭 전환의 재방문이 즉시 표시됩니다.

## 파일 변경 목록

| 파일 | 변경 |
|---|---|
| `web/src/app/signals/page.tsx` | 1,000행 루프 제거, 200행 + count, Suspense 경계, 캐시 선언 |
| `web/src/app/signals/signal-columns.tsx` | 무한 스크롤, summary·industry lazy 로드, 총계 표시 |
| `web/src/app/api/v1/signals/active/route.ts` | 신규 — BUY/SELL 활성 목록 페이지네이션 |
| `web/src/lib/signal-constants.ts` | `toSignal` 변환 함수 이관 |
| `web/src/app/stocks/page.tsx` | 컬럼 명시, 네이버 대기 제거, 캐시 선언 |
| `web/src/components/stocks/stock-list-client.tsx` | 마운트 후 실시간 시세 병합 |
| `web/src/app/api/v1/stocks/live-prices/route.ts` | 신규 — 장중 실시간 시세 |

## 검증

`npm run build`, `npm run lint`, `npm run test`를 모두 통과시킵니다. `toSignal` 이관과
페이지네이션 경계는 단위 테스트를 추가합니다.

개발 서버에서 두 페이지의 서버 응답 시간과 RSC 페이로드 크기를 개선 전후로 비교해
기록합니다. 기능 회귀는 다음을 눈으로 확인합니다.

1. `list` 뷰에서 스크롤을 끝까지 내려 전체 건수만큼 이어 받아지는지
2. `summary`·`industry` 뷰의 종목 나열이 개선 전과 동일한지
3. 날짜·소스·주도주 필터가 각 뷰에서 정상 동작하는지
4. 장중과 장 마감 후 `/stocks`의 가격 표시와 갱신 배지가 모두 정상인지
5. 즐겨찾기·관심그룹 변경이 즉시 화면에 반영되는지

UI 변경이 포함되므로 커밋 전에 로컬에서 직접 실행해 확인합니다.

## 예상 효과

`/signals`의 서버 구간 약 1.3초가 300ms대로, RSC 페이로드 약 500KB가 40KB 안팎으로
줄어듭니다. DOM 노드는 3,248행에서 400행으로 감소합니다. `/stocks`는 장중 최대 4초
대기가 사라지고 응답 본문이 컬럼 축소만큼 줄어듭니다.

## 후속 작업

이 설계의 범위 밖이지만 사용자가 함께 제기한 항목입니다.

- 화면 간격 활용 — `--section-gap` 단일 값과 `max-w-7xl` 고정 폭의 브레이크포인트별 조정
- 모바일 정보 밀도 — `ResponsiveTable`이 컬럼을 숨기기만 해 정보 접근 경로가 없는 문제
- 나머지 9개 페이지의 `force-dynamic` 정리
