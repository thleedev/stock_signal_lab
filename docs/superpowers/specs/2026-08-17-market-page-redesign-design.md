# 투자 시황 개편 설계

작성일: 2026-08-17
대상: `/market` 페이지와 그 데이터 파이프라인 전 구간

## 1. 배경

투자 시황 페이지가 데이터를 제대로 내지 못한다는 문제 제기에서 출발해, UI·API·DB·수집·배치·문서 6축과 GitHub Actions 배치 경로를 전수 조사했습니다. 확인된 결함은 단일 버그가 아니라 수집·저장·조회·렌더 네 계층에 걸쳐 있으며, 서로 독립적인 원인이 겹쳐 있습니다.

### 1.1 가장 심각한 동작

지표가 하나도 없을 때 화면에 초록 배너로 「안전 0.0 / 100 · 0개 지표 중 0개가 위험 구간 · 적극 매수 가능」이 표시됩니다(`web/src/lib/market-thresholds.ts:335-339`, `web/src/components/market/market-client.tsx:109-134`). 파이프라인이 완전히 죽은 상태와 시장이 가장 안전한 상태가 화면에서 구분되지 않습니다. 매수 판단에 쓰는 화면에서 이것은 데이터 결손 자체보다 위험합니다.

`web/src/app/market/error.tsx`는 `page.tsx`가 예외를 던지지 않아 도달하지 않는 코드입니다.

### 1.2 확정된 결함 목록

| 계층 | 결함 | 근거 |
|---|---|---|
| 수집 | 지표 정의가 6곳에 중복 선언되어 서로 다른 집합을 담음 | `step6-market-data.ts:5-20`, `types/market.ts:22-35`, `market-thresholds.ts:29-113`, `014_market_indicators.sql:25-36`, `market-client.tsx:48-79` |
| 수집 | FRED percent 값에 bps 임계값 적용 (100배 오차) | `market-thresholds.ts:101-112`, FRED 실측 `BAMLH0A0HYM2=2.71`, `T10Y2Y=0.51` |
| 수집 | VKOSPI 소스 사망 | `^VKOSPI` 실측 404 delisted |
| 수집 | CNN 공포탐욕 소스 사망 | `production.dataviz.cnn.io` 실측 HTTP 418 |
| 수집 | KR_3Y 에 서로 다른 자산 두 개가 번갈아 적재 | 배치 `^IRX`(미국 13주 T-bill) 대 실시간 `122630.KS`(KODEX 레버리지 ETF) |
| 저장 | `prev_value`·`change_pct` 를 채우는 코드가 실행 경로에 없음 | `step6-market-data.ts:75,100-103`, 유일 writer `web/scripts/fetch-market-indicators.ts` 호출자 0건 |
| 저장 | 시황 3개 테이블의 유일한 적재 경로가 평일 16:10 배치 1회 | `.github/workflows/daily-batch.yml:7,44-50` |
| 조회 | 365일 조회에 limit 없어 PostgREST `max_rows=1000` 에 절단 | `market/page.tsx:24-26`, `supabase/config.toml:18` |
| 조회 | etf-sentiment 가 DB 오류를 HTTP 200 + 빈 결과로 치환 | `etf-sentiment/route.ts:18-33` |
| 렌더 | 결손이 낙관값으로 치환됨 (1.1 참조) | `market-thresholds.ts:335-339` |
| 렌더 | 위험 지수를 크론과 브라우저가 각각 계산해 화면 간 숫자 불일치 | `market-client.tsx:354-357` 대 `cron/market-score/route.ts:83-84` |
| 렌더 | 날짜 기준이 UTC 라 KST 오전에 하루 어긋남 | `market/page.tsx:9-12`, 대조군 `page.tsx:16-17` |
| 렌더 | 데이터 기준일과 출처가 화면에 없음 | `market-client.tsx:161-204` |
| 감지 | 모든 실패가 조용히 삼켜지고 `batch_runs` 는 항상 done | `batch/index.ts:97`, `step7-events.ts:8-26` |
| 감지 | 알림 발신 코드가 저장소에 전혀 없음 | grep 결과 `keepalive.yml:6` 주석뿐 |
| 검증 | 화면 숫자를 만드는 함수 전체가 무테스트 | `web/src/**/*.test.ts` 29개 중 시황 관련 0건 |
| 보안 | `POST /api/v1/market-events` 와 `PUT /market-indicators/weights` 가 무인증 service role 쓰기 | `market-events/route.ts:30`, `weights/route.ts` |

