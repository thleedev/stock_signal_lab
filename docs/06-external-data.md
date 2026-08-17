# 외부 데이터 연동

> `web/src/lib`의 외부 API 클라이언트와 인증·한도·용도를 기록합니다.
> 조사 기준일: 2026-07-22

## 1. 연동 현황 총괄

| 서비스 | 파일 | 인증 | 주요 용도 |
|--------|------|------|-----------|
| 네이버 증권 | `naver-stock-api.ts`, `naver-stock-extra.ts` | 없음 | 전종목 시세·일봉·수급·컨센서스·상장주식수 |
| KRX | `krx-api.ts`, `krx-shortsell-api.ts` | 없음 (헤더 위장) | 전종목 지표·투자자 순매수·공매도 비율 |
| KIS 한국투자증권 | `kis-api.ts`, `kis/investor-trends.ts` | OAuth2 (`KIS_APP_KEY/SECRET`) | 현재가·일봉·시장 투자자 동향 |
| Yahoo Finance | `yahoo-finance.ts` | 없음 (npm 패키지) | 시황 지표 12종 시세 |
| DART | `dart-api.ts` | `DART_API_KEY` (일 10K 한도) | CB/BW·대주주 지분·감사의견·실적 성장률 |
| FRED | `market-events.ts` | `FRED_API_KEY` | FOMC 일정, HY 스프레드, 장단기 금리차 |
| Nager.Date | `market-events.ts` | 없음 | 한국·미국 공휴일 |
| CNN | 배치 step6, realtime 라우트 | 없음 | Fear & Greed 지수 |
| Gemini | `ai/gemini.ts` | `GEMINI_API_KEY` | 텍스트 생성 (현재 호출처 없음) |
| FCM | `fcm.ts` | 서비스 계정 JWT | 신호 푸시 알림 |
| GitHub API | `admin/trigger-batch` | `GH_PAT` | 배치 워크플로 원격 기동 |
| 텔레그램 | `telegram-webhook` | 웹훅 시크릿 | PRIZM 신호·배치 우회 수신 |

## 2. 네이버 증권 — 주력 데이터 소스

인증이 필요 없고 커버리지가 넓어 사실상 주 데이터 공급원입니다. Base는 `https://m.stock.naver.com/api`입니다.

| 함수 | 원천 | 내용 |
|------|------|------|
| `fetchAllStockPrices()` | `stocks/marketValue/{KOSPI\|KOSDAQ}` | 전종목 시세. 100건 페이지 병렬, 2~5초 |
| `fetchStockInvestorData()` / `fetchBulkInvestorData()` | `stock/{symbol}/integration` | 외국인·기관 당일·5일 누적·연속 streak. 동시성 20 |
| `fetchNaverDailyPrices()` | `fchart.stock.naver.com/sise.nhn` | 일봉 XML 파싱 (기본 90일) |
| `fetchNaverBulkIntegration()` | integration + `finance/annual` | 전종목 지표·수급·컨센서스·ROE 예상. 동시성 100, 약 4,200종목 10~15초 |
| `fetchBatchStockExtra()` | `finance.naver.com/item/main.naver` HTML | 상장주식수, 관리종목 여부. 동시성 10 |

`krx-api.ts`의 `fetchBulkIndicators()`는 이름과 달리 실제로는 네이버 integration을 종목별로 호출합니다. Trailing 지표에 더해 forward PER/EPS, 목표주가, 투자의견 컨센서스를 가져오며, 실패율이 50%를 넘으면 500ms 대기로 레이트리밋을 방어합니다.

## 3. KRX

`POST https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd`에 bld 코드를 지정해 호출합니다.

| 함수 | bld | 내용 |
|------|-----|------|
| `fetchKrxIndicators()` | MDCSTAT03501 | 전종목 PER/PBR/EPS/BPS/배당수익률 (KOSPI+KOSDAQ 2회) |
| `fetchKrxInvestorData()` | MDCSTAT02303 | 투자자별 순매수. 기관은 TRDVAL1~7 합산, 외국인은 9+10 |
| `fetchKrxShortSell()` | MDCSTAT02401 | 당일 공매도 비율 (CVSRTSRT) |

## 4. KIS 한국투자증권

Base는 `https://openapi.koreainvestment.com:9443`입니다. 토큰은 3단계 캐시로 관리합니다. 인메모리 → Supabase `app_config`(`key='kis_token'`) → 신규 발급 순이며, 만료 시각에 1분 여유를 둡니다.

