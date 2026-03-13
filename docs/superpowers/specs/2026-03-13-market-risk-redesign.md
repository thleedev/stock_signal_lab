# 투자 시황 위험 경보 시스템 재설계

**날짜:** 2026-03-13
**범위:** `/market` 페이지 전면 재설계 (UI + 점수 계산 로직)
**목표:** 현실과 동떨어진 시황 점수를 절대 임계값 기반 투자 위험 경보로 전환

---

## 1. 배경 및 문제 정의

### 현재 구조의 구조적 결함

현재 점수 계산은 **90일 상대 정규화** 방식을 사용한다:

```text
정규화 점수 = (현재값 - 90일최솟값) / (90일최댓값 - 90일최솟값) × 100
```

**문제:** 시장이 전반적으로 위험한 상태가 수개월 지속되면, 90일 범위 자체가 "위험한 구간"으로 이동하여 현재 값이 그 안에서 "중간"으로 평가된다.

**실제 예시 (2026-03-13):**

- USD/KRW 1,493원: 90일 범위가 1,460~1,500이면 → 정규화 중간 → "중립"으로 표시
- VIX: 데이터 수집 자체 실패 → 표시 안 됨
- 결과: 시장이 명백히 위험한데 "중립" 또는 "긍정적"으로 표시

---

## 2. 설계 목표

1. **즉각적 위험 인식:** 페이지 접속 즉시 현재 위험 단계 파악
2. **절대값 기반 판단:** 역사적으로 검증된 임계값으로 위험도 측정
3. **행동 가이드:** 위험 단계별 구체적인 투자 행동 권고
4. **새 지표 추가:** VKOSPI, CNN Fear & Greed 추가로 커버리지 확대
5. **VIX 버그 수정:** 데이터 수집 실패 원인 파악 및 수정

---

## 3. 점수 계산 로직 재설계

### 3.1 절대 임계값 정의 (`market-thresholds.ts` 신규 파일)

각 지표는 4단계 위험 레벨을 가진다:

- `0` = 안전 (🟢)
- `1` = 주의 (🟡)
- `2` = 위험 (🟠)
- `3` = 극위험 (🔴)

| 지표 | 🟢 안전 | 🟡 주의 | 🟠 위험 | 🔴 극위험 | 방향 | 가중치 |
| --- | --- | --- | --- | --- | --- | --- |
| VIX | < 20 | 20~25 | 25~30 | ≥ 30 | 높을수록 위험 | 3 |
| VKOSPI | < 20 | 20~25 | 25~30 | ≥ 30 | 높을수록 위험 | 3 |
| USD_KRW | < 1,350 | 1,350~1,400 | 1,400~1,450 | ≥ 1,450 | 높을수록 위험 | 3 |
| DXY | < 100 | 100~104 | 104~108 | ≥ 108 | 높을수록 위험 | 2 |
| US_10Y | < 4.0 | 4.0~4.5 | 4.5~5.0 | ≥ 5.0 | 높을수록 위험 | 2 |
| WTI | < 70 | 70~80 | 80~95 | ≥ 95 | 높을수록 위험 | 1 |
| KOSPI | ≥ 2,600 | 2,400~2,600 | 2,200~2,400 | < 2,200 | 낮을수록 위험 | 2 |
| KOSDAQ | ≥ 800 | 700~800 | 600~700 | < 600 | 낮을수록 위험 | 1 |
| CNN_FEAR_GREED | ≥ 60 | 40~60 | 20~40 | < 20 | 낮을수록 위험 | 2 |
| EWY | ≥ 65 | 55~65 | 45~55 | < 45 | 낮을수록 위험 | 1 |

> **KOSPI/KOSDAQ/EWY 설계 결정:** 20일 MA 기반 괴리율 대신 절대값 임계값으로 단순화.
> 절대값 임계값으로도 극단적 위험 구간(KOSPI < 2,200)은 충분히 포착 가능.
> 20일 MA 기반 괴리율 계산은 2차 개선으로 미룸.

