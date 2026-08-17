# 스코어링 체계

> 코드베이스에는 독립적인 스코어링 엔진 4계열이 공존합니다. 이 문서는 각 엔진의 위치·용도·핵심 수치와 기존 문서와의 차이를 기록합니다.
> 조사 기준일: 2026-07-22

## 1. 엔진 4계열과 사용처

| 엔진 | 디렉터리 | 소비 API | 화면 |
|------|----------|----------|------|
| A. 종목추천 standard (v2) | `lib/ai-recommendation/` | `ai-recommendations/generate` | AI 추천 |
| B. 단기추천 short_term | `lib/ai-recommendation/short-term/` | 같은 라우트 (model 파라미터) | 단기 추천 |
| C. 4축 composite | `lib/scoring/` | `stock-analysis`, `stock-ranking`, GHA step4 | 종목분석 랭킹·스냅샷 |
| D. 통합 unified | `lib/unified-scoring/` | `stock-analysis` (style 파라미터) | 종목분석 스타일 프리셋 |
| 보조. 체크리스트 | `lib/checklist-recommendation/` | D의 체크리스트 매핑 | 조건 필터 UI |

등급 컷도 계열마다 다릅니다. 단기추천은 A+ 78/A 65/B+ 52/B 40/C 28, unified는 A+ 85/A 70/B+ 55/B 40/C 25, 체크리스트는 충족률 A 80%/B 60%/C 40%입니다.

## 2. A. 종목추천 standard 모델

오늘 BUY·BUY_FORECAST 신호 종목만 후보로 삼아 7축 점수를 계산합니다. 가중치의 단일 출처는 `types/ai-recommendation.ts`의 `WEIGHTS_BY_TIER`입니다. 시총 티어는 large ≥ 5조, mid ≥ 5천억입니다.

| 구성요소 | large | mid | small | 원점수 범위 |
|----------|-------|-----|-------|-------------|
| signal | 4 | 6 | 8 | 0~30 |
| trend | 20 | 25 | 35 | 0~65 |
| valuation | 15 | 22 | 28 | 0~20 |
| supply | 8 | 8 | 8 | -10~45 |
| earnings_momentum | 22 | 16 | 0 | 0~80 |
| catalyst | 31 | 23 | 21 | 0~100 |
| risk (감산) | 15 | 15 | 15 | 0~100 |

총점은 정규화 가중합에서 리스크를 감산한 뒤 시장 멀티플라이어를 곱해 0~100으로 자릅니다.

v2에서 추가된 메커니즘은 네 가지입니다.

- 시장 멀티플라이어: KOSPI 등락률 +2% 이상 ×1.15, +1% 이상 ×1.08, 0 이상 ×1.0, -1% 이상 ×0.95, 그 미만 ×0.85
- 콤보 보너스 (최대 15): 52주저점 근접+거래량급증+수급전환첫날 12, 골든크로스+주봉상승+거래량급증 10, 볼린저복귀+거래량급증 6
- 수급 신선도 감쇄: `investor_updated_at` 당일 ×1.0, 어제 ×0.4, 그 이전 ×0.1. 깎인 supply 가중치는 trend로 이관
- 테마 보너스: 최강 테마 momentum_score 비례 최대 +10(supply 가산), 주도주 supply +5·trend +3, 과열 테마는 risk +5

catalyst 축(0~100)은 v2에서 신설되었습니다. 목표주가 상승여력(최대 30), 투자의견(최대 20), 신호 신선도(오늘 3소스 25), 진입 타이밍(신호가 대비 -3% 이하 15), 섹터 모멘텀(상위 3 +10, 약세 -8)로 구성됩니다. 목표주가·투자의견은 기존 valuation·earnings_momentum에서 catalyst로 이관되었습니다.

supply streak 배점은 v2에서 설계 철학이 반전되었습니다. 기존 "전환 첫날 우선"(1일=6점)에서 "지속성 우선"(1일 3, 2~3일 5, 4~5일 7, 6일+ 9)으로 바뀌었습니다.

## 3. B. 단기추천 short_term 모델

1~2일 내 상승 확률이 높은 종목을 고릅니다. 가중치는 momentum 20, supply 12, catalyst 51, valuation 17, risk 18(감산)입니다.

- 프리필터: 등락률 +0.5~8%(당일 신호 시 하한 0%, 강한 촉매 시 -1%), 거래대금 200억 이상(거래량 300%+ 폭증 시 면제), 종가위치 0.5 이상(강촉매 0.4, 거래량 500%+ 시 0.3), 외국인·기관 1주체 이상 순매수, 3일 누적 20% 이하, 촉매 존재
- catalyst (-10~100): 신호 신선도 최대 25, 섹터 모멘텀 최대 20, 신호가 대비 위치 최대 20, 거래량 폭증 최대 55. 거래량 폭증 항목은 DB 분석(최근 3개월 15%+ 급등 30건 전부 전날 거래량 3배 이상)을 근거로 신설되었습니다
- supply: 수급 데이터가 전부 null이면 중립 50점을 부여해 "모름"이 약세로 쏠리는 편향을 제거합니다
- risk: 과열(당일 +12% 이상 20), 캔들 위험(윗꼬리·음봉전환·장마감 급락), 추격매수(신호가 대비 +12% 이상 20) 감산

