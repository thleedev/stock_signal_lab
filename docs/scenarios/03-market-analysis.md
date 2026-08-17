# 시나리오 03 — 시황 분석과 위험 지수

> 시장 지표가 수집되어 위험 지수와 시황 화면으로 이어지는 흐름입니다.
> 관련 문서: 05(배치), 06(외부 연동), 08(프론트엔드)

## 데이터 수집

1. 배치 step6이 매 영업일 16:10에 Yahoo 11종(VIX·환율·금리·유가·지수 등)과 FRED 2종(하이일드 스프레드, 장단기 금리차), CNN Fear&Greed를 `market_indicators`에 적재합니다.
2. 배치 step7이 `cron/market-events`를 호출해 공휴일(Nager.Date)·선물옵션 만기일(룰 생성)·FOMC(FRED)·정적 폴백을 `market_events`에 채웁니다.
3. `/market` 화면은 추가로 `market-indicators/realtime`을 호출해 장중 실시간 값을 얹습니다.

## 점수 계산 — cron/market-score

step7이 이벤트 적재 직후 이 크론을 호출하며, 365일 지표 윈도우로 네 값을 계산해 `market_score_history`에 날짜 upsert합니다.

| 값 | 계산 |
|----|------|
| `total_score` | 지표별 90일 min/max 정규화 → 방향 반영 → `indicator_weights` 가중평균 |
| `risk_index` | 절대 임계값과 252일 분위수 중 더 위험한 레벨 채택 (하이브리드) |
| `event_risk_score` | 향후 30일 이벤트의 risk_score × 임박도 감쇠(당일 1.0~8일+ 0) 합산, 80 캡 |
| `combined_score` | total × 0.7 + event_risk × 0.3 |

## 위험 지수 규칙

`lib/market-thresholds.ts`가 13개 지표를 4단계(안전/주의/위험/극위험)로 판정합니다. 레벨 가중치는 0/1/3/6 비선형이며, VIX 기준으로 주의 20, 위험 25, 극위험 30입니다. KOSPI·KOSDAQ·EWY는 52주 고점 대비 낙폭, GOLD는 200일 이격을 파생 계산합니다.

해석 기준은 25 미만 안전(적극 매수), 50 미만 주의(분할 매수), 75 미만 위험(신규 진입 자제), 75 이상 극위험(현금 확대)입니다.

## 화면 반영

1. `/market`이 서버에서 지표 365일치·점수 이력 90건·향후 30일 이벤트를 조회합니다.
2. 클라이언트 `calculateRiskIndex`가 위험 지수를 재계산해 배너와 지표 카드(위험 레벨 내림차순)를 그립니다.
3. 대시보드의 위험 경보 배너와 `dashboard-risk-banner`는 `market_score_history` 최신 행을 씁니다.
4. ETF 섹터 센티먼트는 라씨 ETF 신호를 `etf_category_map` 수동 분류와 결합해 섹터별 강세·약세를 보여 줍니다.

## 이벤트 리스크 상세

이벤트별 기본 리스크 점수는 동시만기 -20, FOMC -15, CPI -12, 선물만기·고용 -10, GDP -8, 옵션만기·실적 -5, IPO -3입니다. `EventRiskBreakdown` 패널이 이벤트별 기여도를 펼쳐 보여 줍니다. 수동 이벤트는 `POST /api/v1/market-events`로 등록합니다.
