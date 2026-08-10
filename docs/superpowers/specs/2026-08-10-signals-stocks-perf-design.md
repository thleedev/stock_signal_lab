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

전체 건수는 200행 조회에 `{ count: 'exact' }`를 붙여 같은 응답으로 함께 받습니다.
초안은 `head: true` 쿼리를 별도로 두는 방향이었으나, PostgREST가 `Content-Range`로
총계를 돌려주므로 본문 조회와 하나로 합쳐 쿼리를 하나 더 줄였습니다. 화면에는
"BUY 1,678건 중 200건 표시" 형태로 노출합니다.

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

이어받기 여부는 매수·매도 목록마다 따로 판단합니다. 주도주 필터(`leader=1`)는 매수
신호만 걸러내는데, 활성 모드 응답에는 `is_leader`가 없어 매수 쪽은 서버가 보낸 200행
안에서만 필터가 성립합니다. 그래서 매수 목록만 이어받기를 끄고 실제로 넘긴 행 수를
총계로 표시하며, 필터와 무관한 매도 목록은 이어받기를 유지해 전량에 도달하게 합니다.
화면의 건수는 언제나 실제로 보여줄 수 있는 행 수와 일치해야 합니다.

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

`/signals`는 `force-dynamic`을 제거하고 `export const revalidate = 30`을 적용합니다.
신호 수집 크론 주기보다 짧아 신선도 손실이 없습니다. 이 페이지는 `searchParams`를 읽으므로
Next.js가 자동으로 동적 렌더링하며, `revalidate`는 페이지 캐시가 아니라 `fetch` 캐시와
`staleTimes`의 클라이언트 라우터 캐시에 작용합니다. `next.config.ts`의
`staleTimes.dynamic`은 현재 30초이므로 뒤로 가기와 탭 전환의 재방문이 즉시 표시됩니다.

`/stocks`는 `force-dynamic`을 그대로 유지합니다. 초안은 두 페이지 모두에서 이를 제거하는
방향이었으나 사용자 결정으로 바꿨습니다. `/stocks`는 `searchParams`를 읽지 않아
`force-dynamic`이 없으면 정적 프리렌더 대상이 되고, 그러면 서버가 판정한 장중 상태와
가격 갱신 시각이 HTML에 고정되어 실제 시장 상황과 어긋납니다. 즐겨찾기 변경도 최대
30초 늦게 반영됩니다. 장중 정확성과 즐겨찾기 즉시 반영이 이 페이지의 캐시 이득보다
중요하다고 판단했습니다.

즐겨찾기·관심그룹을 변경한 직후에는 두 페이지 모두 클라이언트에서 `router.refresh()`를
호출해 즉시 반영합니다.

## 파일 변경 목록

| 파일 | 변경 |
|---|---|
| `web/src/app/signals/page.tsx` | 1,000행 루프 제거, 200행 + count, Suspense 경계, 캐시 선언, 매수·매도 이어받기 여부 분리 |
| `web/src/app/signals/signal-columns.tsx` | 무한 스크롤, summary·industry lazy 로드, 총계 표시 |
| `web/src/app/signals/signals-skeleton.tsx` | 신규 — Suspense fallback 스켈레톤 |
| `web/src/components/signals/use-active-signals.ts` | 신규 — 이어받기·전량 로드 훅 |
| `web/src/components/signals/merge-signals.ts` | 신규 — `symbol` 기준 중복 제거 병합 |
| `web/src/app/api/v1/signals/active/route.ts` | 신규 — BUY/SELL 활성 목록 페이지네이션 |
| `web/src/app/api/v1/signals/active/params.ts` | 신규 — `type`·`offset`·`limit` 파싱과 상한 |
| `web/src/lib/signal-constants.ts` | `toSignal` 변환 함수 이관 |
| `web/src/app/stocks/page.tsx` | 컬럼 명시, 네이버 대기 제거 (`force-dynamic` 유지) |
| `web/src/components/stocks/stock-list-client.tsx` | 마운트 후 실시간 시세 병합, 심볼별 최신 값 우선 규칙 |
| `web/src/hooks/use-global-price-refresh.ts` | `onPricesRefreshed`에 기준시각 `asOf` 전달 |
| `web/src/app/api/v1/stocks/live-prices/route.ts` | 신규 — 장중 실시간 시세 |
| `web/src/lib/signal-constants.test.ts` | 신규 — `toActiveSignal` 변환 단위 테스트 5개 |
| `web/src/app/api/v1/signals/active/params.test.ts` | 신규 — 파라미터 파싱 경계 테스트 7개 |
| `web/src/components/signals/merge-signals.test.ts` | 신규 — 중복 제거 병합 테스트 5개 |

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