### 1.3 화면 밖 피해

`web/src/lib/ai-recommendation/index.ts:143` 이 `market_indicators.change_pct` 를 읽는데 이 값이 영구 NULL 이라 `kospiChangePct` 가 항상 0, `marketMultiplier` 가 항상 1.0 입니다. KOSPI 등락과 무관하게 추천 로직이 동일한 중립 시장으로 판단하며, 시각적 흔적 없이 추천 결과만 왜곡됩니다.

## 2. 목표

이 화면은 **"오늘 들어가도 되는 장인가"** 하나에 답합니다. 판단을 최상단에 두고 지표는 그 판단의 근거로 종속시킵니다. 지표 나열과 해석의 부담을 사용자에게 넘기지 않습니다.

판단은 과거 하락장 백테스트로 검증하고, 그 적중 실적을 화면에 상시 노출해 권고를 검증 가능하게 만듭니다.

### 2.1 비목표

개별 종목 추천, 포트폴리오 연계 표시, 매매 타이밍 신호는 이번 범위 밖입니다. `/market` 은 시장 전체 상태만 다룹니다.

## 3. 확정된 결정

| 항목 | 결정 |
|---|---|
| 범위 | 파이프라인 정상화 + 화면 재설계 |
| 화면 목적 | 단일 판단(진입/관망/축소) 우선, 근거 종속 |
| 판단 근거 | 과거 하락 구간 백테스트로 가중치·임계값 확정 |
| 갱신 시점 | 07:30 확정 + 장중 15분 보정 + 20:10 마감 확정 |
| 지표 구성 | 글로벌(간밤 선행) 층 + 국내(당일) 층 2계층 |
| 카탈로그 위치 | 루트 `shared/market/catalog.ts` 신설, 배치·웹 공유 |
| VKOSPI | 20일 실현변동성으로 대체, KRX OpenAPI 키 확보 시 교체 |
| 신용잔고 | FreeSIS 요청 스펙을 브라우저로 캡처해 확보 |
| KR_3Y | 한국은행 ECOS 로 정식 교체 |
| CNN 공포탐욕 | 소스 사망으로 제거 |

## 4. 아키텍처

### 4.1 지표 카탈로그 — 단일 출처

지표 하나를 정의하는 정보를 한 행에 담고 배치·API·UI 가 그것만 참조합니다.

```ts
// shared/market/catalog.ts
export type Unit = 'index' | 'percent' | 'percent_point' | 'krw' | 'usd' | 'won_100m';

export interface IndicatorSpec {
  key: string;
  label: string;
  layer: 'global' | 'domestic';
  source: SourceSpec;                       // 주 소스
  fallback?: SourceSpec;                    // 폴백 소스
  unit: Unit;                               // 저장 단위 — 필수
  thresholds: { unit: Unit; levels: [number, number, number] };
  display: { suffix: string; digits: number };
  weight: number;
  direction: 1 | -1;                        // 1 = 값이 클수록 위험
  derived?: 'drawdown_52w' | 'ma_gap_200d' | 'realized_vol_20d';
}
```

`thresholds.unit` 이 `unit` 과 다르면 타입 오류가 나도록 제네릭으로 묶습니다. FRED percent 값에 bps 임계값을 적용한 현재 사고가 컴파일 단계에서 막힙니다.

카탈로그는 배치(`.github/scripts/`)와 웹(`web/src/`)이 함께 읽어야 하므로 루트 `shared/` 에 두고 양쪽 tsconfig 에 path 를 등록합니다. GHA 배치의 `npm ci` 범위와 `tsx` 해석 경로 조정이 함께 필요합니다.

### 4.2 값의 단일 출처 — 서버 정본

현재 DB(배치)와 실시간 API 두 경로가 서로 다른 지표 집합·다른 티커를 들고 병존하며 브라우저에서 뒤엣것이 앞엣것을 덮어씁니다. 위험 지수도 크론과 브라우저가 각각 계산합니다.

실시간 조회를 화면 오버레이가 아니라 수집 경로로 옮깁니다.