## 4. C. 4축 composite

`calcCompositeScore(input, style)`가 tech·supply·valuation·signal 4축을 가중합합니다. GHA step4가 전종목을 사전 계산해 `stock_scores`에 저장하고, `stock-ranking` API는 저장된 축 점수에 가중치만 다시 적용합니다.

| 스타일 | tech | supply | val | signal |
|--------|------|--------|-----|--------|
| balanced (large/mid/small) | 35/40/42 | 8 | 35/30/28 | 22 |
| value | 15 | 8 | 55 | 22 |
| supply | 20 | 30 | 20 | 30 |
| momentum | 50 | 8 | 15 | 27 |
| contrarian | 48 | 8 | 24 | 20 |

리스크는 `min(0.20, |riskScore|/100×0.20)` 비율 감산입니다. contrarian 스타일만 tech 축에 반전 신호 전용 `calcReversalScore`를 씁니다. 리스크 모듈은 관리종목 -100, 감사의견 비적정 -75, CB/BW -50 같은 즉시 감점을 포함합니다.

## 5. D. 통합 unified

5개 카테고리(signalTech/supply/valueGrowth/momentum/risk)를 각 0~100으로 계산해 양수 4개 가중합에서 리스크를 감산합니다. 스타일 프리셋 6종의 가중치입니다.

| 프리셋 | signalTech | supply | valueGrowth | momentum | risk |
|--------|-----------|--------|-------------|----------|------|
| 균형형 | 22 | 22 | 22 | 19 | 15 |
| 수급 추종형 | 15 | 35 | 10 | 25 | 15 |
| 가치투자형 | 10 | 12 | 53 | 10 | 15 |
| 단기 모멘텀형 | 20 | 20 | 5 | 40 | 15 |
| 역발상 과매도형 | 35 | 25 | 15 | 10 | 15 |
| AI 신호 추종형 | 35 | 10 | 5 | 35 | 15 |

커스텀 프리셋은 localStorage에 최대 10개 저장하며, 합계 100과 risk 10~20 규칙으로 검증합니다. 리스크 카테고리는 최근 3일 내 다중소스 신호가 활성이면 기술 과열 감점을 50% 감면하는 예외를 둡니다.

## 6. 보조. 체크리스트

`ALL_CONDITIONS` 15개 조건(trend·supply·valuation·risk·momentum 각 3개) 중 12개만 실제 평가 로직이 있고 momentum 3개는 na 처리됩니다. unified 엔진의 `extractChecklist()`가 카테고리 근거에서 조건을 라벨 패턴으로 매핑해 추출합니다. `generateChecklist()` 자체를 직접 호출하는 API 라우트는 없습니다.

## 7. 기존 문서와의 불일치

### 7.1 `docs/scoring-system.md` (2026-03-25) — 폐기 수준

문서 골격인 "신호 10% + 기술 40% + 밸류에이션 10% + 수급 40%" 체계와 `calcScore` 함수는 현재 코드에 존재하지 않습니다. 해당 역할은 C(4축 composite)와 D(unified)가 대체했습니다. 등급표도 어느 현행 기준과도 일치하지 않습니다.

### 7.2 `docs/scoring-logic.md` (2026-03-27) — v2 미반영

| 항목 | 문서 | 현재 코드 |
|------|------|-----------|
| standard 가중치 | signal 5/8/10, trend 28/35/45, supply 22/18/23, earnings 30/19/0 | signal 4/6/8, trend 20/25/35, supply 전 티어 8, earnings 22/16/0, catalyst 31/23/21 신설 |
| valuation 만점 | 0~25 (목표주가·투자의견 포함) | 0~20 (catalyst로 이관), Value Trap -4·복합 저평가 +5 신설 |
| earnings 만점 | 0~100 | 0~80 |
| supply streak | 전환 첫날 우선 (1일=6) | 지속성 우선 (6일+=9) |
| 단기 가중치 | momentum 38, supply 22, catalyst 28, valuation 7 | momentum 20, supply 12, catalyst 51, valuation 17 |
| 단기 catalyst | -10~60 | -10~100 (거래량 폭증 55 신설) |
| 단기 valuation | 0~25 | 0~75 |
| 시장 멀티플라이어·콤보·신선도 감쇄·테마 보너스 | 없음 | v2 신설 |

가중치를 조정할 때는 `types/ai-recommendation.ts`와 이 문서를 함께 갱신해야 합니다.

## 8. 미사용·미완성 코드

- `lib/ai/`의 Gemini 프로바이더: 정의만 있고 호출처가 없습니다. "AI 추천"은 명칭일 뿐 전부 규칙 기반입니다.
- 단기추천 supply의 프로그램 매매 점수: v1 데이터가 항상 null이라 실질 미동작입니다.
- `kis/investor-trends.ts`의 네이버 폴백: 파싱 미구현으로 항상 null입니다.
