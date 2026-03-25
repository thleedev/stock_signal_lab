# Standard 모델 상승확률 기반 재순위화 설계

> 작성일: 2026-03-25

## 1. 개요

### 목적

기존 Standard 모델(종합추천)의 순위화 기준을 **"좋은 종목인가?"에서 "중기(1~4주) 상승 확률이 높고 하락 리스크가 낮은 종목인가?"**로 전환한다.

### 핵심 변경 요약

1. **가중치 재배분**: 밸류에이션 비중 상향(10→20), 수급 소폭 하향(40→30)
2. **기술 점수 → 추세 점수 재설계**: 이동평균 정배열·추세 지속일수를 핵심 지표로 승격, 52주 저점 근접 축소. 감점은 리스크 레이어로 이전
3. **리스크 감점 레이어 신규 추가**: 기술적 과열 + 수급 이탈 합산, 15% 감산

### 기존 모델과의 차이

| | 기존 Standard | 변경 후 |
|---|---|---|
| **핵심 질문** | "좋은 종목인가?" | "1~4주 내 오를 확률이 높고 빠질 확률이 낮은가?" |
| **기술 점수 핵심** | 52주 위치, RSI, MACD 혼합 | **이동평균 정배열 + 추세 지속일수** 중심 |
| **52주 저점 근접** | 3점 | 2점 (보조) |
| **밸류에이션** | 10% | **20%** (하방 지지력) |
| **수급** | 40% | **30%** |
| **리스크 관리** | 추세 점수 내 감점으로 혼재 | **별도 리스크 레이어 15% 감산** (과열 + 수급 이탈) |

---

## 2. 가중치 체계

### 기본 가중치

| 카테고리 | 기존 | 변경 | 역할 |
|----------|:---:|:---:|------|
| 신호 | 10 | **10** | BUY 신호 개수·신선도 |
| 추세 (기존 기술) | 40 | **40** | 내부 구성 변경 (MA정배열·추세지속 중심), 순수 가점만 |
| 밸류에이션 | 10 | **20** | 저평가 = 하방 지지 + 상승폭 확대 |
| 수급 | 40 | **30** | 스마트머니 방향 |
| 리스크 | - | **-15 (감산)** | 과열·이탈 필터 |

### 총점 공식

```
기본 점수 = 신호_norm × 10 + 추세_norm × 40 + 밸류_norm × 20 + 수급_norm × 30
최종 점수 = 기본 점수 - 리스크_norm × 15
           → clamp(0, 100)
```

> 가중치 합계 검증: signal + trend + valuation + supply = 100. risk는 감산 전용이므로 합계에 포함하지 않음.

### 정규화 규칙

| 카테고리 | 원점수 범위 | 정규화 공식 |
|----------|-----------|-------------|
| 신호 | 0 ~ 30 | `raw / 30 × 100` |
| 추세 | 0 ~ 58 | `raw / 58 × 100` |
| 밸류에이션 | 0 ~ 25 | `raw / 25 × 100` |
| 수급 | -10 ~ 45 | `(raw + 10) / 55 × 100` |
| 리스크 | 0 ~ 100 | `clamp(raw, 0, 100)` |

---

## 3. 추세 점수 상세 (기존 기술 점수 재설계)

추세 점수는 **순수 가점 항목만** 포함한다. 기존 기술 점수의 감점 항목(쌍봉, RSI 과열, 극단 급등)은 이중 패널티를 방지하기 위해 **리스크 레이어(4절)로 이전**한다.

**원점수 범위: 0 ~ 58** → 정규화: `raw / 58 × 100`

### 점수 구성

#### A. 이동평균 정배열 (최대 12점) — 핵심 지표

5일선 > 20일선 > 60일선 정배열 여부.

| 조건 | 점수 | 해석 |
|------|:---:|------|
| 5일 > 20일 > 60일 (완전 정배열) | **12** | 확실한 중기 상승 추세 |
| 5일 > 20일만 (60일 미충족) | **5** | 단기 추세 양호, 중기 미확인 |

#### B. 추세 지속일수 (최대 10점) — 신규

현재가가 20일 이동평균선 위에 연속으로 위치한 일수.

| 연속일수 | 점수 | 해석 |
|----------|:---:|------|
| ≥ 15일 | **10** | 안정적 중기 상승 추세 |
| ≥ 10일 | **6** | 추세 확인 |
| ≥ 5일 | **3** | 추세 초기 |
| < 5일 | **0** | 추세 미형성 |

> 구현: `daily_prices` 최근 20일 데이터에서 종가 > SMA20인 연속일수 역순 카운트

#### C. 골든크로스 (최대 5점) — 유지

5일선이 20일선 상향 돌파 (최근 3일 내).

#### D. RSI 적정구간 (최대 4점) — 소폭 축소

RSI 30~50 구간 = 과매도 탈출 + 아직 과매수 아님.

#### E. MACD 골든크로스 (최대 4점) — 유지