```
[수집]  07:30 / 장중 15분 / 20:10 배치
           ↓ write-through
[저장]  market_indicators (현재값·전일값·등락률·출처·수집시각)
        market_indicator_stats (롤링 통계)
        market_verdict (판정 결과 + 근거 + 커버리지)
           ↓ 단일 조회
[조회]  /market 서버 컴포넌트
           ↓ props
[렌더]  MarketClient — 계산 없음, 표시만
```

클라이언트 재계산을 전면 제거합니다. 첫 페인트와 최종 표시가 같아지고, 현재값과 히스토리의 출처가 일치하며, 대시보드와 `/market` 이 같은 숫자를 봅니다.

### 4.3 점수 계약

`calculateRiskIndex` 가 숫자만 반환하는 것이 1.1 의 실패를 만듭니다. 판정 객체로 바꿉니다.

```ts
export type RiskVerdict =
  | {
      status: 'ok';
      score: number;                        // 0~100
      action: 'enter' | 'hold' | 'reduce';  // 화면 최상단 단일 판단
      coverage: number;                     // 0~1, 가중치 합 기준
      contributions: {
        key: string; level: 0 | 1 | 2 | 3; value: number;
        threshold: number; points: number;  // 위험 지수 기여 점수
      }[];
      missing: string[];
      asOf: string;                         // 판정 기준 시각 (KST)
    }
  | { status: 'insufficient'; coverage: number; missing: string[]; asOf: string };
```

커버리지가 0.7 미만이면 `insufficient` 를 반환하고 화면은 점수 대신 「산출 불가 — 지표 N개 중 M개 결측」과 결측 지표명을 표시합니다. `contributions` 가 화면의 "이 판단의 근거"를 그대로 채우므로 UI 가 breakdown 을 재계산할 이유가 사라집니다.

### 4.4 롤링 통계 사전 계산

252일 분위수·52주 고점·200일 이평을 매 요청 1년치 원시 행으로 계산하는데 `max_rows=1000` 에 절단되어 실제로는 약 70~90 영업일 창으로 산출됩니다. 절단이 오류가 아니라 짧은 배열로 나타나므로 길이 가드를 통과해 조용히 틀린 값이 나옵니다.

배치가 지표별 롤링 통계를 미리 계산해 `market_indicator_stats` 에 저장하고, 페이지는 현재값과 요약만 읽습니다. 지표가 늘어도 페이로드가 늘지 않습니다.

```sql
create table market_indicator_stats (
  indicator_key text not null,
  as_of date not null,
  high_52w numeric, low_52w numeric,
  ma_200d numeric, ma_20d numeric,
  pct_rank_252d numeric,                    -- 0~1
  stddev_20d numeric,
  sample_days int not null,                 -- 실제 계산에 쓰인 일수 (절단 감지용)
  primary key (indicator_key, as_of)
);
```

`sample_days` 를 함께 저장해 계산 창이 기대보다 짧으면 화면과 알림에서 드러나게 합니다.

## 5. 데이터 소스 명세

2026-08-17 실제 HTTP 호출로 확인한 결과입니다.

### 5.1 글로벌 층

| key | 주 소스 | 폴백 | 단위 | 실측 | 백테스트 커버리지 |
|---|---|---|---|---|---|
| VIX | FRED `VIXCLS` | Yahoo `^VIX` | index | ok | 2015~ 전 구간 |
| HY_SPREAD | FRED `BAMLH0A0HYM2` | 없음 | **percent** | ok (2.71) | **2023-08-15 이후만** |
| YIELD_CURVE | FRED `T10Y2Y` | `DGS10-DGS2` 계산 | **percent_point** | ok (0.51) | 2015~ 전 구간 |
| US_10Y | FRED `DGS10` | Yahoo `^TNX` | percent | ok | 2015~ 전 구간 |
| DXY | FRED `DTWEXBGS` | Yahoo `DX-Y.NYB` | index | ok | 2015~ 전 구간 |
| WTI | FRED `DCOILWTICO` | Yahoo `CL=F` | usd | ok | 2015~ 전 구간 |
| GOLD | Yahoo `GC=F` | 없음 | usd | ok | 미확인 |
| EWY | Yahoo `EWY` | 없음 | usd | ok | 미확인 |

