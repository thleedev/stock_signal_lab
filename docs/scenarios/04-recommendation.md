# 시나리오 04 — 종목추천 생성과 조회

> 오늘의 BUY 신호가 AI 추천 목록으로 이어지는 흐름입니다.
> 관련 문서: 07(스코어링), 04(API)

## 생성 트리거 3종

| 트리거 | 시점 |
|--------|------|
| GHA step5 | 매 영업일 16:10 full 배치 |
| 텔레그램 웹훅 | `[SIGNAL_BATCH]` 수신 성공 직후 |
| UI 수동 | 추천 화면 새로고침, 당일 데이터가 없을 때 lazy 생성 |

## 기본 흐름 — standard 모델

1. `POST /api/v1/ai-recommendations/generate`가 `model=standard`로 호출됩니다.
2. `fetchTodayBuySymbols()`가 오늘 BUY·BUY_FORECAST 신호 종목을 후보로 수집합니다.
3. 후보 종목의 데이터를 11개 쿼리로 병렬 조회합니다. stock_cache(재무·수급), stock_info, signals(30일), daily_prices(65일), stock_dart_info, 테마 테이블, market_indicators(KOSPI 등락률)가 대상입니다. 캐시에 없는 값은 네이버에서 실시간 보강합니다.
4. 종목마다 시총 티어(large/mid/small)를 판정하고 7축 점수(signal·trend·valuation·supply·earnings_momentum·catalyst·risk)를 계산합니다.
5. 정규화 가중합 + 콤보 보너스 − 리스크 감산 후 시장 멀티플라이어를 곱해 총점을 냅니다.
6. 당일 standard 행만 삭제하고 순위대로 재삽입합니다. short_term 행은 보존합니다.

## 대안 흐름 — short_term 모델

가중치 5종(momentum/supply/catalyst/valuation/risk)을 바디로 받을 수 있으며 핵심 4종 합이 100±1이어야 합니다. 프리필터(등락률·거래대금·종가위치·수급·과열·촉매)를 통과한 종목만 스코어링 단계에 진입합니다. 거래량 폭증(300~700%+)이 프리필터 완화와 catalyst 최대 55점을 좌우하는 핵심 변수입니다.

## 조회 흐름

1. `GET /api/v1/ai-recommendations?model=standard`가 rank 순으로 반환합니다.
2. standard 모델은 저장 당시의 `total_candidates`와 현재 BUY 종목 수를 비교해 `needs_refresh`를 알려 줍니다. 신호가 늘었으면 UI가 재생성을 유도합니다.

## 종목분석 랭킹과의 관계

추천(ai_recommendations)과 별개로, 종목분석 탭의 랭킹은 배치 step4가 사전 계산한 `stock_scores`를 씁니다.

1. GHA step4가 전종목 4축 점수를 `calcCompositeScore`로 계산해 저장합니다.
2. `GET /api/v1/stock-ranking`이 저장된 축 점수에 스타일·커스텀 가중치를 다시 적용해 정렬합니다. 현재 BUY 상태(`has_active_sell=false`) 종목만 노출합니다.
3. 스냅샷 저장 시 `snapshot_sessions` + `stock_ranking_snapshot`에 세션 단위로 이력이 남고, 종목 상세 패널의 수익률 추이가 이 이력을 사용합니다.