### 3.2 위험 지수 계산 공식

```text
레벨 가중치: 안전=0, 주의=1, 위험=3, 극위험=6
(비선형 설계: 소수의 극위험 지표에 민감하게 반응하도록 의도됨)

지표별 기여도 = 레벨가중치 × 지표중요도가중치

위험지수 = (Σ 기여도) / (6 × Σ 지표가중치) × 100
```

**데이터 누락 지표 처리 정책:** 수집 실패한 지표는 분자/분모 모두에서 제외하여 나머지 지표로만 계산한다. `getRiskLevel(type, value)` 함수는 `value`가 `null | undefined`이면 `null`을 반환하고, `calculateRiskIndex()`는 `null` 반환 지표를 건너뜀.

**결과 해석:**

| 위험 지수 | 단계 | 행동 권고 |
| --- | --- | --- |
| 0~25 | 🟢 안전 | 적극 매수 가능 |
| 25~50 | 🟡 주의 | 분할 매수, 비중 조절 |
| 50~75 | 🟠 위험 | 신규 진입 자제, 방어적 투자 |
| 75~100 | 🔴 극위험 | 현금 비중 확대, 손절 검토 |

### 3.3 기존 로직과 병행 보존

- `calculateMarketScore()` 함수는 **삭제하지 않고** 유지 (히스토리 데이터 호환성)
- 신규 함수 `calculateRiskIndex()` 는 `market-thresholds.ts`에 위치
- `market-score.ts`는 변경 없음 — cron route에서 직접 `market-thresholds.ts` 임포트
- DB `market_score_history`에 `risk_index` 컬럼 추가 (기존 `total_score` 유지)

---

## 4. 새 데이터 소스 추가

### 4.1 VKOSPI (한국 공포지수)

- **티커:** `^VKOSPI` (Yahoo Finance 지원)
- **수집 방법:** 기존 `getQuote()` 함수 그대로 활용
- **변경:** `YAHOO_TICKERS`에 `VKOSPI: '^VKOSPI'` 추가
- **임계값:** VIX와 동일 기준 적용

### 4.2 CNN Fear & Greed Index

- **엔드포인트:** `https://production.dataviz.cnn.io/index/fearandgreed/graphdata/`
- **수집 방법:** cron route에서 HTTP fetch 추가 (API 키 불필요)
- **응답 스키마 검증:** `score` 필드가 0~100 숫자인지 확인 후 저장 (스키마 변경 대응)
- **저장:** `market_indicators` 테이블, `indicator_type = 'CNN_FEAR_GREED'`
- **누락/실패 처리:** CNN fetch 실패 시 → 기존 `FEAR_GREED` (VIX 기반 자체 계산값)로 대체하여 `CNN_FEAR_GREED` 슬롯에 저장. 즉 `calculateRiskIndex()`는 항상 단일 공포탐욕 슬롯(`CNN_FEAR_GREED`)만 참조하며, cron이 최선의 값을 채워 넣음.
- **주의:** 비공식 엔드포인트 — 실패해도 cron 전체는 계속 진행

### 4.3 VIX 수집 버그 수정

- 현재 `^VIX` 티커가 `YAHOO_TICKERS`에 있으나 데이터가 DB에 없음
- **근본 원인 확인:** 구현 전 `getQuote('^VIX')` 응답을 로깅하여 `regularMarketPrice` null 여부 파악
- **수정 방향:** `regularMarketPrice`가 null이면 `regularMarketPreviousClose` → `regularMarketOpen` 순으로 폴백
- cron route에 개별 지표 수집 성공/실패 로그 추가 (현재 실패해도 조용히 넘어감)

---

## 5. UI 재설계

### 5.1 페이지 구조