FRED 무키 CSV 경로는 `https://fred.stlouisfed.org/graph/fredgraph.csv?id=<SERIES>&cosd=&coed=` 입니다. 결측은 마침표가 아니라 **빈 문자열**로 표기되므로 파서를 그에 맞춰야 합니다.

`BAMLH0A0HYM2` 는 ICE 저작권 제한(Pre-Approval Required)으로 무키 경로에서 최근 3년치만 반환됩니다. 2020·2022 국면 검증에서 이 지표는 제외되며, API 키로 전 구간이 열리는지는 키 발급 후 확인합니다.

### 5.2 국내 층

| key | 소스 | 단위 | 실측 | 백테스트 커버리지 |
|---|---|---|---|---|
| KOSPI | 네이버 `siseJson` | index | ok, Yahoo 와 종가 완전 일치 | 2015-01-02~ |
| KOSDAQ | 네이버 `siseJson` | index | ok | 2015~ |
| KR_VOL_20D | KOSPI 종가에서 계산 | percent | 계산값 | 2015~ |
| FOREIGN_NET | 네이버 `investorDealTrendDay` | won_100m | ok, `bizdate` 로 과거 소급 | 2015-01-05~ |
| INSTITUTION_NET | 동일 | won_100m | ok | 2015-01-05~ |
| USD_KRW | FRED `DEXKOUS` | krw | ok | 2015~ |
| KR_3Y | 한국은행 ECOS | percent | **키 발급 대기** | 미확인 |
| CREDIT_BALANCE | 금융투자협회 FreeSIS | won_100m | **스펙 캡처 필요** | 1998~ (메타 확인) |

네이버 수급은 호출당 10영업일이라 2015년 이후 전 구간 백필에 약 290회 요청이 필요합니다. 지연을 두고 1회 백필한 뒤 일자 키를 가진 신규 테이블에 적재합니다. 기존 `step2-investor-data.ts` 는 종목별 최근 5영업일 스냅숏을 덮어쓰는 구조라 재사용할 수 없습니다.

Yahoo 는 쿠키 없이 호출하면 429 로 차단됩니다. `https://fc.yahoo.com` 에서 A3 쿠키를 받아 붙이면 통과하지만 재현성이 불안정하므로, 수집 경로에 네이버 폴백을 필수로 둡니다.

### 5.3 제거 대상

| key | 사유 |
|---|---|
| CNN_FEAR_GREED | 소스가 HTTP 418 로 차단, 대체 무료 소스 없음 |
| FEAR_GREED | 배치는 CNN 값, 실시간은 VIX 역산값으로 의미가 달랐음 |
| KORU | `RISK_THRESHOLDS` 에 정의가 없어 판정 불가, EWY 와 중복 |
| VKOSPI | 소스 404, `KR_VOL_20D` 로 대체 |

### 5.4 이벤트

`web/src/lib/market-events.ts:117` 이 조회하는 FRED `release_id=10` 은 FOMC 가 아니라 Consumer Price Index 릴리스입니다. FOMC 는 `release_id=101` 이지만 `release/dates` 는 API 키를 요구하므로, FOMC 일정은 `federalreserve.gov/monetarypolicy/fomccalendars.htm` 파싱으로 무키 확보합니다.

정적 폴백 `web/src/data/economic-calendar.json` 은 14건 전부 2026년이고 CPI 는 2026-03-11, 고용은 2026-03-06 이 마지막이라 이미 고갈되었습니다. CPI·고용 발표일도 FRED release 페이지 또는 BLS 일정 페이지에서 롤링 수집으로 교체합니다.

## 6. 화면 설계

```
┌────────────────────────────────────────────────────┐
│  ⚠  관망            위험 62.4 / 100    ▲ +8.2 (7일)  │
│  비중 축소 권고 · 신규 진입 보류                        │
│  08-17 07:30 확정 · 장중 09:45 기준 · 13개 중 12개     │
├────────────────────────────────────────────────────┤
│ 이 판단의 근거                        기여도순 3개      │
│  ● VIX            28.4   임계 20 초과        +18     │
│  ● 원달러          1,412   임계 1,400 초과     +12     │
│  ● 외인 5일 순매도  -1.8조                    +9      │
│                              [나머지 9개 펼치기 ▾]    │
├────────────────────────────────────────────────────┤
│ 간밤 글로벌 ▾           │  당일 국내 ▾                 │
│  VIX 28.4 ▲12%         │   실현변동성 24.1 ▲8%        │
│  HY스프레드 4.2% ▲      │   외인수급 -1.8조            │
│  …                     │   신용잔고 …                 │
├────────────────────────────────────────────────────┤
│ 30일 위험 지수 추이   ▁▂▃▅▇█                          │
│ 과거 적중 4/5 구간 · 평균 D-12 경고    [상세 ▸]         │
├────────────────────────────────────────────────────┤
│ 예정 이벤트 (30일)                                    │
└────────────────────────────────────────────────────┘
```

