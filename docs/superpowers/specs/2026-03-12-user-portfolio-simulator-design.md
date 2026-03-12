# 사용자 모의투자 포트폴리오 시뮬레이터

> 설계 문서 | 2026-03-12

## 개요

AI 신호를 참고하여 사용자가 직접 판단해서 가상 매수/매도를 수행하는 모의투자 시뮬레이터. 전략별 포트(탭)를 자유롭게 생성/삭제하고, 포트별 수익률을 누적 추적한다.

### 핵심 원칙

- 잔고 개념 없이 순수 수익률만 추적
- 첫 번째 탭(전체)은 고정, 나머지 탭은 자유 추가/삭제
- 종목상세 페이지 + 포트종목 메뉴 양쪽에서 매수/매도 가능
- 기존 AI 포트폴리오와 완전히 분리된 독립 시스템

## 1. UI 구조

### 1.1 포트종목 페이지 (`/my-portfolio`)

**탭 바:**
- 첫 번째 탭 "전체"는 고정 (삭제 불가, 모든 포트의 종목 합산 표시)
- 나머지 탭은 사용자가 자유롭게 추가/삭제/이름 변경
- 탭 우측에 "+" 버튼으로 새 포트 생성
- 탭 이름은 자유 입력 (예: "성장주", "배당주", "단타", "테스트" 등)

**포트 요약 카드:**
- 총 수익률 (보유 중 종목 평균 수익률)
- 보유 종목 수
- 완료된 거래 수

**종목 리스트 테이블:**
| 컬럼 | 내용 |
|------|------|
| 종목 | 종목명, 종목코드, AI 매도신호 표시 |
| 매수가 | 사용자가 입력한 매수가 |
| 현재가 | stock_cache 실시간 가격 |
| 수익률 | (현재가 - 매수가) / 매수가 × 100 |
| 상태 | 보유중 / 손절 근접 / 익절 근접 / 매도완료 |

**하단 버튼:**
- "+ 종목 매수" — 매수 모달 오픈
- "포트 비교" — 포트 성과 비교 차트로 이동

### 1.2 매수 입력 모달

**종목 검색:**
- 종목명 또는 종목코드로 검색
- 종목상세에서 진입 시 자동 입력

**매수가 입력:**
- 현재가 자동 입력
- 슬라이더 + % 프리셋 버튼 혼합 방식
- 프리셋: -10%, -5%, 현재가, +5%, +10%
- 슬라이더로 세밀 조절 가능
- 직접 숫자 입력도 가능

**목표가 입력 (선택):**
- 매수가 기준 자동 제안 (+10%)
- 슬라이더 범위: +5% ~ +30%
- 프리셋: +5%, +10%, +15%, +20%, +30%

**손절가 입력 (선택):**
- 매수가 기준 자동 제안 (-5%)
- 슬라이더 범위: -3% ~ -20%
- 프리셋: -3%, -5%, -7%, -10%, -15%

**포트 선택:**
- 칩(pill) 형태로 포트 목록 표시
- 탭 하나를 선택하여 해당 포트에 매수 기록

**매매 메모 (선택):**
- 자유 텍스트 입력
- 매수 이유, AI 신호 참고 사항 등 기록

**수량:** 없음 (순수 수익률 추적 목적)

### 1.3 매도 입력

- 보유 종목 리스트에서 개별 종목의 "매도" 버튼 클릭
- 매도가: 현재가 자동 입력 + 슬라이더/% 버튼으로 조절
- 매도 메모 입력 가능
- 매도 시 해당 거래의 수익률 확정

### 1.4 종목상세 페이지 차트 오버레이

