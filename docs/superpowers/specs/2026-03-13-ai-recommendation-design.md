# AI 추천 기능 설계 문서

**날짜:** 2026-03-13
**페이지:** `/signals` (AI 신호) 상단에 "오늘의 AI 추천" 섹션 추가
**방식:** 규칙 기반 점수 산출 (Gemini 없음)

---

## 1. 개요

오늘 발생한 BUY/BUY_FORECAST 신호 종목들을 대상으로 4개 카테고리의 규칙 기반 점수를 산출하고,
100점 만점 기준으로 상위 N종목(3/5/10 사용자 선택)을 추천한다.
추천 이유는 각 지표의 충족 여부를 태그 뱃지로 시각적으로 표시한다.

**성능 원칙:** 기술적 지표 계산은 DB에 저장된 `daily_prices` 데이터만 사용한다.
KIS 실시간 API 호출은 타임아웃 위험이 있어 계산 경로에서 제외한다.

---

## 2. 점수 구성 (가중치: 3:3:2:2)

### 2-1. 신호 강도 (30점 만점)

| 기준 | 점수 | 비고 |
|------|------|------|
| 3개 소스(라씨/스톡봇/퀀트) 동시 신호 | +15점 | 상호 배타적 |
| 2개 소스 신호 | +10점 | 상호 배타적 |
| 1개 소스 신호 | +5점 | 상호 배타적 |
| 오늘 신호 발생 | +5점 | |
| 최근 30일 신호 빈도 3회 이상 | +5점 | |
| 신호가격 대비 현재가 괴리율 (현재가 ≤ 신호가) | +5점 | signal_price null 시 0점 |

**신호 타입 필터:** `signal_type IN ('BUY', 'BUY_FORECAST')`
**신호가격 추출:** `signal_price` 컬럼 우선, null이면 `raw_data`에서 `extractSignalPrice()` 로직과 동일하게 추출

### 2-2. 기술적 분석 (30점 만점)

기술적 지표는 DB의 `daily_prices`에서 최근 60일 데이터로 계산한다.
데이터 부족(신규 상장 등)으로 계산 불가한 지표는 0점 처리하며, UI 카드에 '데이터 부족' 표시.

| 기준 | 점수 | 계산 방법 |
|------|------|-----------|
| RSI 30~50 구간 (과매도 회복) | +5점 | 14일 RSI |
| 골든크로스 (5일선이 20일선 상향 돌파) | +5점 | 최근 3일 내 발생 |
| 볼린저 밴드 하단 이탈 후 복귀 | +4점 | 20일 밴드, 최근 5일 내 |
| MACD 골든크로스 | +4점 | 12/26/9 기본 설정, 최근 3일 내 |
| 불새패턴 | +5점 | 아래 정의 참조 |
| 거래량 급증 (자기 20일 평균 대비 2배 이상) | +4점 | daily_prices.volume |
| 52주 저점 근처 (현재가가 52주 저점 ±5% 이내) | +3점 | |
| 쌍봉 패턴 (위험 경고) | -8점 | 아래 정의 참조 |

**불새패턴 정의:** 최근 5거래일 중 3일 이상 음봉/보합 후, 마지막 또는 최근 2일 내에 전일 대비 +3% 이상 양봉 발생 (몸통이 전체 캔들의 60% 이상)

**쌍봉 정의:** 최근 20거래일 내 두 개의 고점이 ±2% 이내 가격에서 형성되고, 그 사이에 -5% 이상 하락 구간이 존재하며, 현재가가 두 번째 고점에서 -3% 이내인 경우

### 2-3. 밸류에이션 (20점 만점)

`stock_cache` 테이블의 PER/PBR/ROE 사용. null이면 해당 항목 0점.

| 기준 | 점수 |
|------|------|
| PBR < 1.0 | +7점 |
| PER < 10 | +7점 |
| ROE > 10% | +6점 |

### 2-4. 수급 (20점 만점)

**현재 구현 범위:** KIS API에 종목별 외국인/기관 수급 조회 함수가 미구현 상태이므로,
`stock_cache`와 `daily_prices`에서 조회 가능한 데이터만 사용한다.
수급 점수가 0점으로 처리되는 경우 UI 카드에 '수급 미집계' 표시.

| 기준 | 점수 | 데이터 소스 |
|------|------|-------------|
| 외국인 순매수 3일 연속 | +8점 | KIS 미구현 → 0점 처리 |
| 기관 순매수 | +6점 | KIS 미구현 → 0점 처리 |
| 거래대금 급증 (섹터 내 종목 평균 대비 2배 이상) | +6점 | stock_cache.volume × current_price, stock_info.sector 기준 |