### 6.1 판정 배너

`RiskVerdict.action` 을 그대로 표시합니다. `status: 'insufficient'` 이면 점수 자리에 「산출 불가」를, 부제에 결측 지표명을 표시하며 색상은 중립 회색을 씁니다. 결손을 초록으로 칠하지 않는 것이 이 설계의 핵심입니다.

### 6.2 근거 블록

`contributions` 를 기여 점수 내림차순으로 정렬해 상위 3개를 펼친 상태로, 나머지를 접힌 상태로 둡니다. 각 행은 현재값·임계값·기여 점수를 함께 보여 판단이 어디서 왔는지 추적 가능하게 합니다.

### 6.3 2계층 지표 목록

글로벌 지표는 아침에 이미 확정된 값이고 국내 지표는 장중에 바뀝니다. 섞어 나열하면 어느 것이 반영 완료된 정보이고 어느 것이 지금 움직이는 정보인지 구분되지 않습니다. 각 지표 행에 마지막 갱신 시각을 표시하고, 신선도가 기준을 넘긴 지표는 흐리게 처리하며 경고 배지를 답니다.

### 6.4 섹션 상시 노출

현재 ETF 센티먼트·30일 추이·이벤트 캘린더가 데이터 없으면 섹션째 사라져(`market-client.tsx:462,472,480`) 화면이 왜 비었는지 알 수 없습니다. 모든 섹션이 자리를 지키고, 결측일 때 그 사실과 마지막 갱신 시각을 표시합니다.

### 6.5 백테스트 실적 노출

30일 추이 하단에 과거 하락 국면 대비 적중 실적을 상시 표시합니다. 상세를 열면 국면별로 언제 경고가 떴는지, 놓친 국면은 무엇인지 보여줍니다. 권고를 검증 가능하게 만드는 장치입니다.

## 7. 배치 설계

| 시각(KST) | 모드 | 내용 |
|---|---|---|
| 07:30 평일 | `market-open` | 간밤 미국장 마감·FRED·환율 수집 → 당일 판정 확정 |
| 09:00~15:30 15분 | `market-intraday` | 국내 지표 갱신 → write-through → 판정 보정 |
| 20:10 평일 | `market-close` | 시간외 포함 종가 확정, 롤링 통계 재계산 |

15분 간격 `prices-only` 배치가 이미 돌고 있으므로 국내 지표 갱신은 여기에 얹습니다. 기존 16:10 `full` 배치에서 step6·step7 을 분리해 위 세 모드로 옮기고, 나머지 step 은 현행 유지합니다.

`market_verdict` 는 모드별로 행을 남겨(`kind: 'open' | 'intraday' | 'close'`) 아침 확정 판단과 장중 보정을 화면에서 함께 보여줄 수 있게 합니다.

## 8. 백테스트 설계

### 8.1 정답지

KOSPI 2015-01-02 ~ 2026-08-14 종가에서 지그재그(10% 반전) 방식으로 분해한 하락 국면 16개를 씁니다. 전고점 회복 방식은 2018년 하락장이 코로나 폭락을 삼키므로 부적합합니다.