```text
┌─────────────────────────────────────────────┐
│  경보 배너 (Hero)                             │
│  🔴 위험  위험지수 68.4                       │
│  현재 5개 지표가 위험 구간입니다               │
│  "신규 진입을 자제하고 현금 비중을 높이세요"    │
└─────────────────────────────────────────────┘

┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ 위험 지표     │ │ 이벤트 리스크 │ │  7일 추이     │
│  5개 / 10개  │ │     높음      │ │  📈 2단계 악화│
└──────────────┘ └──────────────┘ └──────────────┘

─── 지표별 위험 현황 (위험 레벨 순 정렬) ─────────
🔴 USD/KRW   1,493원   극위험   기준 1,450원 초과
🔴 VKOSPI    28.4      위험     기준 25 초과
🟠 VIX       22.1      주의     기준 20~25
🟡 DXY       104.8     주의     기준 104~108
🟢 WTI       72.3      주의     기준 70~80
🟢 KOSPI     2,514     안전     기준 2,600 이상
...

─── 최근 30일 위험 지수 추이 ─────────────────────
[바 차트 - 위험지수 기준, 높을수록 붉게]

─── 예정 이벤트 ──────────────────────────────────
[기존 EventCalendar 유지]
```

### 5.2 제거 항목

- **가중치 슬라이더 패널** — 절대 임계값 기반으로 전환하면 사용자가 조작할 여지가 없어짐
- **3개 게이지 (통합/마켓심리/이벤트리스크)** — 경보 배너 1개로 통합

### 5.3 지표 카드 변경

**현재:** 정규화 점수 바 + 설명 텍스트

**변경:**

- 현재값 + 위험 레벨 배지 (🔴🟠🟡🟢)
- 해당 레벨의 임계값 표시 ("1,450원 초과" 등)
- 전일 대비 변화율 유지
- `risk_index`가 null (집계 전)이면 기존 `total_score` 기반으로 폴백 표시

---

## 6. 파일 변경 목록

### 신규 생성

- `web/src/lib/market-thresholds.ts` — 절대 임계값 정의 + `getRiskLevel()` + `calculateRiskIndex()`

### 수정

- `web/src/types/market.ts`
  - `IndicatorType` union에 `'VKOSPI'`, `'CNN_FEAR_GREED'` 추가
  - `YAHOO_TICKERS`에 `VKOSPI: '^VKOSPI'` 추가
  - `MarketScoreHistory` 인터페이스에 `risk_index?: number` 필드 추가
  - `RISK_INTERPRETATIONS` 상수 추가 (위험 단계별 레이블/색상/행동권고)
- `web/src/app/api/v1/cron/market-indicators/route.ts` — CNN Fear & Greed fetch 추가, VIX 버그 수정, risk_index 계산 및 저장
- `web/src/app/market/page.tsx` — `scoreHistory` select에 `risk_index` 추가
- `web/src/components/market/market-client.tsx` — UI 전면 재설계

### DB 마이그레이션

- `market_score_history` 테이블에 `risk_index NUMERIC DEFAULT NULL` 컬럼 추가
- `DEFAULT NULL`: 기존 레코드 하위 호환 보장, 이전 히스토리는 null로 표시

---

## 7. 구현 순서

1. `market-thresholds.ts` 신규 작성 (임계값 + 계산 함수)
2. `market.ts` 타입 수정 (VKOSPI, CNN_FEAR_GREED 추가)
3. cron route 수정 (VKOSPI 수집, CNN Fear & Greed, VIX 버그 수정, risk_index 저장)
4. DB 마이그레이션 (risk_index 컬럼)
5. `market/page.tsx` 서버 데이터 조회 수정
6. `market-client.tsx` UI 재설계

---

## 8. 범위 외 (2차)

- 외국인 KOSPI 순매수 (pykrx, Python 환경 필요)
- 한국 CDS 5년물 (Investing.com 스크래핑)
- 한국은행 ECOS API 연동
- KOSPI/KOSDAQ 20일 MA 기반 괴리율 계산