**거래대금 섹터 비교 계산:** `stock_info` 테이블의 `sector`로 같은 섹터 종목들의
`stock_cache.volume × stock_cache.current_price`를 단일 쿼리로 집계하여 평균 산출.
이는 기술적 분석의 "자기 20일 평균 대비 거래량" 지표와 측정 기준이 다르다(섹터 상대 비교).

---

## 3. 자동 새로고침 트리거

**경쟁 조건 방지:** GET은 항상 캐시를 반환하며, 재계산은 POST /generate로만 트리거된다.
단, 오늘 데이터가 전혀 없는 경우에만 GET에서 Lazy Generation을 수행한다.

### GET 요청 시 로직

```
1. DB에서 오늘 마지막 추천 결과 조회
2-a. 오늘 데이터 없음 → POST /generate 로직을 인라인 실행 후 반환 (Lazy Generation)
2-b. 오늘 데이터 있음 → 아래 비교 수행
3. 현재 BUY/BUY_FORECAST 신호 종목 수 조회
4. 현재 수 > 저장된 total_candidates → { data: 캐시, needs_refresh: true } 반환
   (UI에서 "신호 N개 추가됨, 새로고침 가능" 알림 표시)
5. 현재 수 ≤ 저장된 total_candidates → { data: 캐시, needs_refresh: false } 반환
```

→ `needs_refresh: true` 를 받은 UI는 알림을 표시하고 사용자가 버튼 클릭 시 POST /generate 호출.

---

## 4. 데이터베이스 스키마

### 신규 테이블: `ai_recommendations`

```sql
CREATE TABLE ai_recommendations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date              DATE NOT NULL,
  symbol            VARCHAR(10) NOT NULL,
  name              VARCHAR(100),
  rank              INT NOT NULL,
  total_score       NUMERIC(5,1) NOT NULL,

  -- 항목별 점수
  signal_score      NUMERIC(4,1),
  technical_score   NUMERIC(4,1),
  valuation_score   NUMERIC(4,1),
  supply_score      NUMERIC(4,1),

  -- 기술적 지표 상세
  signal_count      INT,
  rsi               NUMERIC(5,2),
  macd_cross        BOOLEAN DEFAULT FALSE,
  golden_cross      BOOLEAN DEFAULT FALSE,
  bollinger_bottom  BOOLEAN DEFAULT FALSE,
  phoenix_pattern   BOOLEAN DEFAULT FALSE,
  double_top        BOOLEAN DEFAULT FALSE,
  volume_surge      BOOLEAN DEFAULT FALSE,
  week52_low_near   BOOLEAN DEFAULT FALSE,

  -- 밸류에이션
  per               NUMERIC(8,2),
  pbr               NUMERIC(8,2),
  roe               NUMERIC(8,2),

  -- 수급
  foreign_buying    BOOLEAN DEFAULT FALSE,
  institution_buying BOOLEAN DEFAULT FALSE,
  volume_vs_sector  BOOLEAN DEFAULT FALSE,

  -- 메타
  total_candidates  INT,          -- 생성 당시 BUY/BUY_FORECAST 신호 전체 종목 수
  created_at        TIMESTAMPTZ DEFAULT NOW(),

  -- 복합 UNIQUE: 날짜+종목 조합으로 유일
  UNIQUE(date, symbol)
);

CREATE INDEX idx_ai_recommendations_date ON ai_recommendations(date);
```

**Upsert 방식:** `onConflict: 'date,symbol'` 로 재계산 시 덮어쓰기.

---

## 5. API 설계

### `GET /api/v1/ai-recommendations`

```
Query Parameters:
  - date: string  기본값: 오늘 (YYYY-MM-DD)
  - limit: 3 | 5 | 10  기본값: 5

Response:
{
  "recommendations": [...],
  "generated_at": "2026-03-13T15:32:00+09:00",
  "total_candidates": 47,
  "needs_refresh": false    // true이면 UI에서 "N개 신호 추가됨" 알림
}
```

**Lazy Generation:** 오늘 데이터 없으면 즉시 계산. `export const maxDuration = 120` 설정.

---

### `POST /api/v1/ai-recommendations/generate`

수동 새로고침 트리거. 오늘 날짜 데이터를 강제 재계산 후 upsert.

```
export const maxDuration = 120
```

---

## 6. 모듈 구조

```
/web/src/lib/ai-recommendation/
  ├── index.ts            -- 오케스트레이터 (점수 집계 및 순위 산출)
  ├── signal-score.ts     -- 신호 강도 점수 계산
  ├── technical-score.ts  -- RSI, MACD, 볼린저, 패턴 계산 (daily_prices DB만 사용)
  ├── valuation-score.ts  -- PER, PBR, ROE 점수 계산 (stock_cache)
  └── supply-score.ts     -- 수급 점수 계산 (stock_cache + stock_info 섹터 집계)

/web/src/app/api/v1/ai-recommendations/
  ├── route.ts            -- GET 엔드포인트 (maxDuration=120)
  └── generate/
      └── route.ts        -- POST 엔드포인트 (maxDuration=120)

/web/src/components/signals/
  └── AiRecommendationSection.tsx  -- 'use client' Client Component
```