MACD 라인이 시그널 라인 상향 돌파 (최근 3일 내).

#### F. 거래량 급증 (최대 4점) — 유지

20일 평균 대비 2배 이상.

#### G. 불새패턴 (최대 3점) — 축소

3일 이상 음봉/보합 후 장대양봉 반등.

#### H. 이격도 반등 (최대 3점) — 축소

현재가가 20일선 대비 92~98% + 오늘 양봉.

#### I. 거래량 바닥 탈출 (최대 3점) — 축소

10일 평균 거래량이 20일 평균의 50% 이하 → 오늘 2배 이상.

#### J. 연속하락 후 반등 (최대 3점) — 축소

3일 이상 연속 하락 후 +1.5% 이상 양봉.

#### K. 초기진입 보너스 (최대 3점) — 유지

골든크로스/MACD/거래량 신호 + 5일 등락률 0~3% = 아직 덜 오름.

#### L. 볼린저 하단 복귀 (최대 2점) — 축소

볼린저 밴드 하단 이탈 후 복귀 (최근 5일 내).

#### M. 52주 저점 근접 (최대 2점) — 축소

현재가가 52주 저점의 ±5% 이내.

### 점수 범위 검증

- 최대: 12+10+5+4+4+4+3+3+3+3+3+2+2 = **58**
- 최소: 0 (감점 항목 없음 — 리스크 레이어로 이전)
- clamp: `Math.max(0, Math.min(score, 58))`

### TechnicalScoreResult 인터페이스 변경

```typescript
// 추가 필드
trend_days: number;  // 20일선 위 연속일수 (신규)

// 범위 변경
score: number;  // 기존 -12~48 → 0~58
```

---

## 4. 리스크 감점 체계 (신규)

기술적 과열과 수급 이탈을 합산하여 최종 점수에서 감산한다. 기존 추세 점수 내 감점 항목(쌍봉, RSI 과열, 극단 급등)도 여기로 통합하여 **이중 패널티를 방지**한다.

**원점수 범위: 0 ~ 100** (기술적 위험 최대 50 + 수급 이탈 최대 50)

### 4.1 기술적 위험 (최대 50점)

| 조건 | 감점 | 근거 |
|------|:---:|------|
| RSI ≥ 70 (과매수) | **15** | 단기 조정 임박 확률 높음 |
| 5일 누적 등락률 ≥ +15% | **12** | 급등 피로, 차익 매물 예상 |
| 5일 누적 등락률 ≥ +10% (15% 미만) | **8** | 과열 초기 징후 |
| 이격도 ≥ 110% (20일선 대비) | **10** | 평균 회귀 압력 |
| 볼린저 상단 돌파 (현재가 > upper band) | **8** | 과매수 영역 |
| 쌍봉 저항선 근접 | **5** | 매도 압력 구간 |

> 5일 등락률 +15%와 +10% 조건은 **중복 불가** — 하나만 적용
> 쌍봉 판정 로직은 기존 `technical-score.ts`의 쌍봉 패턴 검출 로직을 그대로 `risk-score.ts`로 이전

### 4.2 수급 이탈 (최대 50점)

| 조건 | 감점 | 근거 |
|------|:---:|------|
| 외국인 + 기관 동반 순매도 | **20** | 스마트머니 이탈 = 가장 강한 하락 신호 |
| 외국인만 순매도 | **10** | 부분 이탈 |
| 기관만 순매도 | **8** | 부분 이탈 |
| 외국인 3일 연속 순매도 | **8** | 추세적 이탈 |
| 기관 3일 연속 순매도 | **6** | 추세적 이탈 |
| 공매도 비율 ≥ 10% | **8** | 하락 베팅 과다 |

> 동반 매도(20점)와 개별 매도(10/8점)는 **중복 불가** — 동반이면 20점만 적용
> 연속 매도(8/6점)는 별도 합산 가능

### 데이터 가용성

| 필요 데이터 | 소스 | 비고 |
|---|---|---|
| 외국인/기관 당일 순매수 | `stock_cache.foreign_net_qty`, `institution_net_qty` | 조회 가능 |
| 외국인/기관 연속일수 | `stock_cache.foreign_streak`, `institution_streak` | streak ≤ -3 으로 판정 |
| 공매도 비율 | `stock_cache.short_sell_ratio` | 당일 데이터만 사용, `null`이면 조건 미적용 |
| RSI, 이격도, 볼린저 | `daily_prices` 기반 계산 | 추세 점수와 동일 가격 데이터 사용 |
| 5일 등락률 | `daily_prices` 최근 6일 종가 | 계산 가능 |

### 감산 공식

```
리스크 원점수 = 기술적 위험 합계 + 수급 이탈 합계
리스크_norm = clamp(리스크 원점수, 0, 100)
감산 = 리스크_norm × 15 / 100
```

