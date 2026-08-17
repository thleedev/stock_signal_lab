# 시나리오 02 — 일일 데이터 배치

> GitHub Actions daily-batch가 하루 동안 데이터를 채우는 흐름입니다.
> 관련 문서: 05(배치), 03(DB)

## 하루 타임라인 (KST, 평일 기준)

| 시각 | 잡 | 내용 |
|------|-----|------|
| 03:00 | pg_cron | `mms_raw_messages` 7일 초과 삭제 |
| 07:00 | repair 배치 | 전일 `daily_prices` 누락 종목 재수집 (주말 포함 매일) |
| 08:00~08:45 | prices-only ×4 | 장 전 시세·점수 갱신 (15분 간격) |
| 09:00~20:45 | prices-only ×48 | 장중 시세·점수 갱신 (15분 간격) |
| 16:10 | full 배치 | step1~10 전체 파이프라인 |
| 수시 | 이벤트 | 신호 수신 시 intraday-prices, UI 버튼 prices/refresh |

## 기본 흐름 — full 배치 (16:10)

1. `batch_runs`에 running 레코드를 삽입합니다. 프론트의 `CollectingBanner`가 15초 폴링으로 이를 감지해 수집 중 배너를 띄웁니다.
2. step1 일봉: `stock_cache` 전종목을 대상으로 네이버 fchart에서 당일 캔들을 확정 저장합니다(`is_provisional=false`).
3. step2 수급: 종목별 최근 5영업일 데이터로 외국인·기관 당일·5일 누적·연속 streak를 계산합니다.
4. step3 공매도: KRX에서 당일 공매도 비율을 수집합니다. 휴장일은 데이터 없음으로 정상 종료합니다.
5. step4 점수: `calcCompositeScore`로 전종목 축 점수를 계산해 `stock_scores`에 저장합니다. 웹 `stock-ranking` API는 이 결과에 가중치만 다시 적용합니다.
6. step5 AI 리포트: Vercel의 `ai-recommendations/generate`를 호출해 당일 추천을 재생성합니다.
7. step6 시황: Yahoo 11종 + FRED 2종 + CNN Fear&Greed를 `market_indicators`에 적재합니다.
8. step7 이벤트: `cron/market-events` → `cron/market-score`를 순차 호출합니다. 이벤트를 먼저 적재해야 이벤트 리스크가 당일 점수에 반영되기 때문입니다.
9. step8 정리: `daily_prices` 2년 초과 데이터를 삭제해 Supabase 무료 용량을 지킵니다.
10. step9·10 섹터·테마: KRX 업종 매핑과 네이버 테마 크롤링으로 `stock_sectors`·`stock_themes`·`theme_stocks`를 갱신합니다.
11. 종료 시 `batch_runs`를 done으로 갱신하고 summary(수집·점수·오류 건수)를 남깁니다.

## 대안 흐름

- prices-only: 전종목 현재가 upsert와 `refresh_high_90d_pct` RPC, step4 점수 재계산만 수행합니다. 장중 실시간성을 담당합니다.
- repair: step1을 repair 모드로만 실행해 누락 일봉을 보정합니다.
- 수동 실행: GitHub UI의 workflow_dispatch 또는 `POST /api/v1/admin/trigger-batch`(CRON_SECRET 인증, GH_PAT로 workflow 기동)로 임의 시점에 실행합니다. 이때 pending 레코드가 먼저 생기고 GHA가 running을 별도 기록합니다.

## 예외 처리

- step1~4 오류는 errors 배열에 누적하고 계속 진행합니다. step5~10은 개별 catch로 격리합니다.
- 배치가 죽어 상태 갱신이 끊기면 `batch-runs/status` API가 stale 기준(prices-only 10분/repair 30분/full 60분)으로 failed 처리합니다.
- 공휴일에도 배치는 실행되며, step1이 대상일 캔들 부재로 전량 실패 카운트를 남기는 것이 정상 동작입니다.