| 국면 | 고점일 | 저점일 | 낙폭 |
|---|---|---|---|
| 2015 여름 | 2015-04-23 | 2015-08-24 | -15.81% |
| 2016 초 | 2015-11-04 | 2016-02-12 | -10.59% |
| 2018~19 | 2018-01-29 | 2019-01-03 | -23.27% |
| 2019 여름 | 2019-04-16 | 2019-08-07 | -15.07% |
| **2020 코로나** | 2020-01-22 | 2020-03-19 | **-35.71%** |
| **2021~22 긴축** | 2021-07-06 | 2022-07-06 | **-30.65%** |
| 2022 가을 | 2022-08-16 | 2022-09-30 | -14.92% |
| 2023 초 | 2022-11-11 | 2023-01-03 | -10.65% |
| 2023 가을 | 2023-08-01 | 2023-10-31 | -14.59% |
| **2024 엔캐리** | 2024-07-11 | 2024-08-05 | -15.56% |
| 2024 겨울 | 2024-08-22 | 2024-12-09 | -12.82% |
| **2026 여름** | 2026-06-22 | 2026-07-30 | **-38.63%** (미회복) |

2026-06~07 국면은 지표 적재 시작(2026-04-06) 이후라 실제 DB 데이터로 검증할 수 있습니다. 현재 위험 지수가 이 하락을 경고했는지가 첫 시험대입니다.

### 8.2 평가 지표

국면마다 -10% 최초 이탈일을 기준으로 삼아, 그 이전에 위험 지수가 경고 수준(잠정 60)에 도달한 날이 있으면 적중으로 봅니다. 다음을 측정합니다.

- 적중률: 경고를 낸 국면 수 / 전체 국면 수
- 선행일수: 경고일과 -10% 이탈일의 거래일 간격 중앙값
- 오경보율: 하락 국면이 아닌 기간에 경고 수준을 넘긴 날의 비율

선행일수가 지나치게 길면(예: 평균 60거래일) 경고가 상시 켜져 있다는 뜻이므로 오경보율과 함께 봐야 합니다.

### 8.3 튜닝 절차

지표별 가중치와 임계값을 격자 탐색으로 조정하되, 과최적화를 막기 위해 2015~2022 를 학습 구간, 2023~2026 을 검증 구간으로 분리합니다. 학습 구간에서 정한 파라미터를 검증 구간에 적용해 성능이 유지되는지 확인하고, 무너지면 파라미터 수를 줄입니다.

### 8.4 산출물

백필된 지표 히스토리는 `market_indicators` 에 `source='backfill'` 로 적재해 운영 데이터와 구분합니다. 튜닝 결과는 카탈로그의 `weight`·`thresholds` 에 반영하고, 국면별 적중 결과를 `market_backtest_result` 에 저장해 화면에서 읽습니다.

## 9. 실패 감지

각 배치 step 의 반환형을 `{ errors: string[] }` 로 바꾸고, `index.ts` 에서 `summary.errors.length > 0` 이면 `status='failed'` + `process.exitCode = 1` 로 둡니다. GHA 가 빨갛게 실패하는 것만으로 대부분의 결함이 스스로 드러납니다.

지표별 신선도 감시를 추가합니다. 카탈로그에 지표별 허용 지연(`maxStaleDays`)을 두고, 초과하면 화면 배지와 배치 오류 양쪽에 나타냅니다.

텔레그램 알림은 `007_notifications.sql` 기반 구조가 이미 있으므로 배치 실패 발신 경로만 추가합니다.

## 10. 마이그레이션

1. `shared/market/catalog.ts` 신설, 배치·웹 tsconfig path 등록
2. `market_indicator_stats`, `market_verdict`, `market_backtest_result`, 수급 일별 테이블 생성
3. `market_indicators` 에 `source`, `collected_at` 컬럼 추가
4. 기존 `market_indicators` 의 `KR_3Y` 행 삭제(두 자산이 섞여 있어 복구 불가), `FEAR_GREED` 행 삭제
5. FRED 계열 과거 행은 단위 변환 없이 유지 — 저장 단위를 percent 로 확정하고 임계값을 percent 기준으로 재정의하므로 데이터 변환이 불필요
6. `indicator_weights` 테이블 폐기, 가중치를 카탈로그로 일원화

## 11. 테스트 전략

현재 시황 관련 테스트가 0건입니다. 다음을 Vitest 로 덮습니다.

- 카탈로그 정합성: 모든 지표가 `unit` 과 `thresholds.unit` 이 일치하는지, 중복 키가 없는지
- 판정 함수: 커버리지 미달 시 `insufficient` 반환, 결측 지표가 `missing` 에 담기는지, 기여 점수 합이 score 와 일치하는지
- 파생 계산: 52주 낙폭·200일 이격도·20일 실현변동성이 알려진 입력에서 기대값을 내는지
- 단위 회귀: FRED percent 값이 percent 임계값과 비교되는지 (100배 오차 재발 방지)
- 날짜: KST 경계에서 이벤트 조회 범위가 어긋나지 않는지