`/signals`의 서버 구간 약 1.3초가 300ms대로, RSC 페이로드가 행수에 비례해 약 8분의 1로
줄어듭니다. DOM 노드는 3,248행에서 400행으로 감소합니다. `/stocks`는 장중 최대 4초
대기가 사라지고 응답 본문이 컬럼 축소만큼 줄어듭니다.

초안은 페이로드가 40KB 안팎까지 줄어든다고 적었으나 실측은 454,785 bytes였습니다.
행수만 8분의 1로 보고 계산한 값이라 무한 스크롤·지연 로드용 클라이언트 코드와 RSC 구조
자체의 고정 비용을 빠뜨린 추정이었습니다. 감소 폭의 방향은 맞았으나 절대값은 10배
어긋났습니다.

## 후속 작업

이 설계의 범위 밖이지만 사용자가 함께 제기한 항목입니다.

- 화면 간격 활용 — `--section-gap` 단일 값과 `max-w-7xl` 고정 폭의 브레이크포인트별 조정
- 모바일 정보 밀도 — `ResponsiveTable`이 컬럼을 숨기기만 해 정보 접근 경로가 없는 문제
- 나머지 9개 페이지의 `force-dynamic` 정리

## 측정 결과

검증일 2026-08-10, 커밋 `70a797a`(개선 후) 대 `744743c`(개선 전) 기준으로 측정했습니다.

### 테스트·린트·빌드

`npm run test`는 신규 17개(`signal-constants.test.ts` 5개, `active/params.test.ts` 7개,
`merge-signals.test.ts` 5개)를 포함해 28개 파일 287개 전부 통과했습니다. `npm run lint`는
72개 문제(오류 12·경고 60)가 남아 있으나 이번 작업이 수정한 14개 파일 중 어느 곳에서도 새로
추가된 오류·경고가 없습니다. `stock-list-client.tsx`에 표시된 미사용 import 경고 5건은
diff로 대조한 결과 이번 변경 줄이 아닌 기존 코드입니다. `npm run build`는 성공했고, 빌드
출력에서 `/signals`·`/stocks` 모두 `ƒ`(동적 렌더링)로 표시되어 기대와 일치합니다.

### 서버 응답 성능

프로덕션 빌드(`npm run build && npm run start`)를 각 커밋마다 단독으로 띄운 뒤 `curl`로
5회 이상 반복 측정해 웜업 1회를 제외한 값을 기록했습니다. 개선 전 커밋은
`git worktree add`로 별도 디렉터리에 꺼내 `node_modules`·`.env.local`을 심볼릭 링크로
연결해 같은 방식으로 빌드·기동했습니다. 두 서버 모두 같은 운영 DB에 연결되며, 측정 시각은
평일 오후 1시(KST) 장중입니다.

| 구간 | 개선 전(744743c) | 개선 후(70a797a) | 비고 |
|---|---|---|---|
| `/signals?date=all` 응답 시간 | 1.42~1.82초 | 0.42~0.50초 | 왕복 5라운드→2라운드 |
| `/signals?date=all` 응답 본문 | 3,345,573 bytes | 454,785 bytes | 약 86% 감소 |
| `/signals?date=all` 최초 전송 종목 수 | 3,249개(BUY 1,637+SELL 1,612 전량) | 400개(BUY 200+SELL 200) | 응답에 포함된 `symbol` 필드 수로 확인 |
| `/signals` 기본 진입(오늘 신호 있음) 응답 시간 | 0.54~1.35초 | 0.52~0.70초 | 원래도 1,000행 루프 미해당 구간이라 변화 작음 |
| `/signals` 기본 진입 응답 본문 | 194,170 bytes | 214,290 bytes | 무한 스크롤·Suspense 부가 코드로 약 10% 증가(행수는 93건으로 동일) |
| `/stocks` 응답 시간(장중) | 0.86~2.30초, 변동 큼 | 0.21~0.49초, 변동 작음 | 네이버 시세 서버 대기 제거 |
| `/stocks` 응답 본문(100행) | 170,485~170,505 bytes | 106,097 bytes | 컬럼 축소로 약 38% 감소 |

설계 문서 "배경" 절의 계측값(서버 구간 약 1.3초, `stock_cache` 100행 102KB)은 이번 측정과
측정 방식이 달라(운영 DB 직접 계측 대 로컬 curl) 절대값이 정확히 일치하지는 않습니다.
응답 시간은 예상 효과("300ms대로")와 같은 수준으로 떨어졌으나, 페이로드는 예상값
"40KB 안팎"과 실측 454,785 bytes가 10배 어긋났습니다. 감소 폭 86%라는 방향은 맞았고
추정만 빗나갔습니다. `/signals`
기본 진입(오늘 모드)은 원래도 1,000행 루프 대상이 아니어서 이번 개선의 직접 수혜 구간이
아니며, 응답 본문이 오히려 소폭 늘어난 것은 무한 스크롤·지연 로드용 클라이언트 코드가
추가된 데 따른 것으로, 행수 자체(93건)는 개선 전후 동일합니다.