**포트별 체크박스:**
- 차트 상단에 사용자 포트 목록을 체크박스로 표시
- 각 포트는 고유 색상 할당 (성장주=#ef4444, 배당주=#8b5cf6, 단타=#f59e0b 등)
- 기존 AI 신호 체크박스도 함께 배치

**차트 위 오버레이:**
- 매수/매도 마커: lightweight-charts `setMarkers()` 활용, 포트명 약어 라벨
- 매수가 수평선: `createPriceLine()` 실선, 포트 색상
- 목표가 수평선: `createPriceLine()` 점선, 포트 색상, 라벨 "목표 79,200"
- 손절가 수평선: `createPriceLine()` 점선, 포트 색상, 라벨 "손절 68,400"

**매수 버튼:**
- StockPriceHeader 옆에 "매수" 버튼 배치
- 클릭 시 매수 모달 오픈 (해당 종목 + 현재가 자동 입력)

## 2. DB 스키마

### 2.1 `user_portfolios` — 포트(탭) 관리

```sql
CREATE TABLE user_portfolios (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_default  BOOLEAN DEFAULT FALSE,
  deleted_at  TIMESTAMPTZ,             -- 소프트 삭제 (NULL = 활성)
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(name)
);
```

**삭제 정책:** 포트 삭제 시 `deleted_at`을 설정하는 소프트 삭제. 거래 이력은 보존되며, 삭제된 포트는 목록에서 숨김. 동일 이름으로 재생성 시 기존 포트를 복원.

### 2.2 `user_trades` — 매수/매도 거래 기록

```sql
CREATE TABLE user_trades (
  id            BIGSERIAL PRIMARY KEY,
  portfolio_id  BIGINT REFERENCES user_portfolios(id),
  symbol        TEXT NOT NULL,
  name          TEXT,
  side          TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  price         NUMERIC NOT NULL,
  target_price  NUMERIC,
  stop_price    NUMERIC,
  buy_trade_id  BIGINT REFERENCES user_trades(id),  -- SELL일 때 어떤 BUY를 청산하는지 (1:1)
  note          TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_user_trades_portfolio_symbol ON user_trades(portfolio_id, symbol);
CREATE INDEX idx_user_trades_symbol ON user_trades(symbol);
```

**매수/매도 연결:** 수량 개념이 없으므로 BUY와 SELL은 1:1 매칭. SELL 레코드의 `buy_trade_id`가 해당 BUY를 가리킴. `buy_trade_id`가 NULL인 BUY가 "보유 중" 상태.

**에러 방어:**
- SELL 요청 시 해당 `portfolio_id + symbol`에 미청산 BUY가 없으면 400 에러 반환
- 동일 BUY에 대한 중복 SELL 방지 (UNIQUE 제약 또는 API 레벨 체크)

### 2.3 `user_portfolio_snapshots` — 일별 포트 수익률 스냅샷

```sql
CREATE TABLE user_portfolio_snapshots (
  id                    BIGSERIAL PRIMARY KEY,
  portfolio_id          BIGINT REFERENCES user_portfolios(id),
  date                  DATE NOT NULL,
  daily_return_pct      NUMERIC,           -- 당일 수익률 변동
  cumulative_return_pct NUMERIC,           -- 포트 생성일 대비 누적 수익률
  holding_count         INT,               -- 보유 종목 수
  trade_count           INT,               -- 누적 거래 수
  created_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE(portfolio_id, date)
);
```

**스냅샷 정책:**

- 보유 종목이 1개 이상인 포트만 스냅샷 생성
- `cumulative_return_pct`는 포트 생성일 기준 누적 수익률
- 성과 비교 차트에서 포트 생성일이 다르면, 각 포트의 첫 스냅샷을 0% 기준점으로 정규화하여 비교
- 스냅샷 데이터가 부족한 포트(< 7일)는 차트에 "데이터 수집 중" 안내 표시

### 2.4 수익률 계산 방식

- **개별 거래 수익률:** `(현재가 - 매수가) / 매수가 × 100`
- **매도 완료 시:** `(매도가 - 매수가) / 매수가 × 100`으로 확정
- **포트 전체 수익률:** 보유 중인 각 BUY 레코드의 수익률 단순 평균
- **종목별 누적 수익률:** 해당 종목의 모든 완료 거래 수익률 평균

### 2.5 holdings API 응답 구조

보유 현황은 **BUY 레코드 단위**로 반환 (동일 종목 복수 매수 시 각각 별도 행):

```json
{
  "holdings": [
    {
      "trade_id": 1,
      "symbol": "005930",
      "name": "삼성전자",
      "buy_price": 72000,
      "current_price": 78500,
      "return_pct": 9.03,
      "target_price": 79200,
      "stop_price": 68400,
      "status": "holding",
      "note": "AI 매수신호 확인",
      "bought_at": "2026-03-10T09:30:00Z",
      "price_as_of": "2026-03-12T15:30:00Z",
      "latest_signal": { "type": "HOLD", "source": "lassi", "date": "2026-03-11" }
    }
  ],
  "summary": {
    "total_return_pct": 8.5,
    "holding_count": 5,
    "completed_trade_count": 12
  }
}
```

**`price_as_of`:** `stock_cache.updated_at` 값. 클라이언트에서 "XX분 전 기준" 표시에 활용.

**`status` 결정 로직:**

- `holding` — 보유 중 (기본)
- `near_target` — 현재가 >= 목표가 × 0.97 (익절 근접)
- `near_stop` — 현재가 <= 손절가 × 1.03 (손절 근접)
- `sold` — 매도 완료 (buy_trade_id로 연결된 SELL 존재)

## 3. API 라우트

### 3.1 포트 관리 — `/api/v1/user-portfolio`

| 메서드 | 용도 | 파라미터 |
|--------|------|----------|
| `GET` | 전체 포트 목록 조회 | — |
| `POST` | 새 포트 생성 | `{ name }` |
| `PATCH` | 포트 이름/순서 수정 | `{ id, name?, sort_order? }` |
| `DELETE` | 포트 삭제 | `{ id }` (기본 포트 삭제 불가) |

### 3.2 거래 기록 — `/api/v1/user-portfolio/trades`

| 메서드 | 용도 | 파라미터 |
|--------|------|----------|
| `GET` | 거래 이력 조회 | `?portfolio_id=&symbol=` (필터) |
| `POST` | 매수/매도 기록 | `{ portfolio_id, symbol, name, side, price, target_price?, stop_price?, note? }` |

### 3.3 보유 현황 — `/api/v1/user-portfolio/holdings`

| 메서드 | 용도 | 파라미터 |
|--------|------|----------|
| `GET` | 보유 종목 + 현재가 + 수익률 | `?portfolio_id=` |

- 현재가 조회: 기존 `stock_cache` → `daily_prices` 폴백 로직 재사용
- AI 신호: 보유 종목의 최신 신호를 `signals` 테이블에서 조인하여 함께 반환

### 3.4 포트 성과 — `/api/v1/user-portfolio/performance`

| 메서드 | 용도 | 파라미터 |
|--------|------|----------|
| `GET` | 포트별 누적 수익률 시계열 | `?portfolio_id=&days=30` |

- 벤치마크(코스피/코스닥) 데이터는 기존 `daily_prices`의 인덱스 종목에서 조회

## 4. 추가 기능

### 4.1 AI 신호 연동 알림

- 보유 종목에 AI 매도 신호 발생 시 종목 리스트에 하이라이트 표시
- 종목코드 옆에 "AI 매도신호" 라벨 표시
- 매수 전 해당 종목의 AI 신호 이력 확인 가능 (기존 signals API 활용)

### 4.2 손절/익절 알림선

- 매수 시 목표가/손절가 설정 (슬라이더 + % 버튼)
- 현재가가 목표가 이상 → "익절 근접" 상태 표시
- 현재가가 손절가 이하 → "손절 근접" 상태 + 경고 배경색
- 종목상세 차트에 목표가/손절가 수평선 표시

### 4.3 포트 성과 비교 차트

- 여러 포트의 누적 수익률을 하나의 라인 차트에 겹쳐서 비교
- `user_portfolio_snapshots` 데이터 기반
- 기간 선택: 30일, 60일, 90일

### 4.4 매매 메모/일지

- 매수/매도 시 자유 텍스트 메모 입력
- 포트별 거래 이력에서 메모와 함께 타임라인 형태로 표시
- 종목별 필터링 가능

### 4.5 벤치마크 비교

- 포트 수익률 vs 코스피/코스닥 수익률을 같은 기간 기준으로 비교
- 성과 차트에 벤치마크 라인 함께 표시
- 초과 수익(알파) 계산 및 표시

## 5. 컴포넌트 구조

```
web/src/app/my-portfolio/
├── page.tsx                    # 포트종목 메인 페이지
└── components/
    ├── portfolio-tabs.tsx      # 탭 바 (추가/삭제/이름변경)
    ├── portfolio-summary.tsx   # 포트 요약 카드
    ├── holdings-table.tsx      # 보유 종목 테이블
    ├── trade-modal.tsx         # 매수/매도 모달
    ├── price-slider-input.tsx  # 슬라이더 + % 버튼 가격 입력
    ├── portfolio-selector.tsx  # 포트 선택 칩
    └── performance-chart.tsx   # 포트 성과 비교 차트

web/src/components/charts/
└── candle-chart.tsx            # 기존 차트 확장 (포트 오버레이)

web/src/components/stock/
└── stock-price-header.tsx      # 기존 헤더 확장 (매수 버튼)

web/src/app/api/v1/user-portfolio/
├── route.ts                    # 포트 CRUD
├── trades/route.ts             # 거래 기록
├── holdings/route.ts           # 보유 현황
└── performance/route.ts        # 성과 데이터

supabase/migrations/
└── 028_user_portfolios.sql     # 테이블 생성
```

## 6. 기존 코드 재사용

| 기존 리소스 | 재사용 위치 |
|-------------|-------------|
| `stock_cache` + `daily_prices` 현재가 조회 | holdings API 현재가 |
| `signals` 테이블 | AI 신호 연동 알림 |
| `candle-chart.tsx` 마커/프라이스라인 | 차트 오버레이 |
| `stock-price-header.tsx` | 매수 버튼 추가 |
| lightweight-charts 라이브러리 | 성과 비교 차트 |

## 7. 스냅샷 생성

`user_portfolio_snapshots`는 기존 cron 패턴을 따라 일별로 생성:

- 매일 장 마감 후 (기존 `daily-prices` cron과 연계)
- 보유 종목이 1개 이상인 포트만 대상
- 각 포트의 보유 중인 BUY 레코드별 수익률 평균을 계산
- `daily_return_pct`: 전일 대비 수익률 변동
- `cumulative_return_pct`: 포트 생성일 대비 누적 수익률
- 벤치마크 비교를 위한 시계열 데이터 축적

## 8. 차트 오버레이 확장 전략

기존 `candle-chart.tsx`의 Props를 선택적(optional) props로 확장:

- `portfolioOverlays?: PortfolioOverlay[]` — 포트별 마커 + 프라이스라인 데이터
- 기존 `signalMarkers?` props는 변경 없이 유지
- 기존 사용처(AI 포트폴리오 페이지)는 영향 없음

## 9. 현재가 시점 제한

장 시간 외(야간, 주말)에는 `stock_cache`에 마지막 거래 시점의 가격이 그대로 남아 있어 수익률이 해당 시점 기준으로 표시됨. 이는 기존 AI 포트폴리오와 동일한 한계이며, `price_as_of` 필드를 통해 클라이언트에서 "XX분 전 기준" 안내를 표시함.