---

## 7. UI 구성

### 위치
`/signals` 페이지 기존 신호 목록 **상단**에 `AiRecommendationSection` 삽입.

### 컴포넌트 경계
`AiRecommendationSection`은 `'use client'` Client Component로 구현.
`signals/page.tsx` (Server Component)에서 초기 추천 데이터를 서버사이드 prefetch하여
props로 전달한다. 이후 새로고침은 클라이언트에서 fetch.

### 구성 요소

1. **섹션 헤더**
   - 제목: "오늘의 AI 추천"
   - 종목 수 선택: 3 / 5 / 10 드롭다운
   - ⚙️ 가중치 설정 버튼: 클릭 시 인라인 패널 토글
     - 신호강도 / 기술적 / 밸류에이션 / 수급 슬라이더(0~100, 10 단위)
     - 합계가 100이 되도록 실시간 표시 (초과 시 경고)
     - 기본값 복원 버튼 (30/30/20/20)
     - 변경 후 자동으로 `POST /generate` 재계산 트리거
     - 설정값은 `localStorage`에 저장 (페이지 새로고침 후에도 유지)
   - 🔄 새로고침 버튼 (클릭 시 `POST /generate` 호출, 로딩 중 비활성화)
   - 생성 시각 표시

2. **후보 종목 수**: "오늘 BUY 신호 N종목 중 상위 M종목"

3. **needs_refresh 알림**: `needs_refresh: true` 시 "신호 N개 추가됨 → 새로고침" 배너 표시

4. **추천 카드** (종목별)
   - 순위 배지 (#1, #2, ...)
   - 종목명 + 종목코드
   - 총점 프로그레스 바 (0~100점)
   - 카테고리별 점수 (신호강도/기술적/밸류에이션/수급)
   - 충족 지표 태그 뱃지 (✅ 골든크로스, ✅ 볼린저 하단 복귀 등)
   - 수급 미집계 시: 수급 항목에 '수급 미집계' 뱃지
   - 쌍봉 감지 시: 카드 테두리 주황색 + ⚠️ 위험 배너
   - 데이터 부족 시: 기술적 점수 항목에 '데이터 부족' 표시
   - 기존 `StockActionMenu` 재활용 (즐겨찾기/관심그룹)

---

## 8. 데이터 흐름

```
사용자가 /signals 페이지 접속
  ↓
page.tsx (Server)에서 GET /api/v1/ai-recommendations 호출
  ↓
  ├─ 오늘 데이터 없음? → 즉시 생성 (Lazy Generation)
  └─ 데이터 있음 → 캐시 반환 + needs_refresh 플래그
  ↓
AiRecommendationSection에 초기 데이터 props 전달
  ↓
[재계산 트리거 시 - 버튼 클릭 or needs_refresh 확인 후 수동]
POST /api/v1/ai-recommendations/generate
  ↓
signals 테이블에서 오늘 BUY/BUY_FORECAST 종목 수집
daily_prices에서 최근 60일 OHLCV 조회 (DB only, KIS API 미호출)
stock_cache에서 PER/PBR/ROE + volume 조회
stock_info에서 섹터 기준 거래대금 집계
  ↓
4개 모듈에서 점수 계산
총점 기준 내림차순 정렬
상위 N종목 ai_recommendations upsert (onConflict: date,symbol)
  ↓
UI에 추천 카드 렌더링
```

---

## 9. 제약 사항 및 고려사항

- **수급 데이터:** KIS API 종목별 외국인/기관 순매수 API 미구현. 외국인/기관 항목은 0점 처리. 섹터 거래대금 비교는 stock_cache로 계산. UI에 '수급 미집계' 표시.
- **성능:** 기술적 지표는 `daily_prices` DB 데이터만 사용. 실시간 KIS API 호출 없음. `maxDuration = 120`.
- **신규 상장 종목:** 60일 미만 데이터 시 계산 불가 지표는 0점. UI 카드에 '데이터 부족' 표시.
- **경쟁 조건:** GET은 항상 캐시 반환. 재계산은 POST /generate로만 트리거.
- **크론잡:** 현재 구현 범위 제외. 향후 Vercel Cron 또는 Supabase pg_cron 추가 가능.
- **Gemini AI:** 현재 구현 범위 제외.
- **signal_price:** `signals.signal_price` 컬럼 우선, null이면 `raw_data`에서 기존 `extractSignalPrice()` 함수와 동일 로직으로 추출.