### 기능 회귀 확인

날짜 필터 네 가지를 모두 URL 파라미터로 확인했습니다. `오늘`(기본 진입, 총 93건),
`최근7일`(총 623건), `전체`(총 3,249건, API의 `total`과 일치), 특정일(`date=2026-08-10`,
동일하게 93건)이 각각 올바른 건수를 보였습니다. 소스 필터는 `date=2026-08-10` 모드에서
`라씨`(93건)와 `스톡봇`(0건, 실제로 오늘 스톡봇 신호가 없음)으로 정상 구분되지만,
`date=all` 모드에서는 어떤 소스를 선택해도 총계가 3,249건으로 고정됩니다. 이는 설계
문서 4절에 명시된 기존 결함("date=all 모드는 `toSignal`에서 `source: ""`를 넣기 때문에
소스 구분이 동작하지 않음")과 같은 현상이며 이번 작업의 회귀가 아닙니다.

목록 뷰의 무한 스크롤은 `date=all` 기준 BUY 200행에서 시작해 스크롤할 때마다 200행씩
늘어나 최종적으로 BUY 1,637행·SELL 1,612행 전량에 도달했고, 중복 행 없이(고유 텍스트
수와 행 수 일치) 안정적으로 멈췄습니다. 소스별 요약·업종별 요약 뷰는 전환 시점에 전량을
lazy 로드해 "매수 1637 / 매도 1612" 헤더와 종목 나열을 정상적으로 보여줬습니다. 종목분석
탭으로 전환했다가 AI 신호 탭으로 돌아오는 동작과 주도주 필터 링크 이동도 콘솔 오류 없이
동작했습니다.

주도주 필터(`leader=1`)를 확인하는 과정에서 매수 목록은 주도주만 정상 필터링되지만
매도 목록은 필터가 적용되지 않고 전량이 그대로 노출되는 결함을 발견했습니다.
`web/src/app/signals/page.tsx`에서 매수는 `buySignals.filter(is_leader)`로 넘기는 반면
매도는 `sellSignals`를 그대로 넘깁니다. 개선 전 커밋(744743c)의 동일 위치를 대조한 결과
같은 코드였으므로 이번 작업 이전부터 있던 결함이며 이번 개선의 회귀는 아닙니다. 참고로
남겨두며 별도 수정 대상으로 다루는 것을 권고합니다.

`/stocks`는 장중 조건에서 가격이 즉시 표시되고 정렬(`등락률` 등 8종)·시장 필터
(KOSPI/KOSDAQ/ETF)·검색(`종목명/코드 검색`)이 URL 파라미터와 목록 순서에 모두 정상
반영됨을 확인했습니다. 실시간 시세 배지는 장중에 정상 갱신되나, 표시 문자열이
`2026-08-10T04:08:02.239+00:00`처럼 가공되지 않은 ISO 형식 그대로 노출되는 것을
발견했습니다. 원인은 `web/src/hooks/use-global-price-refresh.ts`이며, 이 파일은
개선 전후 완전히 동일해 이번 작업의 회귀가 아닌 기존 결함입니다.

두 페이지 모두 개발자도구 375px 폭에서 `/stocks`는 가로 스크롤이 없었습니다(`scrollWidth`
369px). `/signals`는 소스 필터 버튼 줄(`전체/라씨/스톡봇/알파캐치/프리즘`)이
`flex-nowrap`으로 줄바꿈되지 않아 약 40px 가로 오버플로가 있었습니다. 원인 파일
`web/src/app/signals/signal-filter-bar.tsx`는 개선 전후 완전히 동일해 이번 작업 범위 밖의
기존 문제이며, 설계 문서 "범위" 절에서도 레이아웃·시각 디자인은 범위 밖으로 명시했습니다.

즐겨찾기·관심그룹 변경이 즉시 반영되는지는 이 검증에서 확인하지 않았습니다. 이 프로젝트가
운영 DB에 직접 연결되어 있어 쓰기 조작(별표 클릭, 관심그룹 추가·삭제)이 실제 사용자 데이터를
변경할 위험이 있기 때문입니다. 또한 `/stocks`의 장 마감 후 가격 표시 상태는 검증 시각이
평일 장중이라 실측하지 못했습니다.