예시:
- 리스크 0점 → 감산 0점
- 리스크 40점 → 감산 6점
- 리스크 100점 → 감산 15점 (최대)

---

## 5. 타입 및 인터페이스 변경

### AiRecommendationWeights

```typescript
// 변경 전
export interface AiRecommendationWeights {
  signal: number;
  technical: number;
  valuation: number;
  supply: number;
}

// 변경 후
export interface AiRecommendationWeights {
  signal: number;
  trend: number;       // technical → trend 리네이밍
  valuation: number;
  supply: number;
  risk: number;        // 신규 (감산)
}
```

### DEFAULT_WEIGHTS

```typescript
// 변경 전
export const DEFAULT_WEIGHTS = {
  signal: 10, technical: 40, valuation: 10, supply: 40
};

// 변경 후
export const DEFAULT_WEIGHTS = {
  signal: 10, trend: 40, valuation: 20, supply: 30, risk: 15
};
```

### AiRecommendation 인터페이스

```typescript
// 추가 필드
risk_score: number | null;       // 리스크 원점수 (0~100)
trend_days: number | null;       // 20일선 위 연속일수
weight_risk: number;             // 리스크 가중치

// 리네이밍
weight_technical → weight_trend
technical_score → trend_score
```

### TechnicalScoreResult 인터페이스

```typescript
// 추가 필드
trend_days: number;  // 20일선 위 연속일수

// 범위 변경
score: number;  // 기존 -12~48 → 0~58

// 감점 관련 필드 유지 (risk-score.ts에서 참조)
double_top: boolean;  // 리스크 레이어에서 사용
```

### 총점 계산식

```typescript
// 변경 전
total_score = (signal/30)*10 + ((tech+12)/60)*40 + (val/25)*10 + ((supply+10)/55)*40

// 변경 후
const base = (signal/30)*10 + (trend/58)*40 + (val/25)*20 + ((supply+10)/55)*30
total_score = clamp(base - (risk/100)*15, 0, 100)
```

### 가중치 합계 검증 (generate route)

```typescript
// 변경 전
weightSum = signal + technical + valuation + supply  // = 100

// 변경 후
weightSum = signal + trend + valuation + supply  // = 100 (risk는 별도)
// risk는 0~100 범위 검증만 수행
```

---

## 6. 변경 파일 목록

### 변경 파일

| 파일 | 변경 내용 |
|------|----------|
| `web/src/types/ai-recommendation.ts` | 타입/가중치 리네이밍 + risk 필드 추가 |
| `web/src/lib/ai-recommendation/technical-score.ts` | 추세 점수로 내부 재설계. MA정배열 12점, 추세지속일수 10점 신규, 52주 2점, 감점 제거. 범위 0~58. `TechnicalScoreResult`에 `trend_days` 추가 |
| `web/src/lib/ai-recommendation/index.ts` | 가중치 공식 변경 + 리스크 계산 호출 + 정규화 변경 |
| `web/src/app/api/v1/ai-recommendations/generate/route.ts` | weight 파라미터에 risk 추가, 가중치 합계 검증 로직 수정 (`technical→trend`, risk 별도 검증), short_term insert의 `weight_technical→weight_trend` 수정 |
| `web/src/app/api/v1/ai-recommendations/route.ts` | 응답에 risk_score, trend_days 포함 |
| `web/src/components/signals/AiRecommendationSection.tsx` | `technical_score→trend_score`, `weight_technical→weight_trend` 리네이밍 |
| `web/src/components/signals/StockRankingSection.tsx` | `technical_score→trend_score`, 정규화 공식 `(+12)/60 → /58` 변경 |
| `web/src/components/signals/UnifiedAnalysisSection.tsx` | `technical_score→trend_score`, 정규화 공식 `(+12)/60 → /58` 변경 |

### 신규 파일

| 파일 | 내용 |
|------|------|
| `web/src/lib/ai-recommendation/risk-score.ts` | 기술적 위험 + 수급 이탈 감점 계산. 쌍봉 판정 로직은 기존 `technical-score.ts`에서 이전 |
| `supabase/migrations/YYYYMMDD_add_risk_trend_columns.sql` | risk_score, trend_score, trend_days, weight_risk 컬럼 추가, weight_technical→weight_trend·technical_score→trend_score 리네이밍 |

### 변경 없음

| 파일 | 이유 |
|------|------|
| `signal-score.ts` | 변경 없음 |
| `valuation-score.ts` | 변경 없음 |
| `supply-score.ts` | 변경 없음 |
| `short-term-momentum.ts` | Short-term 모델은 별도 체계 |

### 하위 호환성

- DB 마이그레이션에서 기존 데이터의 `weight_technical` → `weight_trend`, `technical_score` → `trend_score` 값 이전 포함
- 기존 저장된 추천 데이터는 리스크 미적용 상태로 유지 (`risk_score = null`)
- `weight_risk`는 기존 데이터에 `null` (리스크 미적용 시대의 데이터)