## 12. 정리 대상

참조처가 0건인 코드를 제거합니다.

| 대상 | 사유 |
|---|---|
| `web/src/hooks/use-market-indicators.ts` | 참조 0건 |
| `web/src/components/market/event-summary-card.tsx` | 참조 0건 |
| `web/scripts/fetch-market-indicators.ts` | 고아 스크립트, 기능은 배치로 이관 |
| `web/migrations/add_risk_index.sql` | `supabase/migrations/` 와 중복 |
| `web/src/app/api/v1/cron/sector-stats/` | `route.ts` 없는 빈 디렉터리 |
| `POST /api/v1/market-events` | 무인증 쓰기 — 제거 또는 `verifyCollectorKey` 적용 |
| `PUT /api/v1/market-indicators/weights` | 무인증 쓰기 + 가중치 일원화로 불필요 |

## 13. 구현 순서

이 설계는 단일 구현 계획으로 다루기에 크므로 세 단계로 나눕니다. 각 단계는 독립적으로 배포 가능하며, 앞 단계가 뒤 단계의 전제가 됩니다.

### 단계 1 — 파이프라인 정상화

카탈로그 신설, `prev_value`·`change_pct` 복원, 단위·키 정합, KR_3Y·VKOSPI·CNN 소스 정리, 네이버 폴백, 롤링 통계 테이블, 배치 3분할, 실패 감지와 알림, 죽은 코드 제거까지입니다. 화면은 손대지 않고 기존 UI 가 정상 데이터를 받게 만드는 것이 목표입니다. 이 단계만으로도 지금 보이는 증상의 대부분이 사라집니다.

완료 판정은 `/market` 의 모든 지표가 값·등락률·기준 시각을 갖고, 배치 실패가 GHA 에서 빨갛게 드러나며, 지표 결손 시 화면이 초록 「안전」을 표시하지 않는 것입니다.

### 단계 2 — 판정 엔진과 백테스트

과거 지표 백필, 하락 국면 정답지 구축, `RiskVerdict` 계약 도입, 가중치·임계값 튜닝, 백테스트 결과 저장까지입니다. 단계 1 에서 만든 카탈로그와 수집 경로를 그대로 씁니다.

완료 판정은 12개 하락 국면에 대한 적중률·선행일수·오경보율이 산출되고, 검증 구간(2023~2026)에서 학습 구간 성능이 유지되는 것입니다.

### 단계 3 — 화면 재설계

판정 배너, 근거 블록, 2계층 지표 목록, 섹션 상시 노출, 백테스트 실적 표시, 클라이언트 재계산 제거입니다. 단계 2 의 `RiskVerdict` 를 그대로 받아 표시만 합니다.

## 14. 미해결 사항 (2026-08-20 갱신)

2026-08-20 실측으로 다섯 항목 중 네 항목이 해소되었습니다.

- ~~한국은행 ECOS 인증키~~ → **불필요.** 네이버 금융 marketindex(`IRR_GOVT03Y`)가 무키로 2009년까지 제공함을 실측 확인. KR_3Y 를 이 소스로 활성화하고 2015-01-02~2026-08-19 백필 완료(2,858행).
- ~~`BAMLH0A0HYM2` API 키 경로 확인~~ → **키로도 안 열림.** FRED API 키 경로 실측 결과 관측 시작이 2023-08-21 로 무키 CSV 와 동일(ICE 저작권 제한). 백테스트에서 HY_SPREAD 는 2023-08 이후 국면만 반영합니다.
- ~~GOLD·EWY Yahoo 백필~~ → **성공.** GOLD·EWY·DXY 모두 2015-01-02 부터 전 구간 백필 완료.
- KRX OpenAPI 키 — VKOSPI 는 `KR_VOL_20D` 로 대체 운영 중이라 시급하지 않음. 키 확보 시 교체 검토는 유지.
- FreeSIS 신용잔고 요청 스펙 캡처 — 미해결. 실패 시 신용잔고를 범위에서 제외.