- `getCurrentPrice()` / `getDailyPrices()` / `getStockIndicators()` — 종목 시세·일봉·지표
- `getInvestorTrends()` — KOSPI/KOSDAQ 시장 단위 투자자별 매매동향

현재 API 라우트에서 KIS를 직접 쓰는 곳은 없고 스크립트 계층에서만 씁니다. `getInvestorTrendsFallback()`은 네이버 스크래핑 폴백이지만 파싱이 구현되지 않아 항상 null을 반환합니다.

## 5. DART

`fetchDartInfo(corpCode)`가 4개 엔드포인트를 `Promise.allSettled`로 병렬 호출합니다.

1. `/list` 최근 6개월 공시 → CB/BW 발행·자사주 취득 여부
2. `/hyslrSttus` 사업보고서 → 최대주주 지분율과 변동
3. `/irdsSttus` → 감사의견
4. `/fnlttSinglAcntAll` 연결재무제표 → 매출·영업이익 YoY 성장률

파서는 순수 함수로 분리되어 `dart-api.test.ts`가 검증하며, 결과는 `stock_dart_info` 테이블에 저장됩니다. 무료 티어라 하루 10K 요청 한도가 있습니다.

## 6. Yahoo Finance·시황 지표

`yahoo-finance2` 패키지로 조회하며, 가격은 `regularMarketPrice → previousClose → open` 폴백 체인을 씁니다. 티커 매핑은 `types/market.ts`의 `YAHOO_TICKERS`입니다. VIX, USD_KRW, US_10Y, WTI, KOSPI, KOSDAQ, GOLD, DXY, KR_3Y(122630.KS 대용), KORU, EWY, VKOSPI가 대상입니다.

FRED에서는 FOMC 일정(release_id=10)과 시황 지표 2종(HY_SPREAD=`BAMLH0A0HYM2`, YIELD_CURVE=`T10Y2Y`)을 가져옵니다. 폴백으로 `src/data/economic-calendar.json` 정적 번들(2026년 FOMC 8건·CPI 3건·고용 3건)을 씁니다.

## 7. FCM 푸시

`lib/fcm.ts`의 `sendSignalNotification()`은 외부 SDK 없이 구현되어 있습니다.

1. `notification_rules` 활성 규칙 확인 — 규칙이 없으면 모든 신호에 알림(기본 허용)
2. `fcm_tokens` 전체 토큰 조회
3. `FCM_SERVICE_ACCOUNT_JSON`(base64)을 디코딩해 Node `crypto`로 RS256 JWT 자체 서명 → Google OAuth2 토큰 교환
4. FCM HTTP v1 API로 토큰별 순차 전송. 미설정 시 콘솔 로그 폴백

## 8. 신호 데이터 보강 파이프라인

`lib/signal-data-enricher.ts`의 `enrichSignalStocks()`는 신호 수신 시점에 크론을 기다리지 않고 즉시 데이터를 확보합니다.

```
신호 심볼 (중복 제거)
  ├─ 병렬: 네이버 수급 / 네이버 지표·컨센서스 / 네이버 90일 일봉
  ├─ 1단계: stock_cache upsert (null 필드는 기존 값 유지)
  ├─ 1-b: 상장주식수·관리종목 갱신 + DART 정보 → stock_dart_info
  ├─ 2단계: daily_prices 500건 배치 upsert
  └─ 3단계: 신호 집계 → stock_cache (signal_count_30d, latest_signal_*, latest_sell_*)
```

`signal-constants.ts`의 `extractSignalPrice()`는 raw_data에서 가격을 `signal_price → recommend_price → buy_price → sell_price → price → current_price` 순으로 추출합니다. 전략 엔진과 스코어링이 함께 씁니다.

## 9. 환경변수 목록 (lib 기준)

| 환경변수 | 용도 |
|----------|------|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase 클라이언트 2종 |
| `KIS_APP_KEY` / `KIS_APP_SECRET` | KIS OAuth |
| `DART_API_KEY` | DART OpenAPI |
| `GEMINI_API_KEY` | Gemini (호출처 없음) |
| `FRED_API_KEY` | FRED |
| `FCM_PROJECT_ID` / `FCM_SERVICE_ACCOUNT_JSON` | FCM v1 |
| `COLLECTOR_API_KEY` / `CRON_SECRET` / `TELEGRAM_WEBHOOK_SECRET` | 수집·크론·웹훅 인증 |
| `GH_PAT` / `GH_REPO` | GHA 원격 기동 |
| `WEBAPP_URL` / `NEXT_PUBLIC_APP_URL` / `VERCEL_URL` | 자기 호출·링크 생성 |
