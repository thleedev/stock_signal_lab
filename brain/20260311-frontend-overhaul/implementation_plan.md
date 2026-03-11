# AI 매매신호 대시보드 - 프론트엔드 전면 개편 (상세 계획서)

기존 Next.js + Supabase + KIS API 기반 대시보드를 프리미엄 투자 분석 플랫폼으로 전면 개편합니다.

---

## 데이터 소스 확정

| 데이터 | 소스 | Yahoo Finance 티커 | 비고 |
|--------|------|-------------------|------|
| KOSPI 지수 | Yahoo Finance | `^KS11` | |
| KOSDAQ 지수 | Yahoo Finance | `^KQ11` | |
| VIX | Yahoo Finance | `^VIX` | |
| WTI 유가 | Yahoo Finance | `CL=F` | 원유 선물 |
| 금 가격 | Yahoo Finance | `GC=F` | 금 선물 |
| 달러 인덱스 (DXY) | Yahoo Finance | `DX-Y.NYB` | |
| USD/KRW 환율 | Yahoo Finance | `KRW=X` | |
| 미국 10년물 금리 | Yahoo Finance | `^TNX` | |
| 한국 3년물 금리 | KIS API | 국내채권 API | |
| 공포탐욕 지수 | CNN 스크래핑 또는 자체 계산 | - | VIX 기반 대체 가능 |
| 종목 현재가/PER/PBR 등 | KIS API | - | 보유 API |
| 종목명/코드 목록 | KIS API + DB | - | 초기 1회 세팅 |

**패키지**: `yahoo-finance2` (npm)

---

## 종목 데이터 업데이트 전략 (3단계)

### Stage 1: 초기 DB 구성 (1회성)

KIS API로 코스피/코스닥 전 종목(~2,500개) 기본정보 수집 → `stock_cache` 테이블 구성
- 종목코드, 종목명, 시장(KOSPI/KOSDAQ)
- 실행: 수동 트리거 또는 최초 배포 시 1회

### Stage 2: 화면 표시 시 실시간 (On-Demand)

사용자가 종목 상세 페이지 또는 투자종목 탭 접근 시 해당 종목만 KIS API 호출
- 현재가, 거래량, PER, PBR, ROE, EPS, BPS, 시가총액
- 응답을 `stock_cache`에 캐싱 (TTL: 5분)
- 전 종목 리스트 페이지에서는 DB 캐시 데이터만 표시 (API 호출 없음)

### Stage 3: 저녁 8시 배치 (매일 Cron)

장 마감 후 20:00 KST에 전 종목 일괄 업데이트
- KIS API Rate Limit 고려: 초당 10건 × 배치 처리
- ~2,500 종목 ÷ 10/sec = ~4.2분 소요
- 업데이트: 현재가, 등락률, 거래량, PER, PBR, ROE 등
- AI 신호 집계: 최근 30일 신호 수, 최신 신호 타입

```
┌─────────────────────────────────────────────────────┐
│              데이터 업데이트 흐름                       │
│                                                     │
│  [초기 1회] DB 전종목 기본 세팅                         │
│       ↓                                             │
│  [장중] 화면 표시 시 → 해당 종목만 API → DB 캐시         │
│       ↓                                             │
│  [20:00] Cron 배치 → 전종목 일괄 갱신                   │
│       ↓                                             │
│  [다음날 장전] 캐시 데이터로 전종목 리스트 표시             │
└─────────────────────────────────────────────────────┘
```

---

## 투자 시황 점수 산출 모델 (상세)

### 지표 목록 (10개)

| # | 지표 | 티커 | 방향 | 기본 가중치 | 해석 |
|---|------|------|------|-----------|------|
| 1 | VIX 변동성 | `^VIX` | 역방향 (-1) | 3.0 | 높을수록 공포 → 부정적 |
| 2 | USD/KRW 환율 | `KRW=X` | 역방향 (-1) | 2.0 | 원화 약세 → 외국인 자금 유출 |
| 3 | 미국 10년물 금리 | `^TNX` | 역방향 (-1) | 2.0 | 고금리 → 주식 매력도 하락 |
| 4 | WTI 유가 | `CL=F` | 역방향 (-1) | 1.5 | 유가 급등 → 인플레 우려 |
| 5 | KOSPI 지수 | `^KS11` | 순방향 (+1) | 2.5 | 상승 → 시장 긍정 |
| 6 | KOSDAQ 지수 | `^KQ11` | 순방향 (+1) | 2.0 | 상승 → 성장주 긍정 |
| 7 | 금 가격 | `GC=F` | 역방향 (-1) | 1.0 | 금 급등 → 안전자산 선호 |
| 8 | 달러 인덱스 (DXY) | `DX-Y.NYB` | 역방향 (-1) | 1.5 | 달러 강세 → EM 자금 유출 |
| 9 | 한국 3년물 금리 | KIS API | 역방향 (-1) | 1.5 | 국내 금리 상승 → 유동성 축소 |
| 10 | 공포탐욕 지수 | 자체 계산 | 순방향 (+1) | 2.0 | CNN 스타일, 높을수록 탐욕 |

### 점수 산출 공식

```
Step 1. 각 지표의 최근 90일 데이터에서 Min, Max 추출
Step 2. 정규화: normalized = (현재값 - Min) / (Max - Min) × 100
Step 3. 방향 보정: direction이 -1이면 score = 100 - normalized
Step 4. 가중 평균: 종합점수 = Σ(score_i × weight_i) / Σ(weight_i)
```

### 점수 해석 기준

| 점수 범위 | 시장 상태 | 색상 | 투자 시그널 |
|-----------|----------|------|-----------|
| 80 ~ 100 | 매우 긍정적 | 🟢 에메랄드 | 적극 매수 구간 |
| 60 ~ 79 | 긍정적 | 🟩 라이트 그린 | 매수 우위 |
| 40 ~ 59 | 중립 | 🟡 옐로우 | 관망 |
| 20 ~ 39 | 부정적 | 🟠 오렌지 | 방어적 투자 |
| 0 ~ 19 | 매우 부정적 | 🔴 레드 | 현금 비중 확대 |

---

## DB 스키마 추가 (4개 테이블)

### [NEW] `014_market_indicators.sql`

```sql
CREATE TABLE market_indicators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  indicator_type VARCHAR(30) NOT NULL,
  value NUMERIC(15,4) NOT NULL,
  prev_value NUMERIC(15,4),
  change_pct NUMERIC(8,4),
  raw_data JSONB,
  UNIQUE(date, indicator_type)
);

CREATE TABLE indicator_weights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  indicator_type VARCHAR(30) NOT NULL UNIQUE,
  weight NUMERIC(5,2) NOT NULL DEFAULT 1.0,
  direction INTEGER NOT NULL DEFAULT -1,
  label VARCHAR(50) NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### [NEW] `015_watchlist.sql`

```sql
CREATE TABLE watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(10) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  added_at TIMESTAMPTZ DEFAULT now(),
  memo TEXT,
  sort_order INTEGER DEFAULT 0
);
```

### [NEW] `016_stock_cache.sql`

```sql
CREATE TABLE stock_cache (
  symbol VARCHAR(10) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  market VARCHAR(10) NOT NULL,
  current_price INTEGER,
  price_change INTEGER,
  price_change_pct NUMERIC(8,2),
  volume BIGINT,
  market_cap BIGINT,
  per NUMERIC(10,2),
  pbr NUMERIC(10,2),
  roe NUMERIC(10,2),
  eps INTEGER,
  bps INTEGER,
  dividend_yield NUMERIC(8,2),
  high_52w INTEGER,               -- 52주 최고
  low_52w INTEGER,                -- 52주 최저
  latest_signal_type VARCHAR(20),
  latest_signal_date TIMESTAMPTZ,
  signal_count_30d INTEGER DEFAULT 0,
  ai_score NUMERIC(5,2),
  is_holding BOOLEAN DEFAULT false,
  is_favorite BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### [NEW] `017_market_indicator_history.sql`

```sql
-- 시황 점수 히스토리 (일별 종합 점수 기록)
CREATE TABLE market_score_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  total_score NUMERIC(5,2) NOT NULL,
  breakdown JSONB NOT NULL,       -- 각 지표별 점수 상세
  weights_snapshot JSONB NOT NULL -- 당시 가중치 스냅샷
);
```

---

## API 엔드포인트 (8개 신규 + 1개 수정)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/api/v1/market-indicators` | 최신 시황 지표 + 종합 점수 |
| `GET/PUT` | `/api/v1/market-indicators/weights` | 가중치 조회/수정 |
| `GET/POST/DELETE` | `/api/v1/watchlist` | 투자종목 CRUD |
| `GET` | `/api/v1/stocks` | 전종목 리스트 (필터/정렬/페이지) |
| `GET` | `/api/v1/stocks/[symbol]/realtime` | 종목 실시간 데이터 (On-Demand) |
| `POST` | `/api/v1/cron/market-indicators` | 시황 지표 수집 Cron |
| `POST` | `/api/v1/cron/stock-cache` | 전종목 배치 갱신 (20:00) |
| `POST` | `/api/v1/cron/stock-init` | 전종목 초기 세팅 |
| `MODIFY` | `/api/v1/stock/route.ts` | 투자지표 필드 추가 |

---

## 프론트엔드 페이지 구성

| 경로 | 페이지명 | 타입 | 설명 |
|------|---------|------|------|
| `/` | 대시보드 | MODIFY | 시장 요약 + 시황 미니 점수 + 최근 신호 |
| `/stocks` | 전 종목 | NEW | 코스피/코스닥 전종목 테이블 + 필터 |
| `/market` | 투자 시황 | NEW | 시황 점수 게이지 + 가중치 슬라이더 |
| `/investment` | 투자 종목 | NEW | 워치리스트 CRUD + 실시간 지표 |
| `/signals` | AI 신호 | MODIFY | 새 디자인 적용 |
| `/stock/[symbol]` | 종목 상세 | MODIFY | 투자지표 카드 + 차트 개선 |
| `/portfolio` | 포트폴리오 | MODIFY | 새 디자인 적용 |
| `/settings` | 설정 | MODIFY | 새 디자인 적용 |

---

## 상세 사용자 시나리오

### 시나리오 1: 대시보드 진입

```
사용자 → 메인 페이지(/) 접속
  ├─ 시장 요약 카드 표시
  │   ├─ KOSPI 2,850.35 (+1.2%)  [Yahoo Finance ^KS11 캐시]
  │   └─ KOSDAQ 920.15 (-0.3%)   [Yahoo Finance ^KQ11 캐시]
  ├─ 투자 시황 미니 게이지
  │   └─ 종합 점수: 64점 (긍정적) [DB market_score_history]
  ├─ 관심종목 빠른 현황 (최대 5개)
  │   └─ 삼성전자 72,500원 (+2.1%) [stock_cache]
  ├─ 오늘의 AI 신호 요약
  │   ├─ 매수 23건 / 매도 12건
  │   └─ 최근 5건 리스트
  └─ 포트폴리오 수익률 요약
      └─ 일시매매 +5.2% / 분할매매 +8.1%
```

### 시나리오 2: 전 종목 리스트 (필터링)

```
사용자 → /stocks 접속
  ├─ 상단 고정: 관심종목(★) 영역
  │   └─ favorite_stocks 테이블 → stock_cache JOIN
  │   └─ 삼성전자 ★, SK하이닉스 ★ ... (가격/등락은 stock_cache)
  │
  ├─ 필터 패널 (좌측 또는 상단 드로어)
  │   ├─ 시장: [전체] [KOSPI] [KOSDAQ]
  │   ├─ AI 신호: [전체] [매수] [매도] [보유중] [신호없음]
  │   ├─ 보유여부: [전체] [보유중] [미보유]
  │   ├─ PER 범위: [슬라이더 0~100]
  │   ├─ PBR 범위: [슬라이더 0~10]
  │   ├─ ROE 범위: [슬라이더 -50~100]
  │   ├─ 거래량: [최소] [최대]
  │   ├─ 현재 가격: [최소] [최대]
  │   ├─ AI 점수: [슬라이더 0~100]
  │   └─ 정렬: [등락률↓] [거래량↓] [PER↑] [AI점수↓]
  │
  └─ 종목 테이블
      ├─ 컬럼: 관심★ | 종목명 | 코드 | 현재가 | 등락률 | 거래량 |
      │         PER | PBR | ROE | AI신호 | AI점수
      ├─ 데이터: stock_cache 테이블 (배치 캐시)
      ├─ 클릭 → /stock/[symbol] 이동
      └─ 무한 스크롤 (50개씩 로딩)
```

### 시나리오 3: 전 종목 관심종목 토글

```
사용자 → /stocks 에서 종목 행의 ★ 아이콘 클릭
  ├─ ★ 비어있음 → 채워진 ★ (관심종목 추가)
  │   ├─ POST /api/v1/favorites { symbol, name }
  │   ├─ stock_cache.is_favorite = true 업데이트
  │   └─ 해당 종목이 상단 고정 영역으로 이동 (애니메이션)
  │
  └─ ★ 채워짐 → 비어있는 ★ (관심종목 제거)
      ├─ DELETE /api/v1/favorites/[symbol]
      ├─ stock_cache.is_favorite = false 업데이트
      └─ 상단 고정 영역에서 제거 (애니메이션)
```

### 시나리오 4: 투자 시황 점수 조회

```
사용자 → /market 접속
  ├─ 종합 점수 게이지 (큰 원형 게이지)
  │   └─ 64점 / 100점 — "긍정적" (초록색 그라디언트)
  │
  ├─ 지표별 카드 (10개)
  │   ├─ VIX: 18.5 (전일 대비 -2.3%)
  │   │   └─ 정규화 점수: 72/100 (낮을수록 긍정)
  │   ├─ USD/KRW: 1,320원 (+0.5%)
  │   │   └─ 정규화 점수: 55/100
  │   ├─ WTI: $78.30 (-1.2%)
  │   │   └─ 정규화 점수: 68/100
  │   ├─ ... (나머지 7개 지표)
  │   └─ 각 카드에 미니 스파크라인 (최근 30일 추이)
  │
  ├─ 점수 히스토리 차트 (최근 90일 종합 점수 추이)
  │
  └─ 가중치 조절 패널
      ├─ VIX 변동성    [━━━━━━━●━━] 3.0 / 10.0
      ├─ USD/KRW       [━━━━●━━━━━] 2.0 / 10.0
      ├─ 미국 10년물    [━━━━●━━━━━] 2.0 / 10.0
      ├─ WTI 유가       [━━━●━━━━━━] 1.5 / 10.0
      ├─ KOSPI         [━━━━━●━━━━] 2.5 / 10.0
      ├─ ... (나머지)
      ├─ [슬라이더 변경 시 → 즉시 종합 점수 재계산 (클라이언트)]
      ├─ [저장 버튼] → PUT /api/v1/market-indicators/weights
      └─ [초기화 버튼] → 기본 가중치로 복원
```

### 시나리오 5: 가중치 슬라이더 조작

```
사용자 → /market 에서 VIX 가중치 슬라이더를 3.0 → 5.0으로 변경
  ├─ 클라이언트 즉시 반영:
  │   ├─ VIX의 가중 비율 증가
  │   ├─ 종합 점수 재계산 (VIX 영향력 ↑)
  │   ├─ 예: 64점 → 58점으로 변동
  │   └─ 게이지 애니메이션으로 점수 변동 표시
  │
  ├─ "저장" 버튼 클릭
  │   ├─ PUT /api/v1/market-indicators/weights
  │   │   body: { vix: 5.0, usd_krw: 2.0, ... }
  │   ├─ DB indicator_weights 테이블 업데이트
  │   └─ 토스트: "가중치가 저장되었습니다"
  │
  └─ "초기화" 버튼 클릭
      ├─ 기본 가중치로 복원
      └─ 점수 재계산
```

### 시나리오 6: 투자 종목 탭

```
사용자 → /investment 접속
  ├─ 종목 검색바 (상단)
  │   ├─ 입력: "삼성" → 자동완성 드롭다운
  │   │   ├─ 삼성전자 (005930) KOSPI
  │   │   ├─ 삼성SDI (006400) KOSPI
  │   │   └─ 삼성바이오로직스 (207940) KOSPI
  │   └─ 선택 → POST /api/v1/watchlist → 리스트에 추가
  │
  ├─ 투자 종목 리스트
  │   ├─ 삼성전자 005930
  │   │   ├─ 현재가: 72,500원 (+2.1%) [On-Demand KIS API]
  │   │   ├─ 거래량: 12,345,678
  │   │   ├─ PER: 12.5 | PBR: 1.3 | ROE: 15.2%
  │   │   ├─ 시가총액: 432.5조
  │   │   ├─ 52주 최고/최저: 78,000 / 58,000
  │   │   ├─ AI 신호: 매수 (2026-03-10)
  │   │   └─ [삭제 ✕] 버튼
  │   ├─ SK하이닉스 000660
  │   │   └─ ... (동일 구조)
  │   └─ (드래그로 순서 변경 가능)
  │
  └─ 종목이 추가될 때:
      ├─ GET /api/v1/stocks/[symbol]/realtime → KIS API 호출
      ├─ 결과를 stock_cache에 캐싱 (5분 TTL)
      └─ 투자지표 카드 렌더링
```

### 시나리오 7: 종목 검색 → 추가 흐름

```
사용자 → /investment 검색바에 "팬오션" 입력
  ├─ 디바운스 300ms 후 검색 실행
  │   └─ GET /api/v1/stocks?q=팬오션&limit=10
  │       (stock_cache 테이블에서 ILIKE 검색)
  │
  ├─ 드롭다운 결과:
  │   └─ 팬오션 (028670) KOSPI — 현재가 4,820원
  │
  ├─ 사용자 클릭 → 종목 추가
  │   ├─ POST /api/v1/watchlist { symbol: "028670", name: "팬오션" }
  │   ├─ watchlist 테이블에 INSERT
  │   ├─ GET /api/v1/stocks/028670/realtime → 실시간 데이터 가져오기
  │   └─ 리스트에 애니메이션으로 추가
  │
  └─ 이미 존재하는 종목 선택 시:
      └─ 토스트: "이미 추가된 종목입니다"
```

### 시나리오 8: 종목 상세 페이지

```
사용자 → /stocks 또는 /investment 에서 종목 클릭 → /stock/005930
  ├─ 헤더: 삼성전자 (005930) KOSPI
  │   ├─ 현재가: 72,500원 (+2.1%) [On-Demand KIS API]
  │   └─ ★ 관심종목 토글
  │
  ├─ 투자 지표 카드 (가로 스크롤)
  │   ├─ PER 12.5 | PBR 1.3 | ROE 15.2%
  │   ├─ EPS 5,800 | BPS 55,700
  │   ├─ 시가총액 432.5조 | 배당수익률 2.1%
  │   └─ 52주 최고 78,000 / 최저 58,000
  │
  ├─ 캔들 차트 (lightweight-charts)
  │   ├─ 기간: [1M] [3M] [6M] [1Y]
  │   └─ AI 신호 마커 오버레이
  │
  ├─ AI 신호 이력 (타임라인)
  │
  └─ 가상 거래 이력
```

### 시나리오 9: 저녁 8시 배치 Cron 실행

```
시스템 → 20:00 KST Cron 트리거 (Vercel Cron)
  ├─ POST /api/v1/cron/stock-cache
  │   ├─ Authorization: Bearer ${CRON_SECRET}
  │   │
  │   ├─ Step 1: stock_cache에서 전체 종목 symbol 목록 조회
  │   │   └─ SELECT symbol FROM stock_cache ORDER BY symbol
  │   │
  │   ├─ Step 2: 배치 처리 (10건/초, Rate Limit 준수)
  │   │   ├─ Batch 1: 005930, 000660, 006400, ... (10개)
  │   │   │   └─ KIS API inquire-price × 10 → 결과 수집
  │   │   ├─ await delay(1100ms)
  │   │   ├─ Batch 2: 다음 10개
  │   │   └─ ... (반복, 총 ~250배치 × 1.1초 ≈ 4.6분)
  │   │
  │   ├─ Step 3: stock_cache UPSERT
  │   │   └─ current_price, price_change, volume, per, ...
  │   │
  │   ├─ Step 4: AI 신호 집계
  │   │   ├─ 각 종목의 최근 30일 signals 카운트
  │   │   ├─ 최신 signal_type, signal_date 업데이트
  │   │   └─ ai_score 재계산 (신호 기반)
  │   │
  │   └─ Step 5: 보유/관심 상태 동기화
  │       ├─ favorite_stocks → is_favorite 동기화
  │       └─ virtual_trades 보유 → is_holding 동기화
  │
  └─ 완료 로그: "2,453 종목 업데이트 완료 (4분 32초)"
```

### 시나리오 10: 시황 지표 Cron 수집

```
시스템 → 매시 정각 Cron 트리거
  ├─ POST /api/v1/cron/market-indicators
  │   │
  │   ├─ Step 1: Yahoo Finance API 호출 (yahoo-finance2)
  │   │   ├─ quote('^KS11') → KOSPI
  │   │   ├─ quote('^KQ11') → KOSDAQ
  │   │   ├─ quote('^VIX') → VIX
  │   │   ├─ quote('CL=F') → WTI
  │   │   ├─ quote('GC=F') → Gold
  │   │   ├─ quote('DX-Y.NYB') → DXY
  │   │   ├─ quote('KRW=X') → USD/KRW
  │   │   └─ quote('^TNX') → US 10Y Yield
  │   │
  │   ├─ Step 2: KIS API 호출
  │   │   └─ 한국 3년물 금리
  │   │
  │   ├─ Step 3: market_indicators UPSERT
  │   │   └─ 각 지표 date + indicator_type = UNIQUE
  │   │
  │   ├─ Step 4: 종합 점수 계산
  │   │   ├─ 각 지표 최근 90일 min/max 조회
  │   │   ├─ 정규화 → 방향 보정 → 가중 평균
  │   │   └─ market_score_history INSERT
  │   │
  │   └─ Step 5: 공포탐욕지수 자체 계산
  │       ├─ VIX 정규화 (40%)
  │       ├─ KOSPI 20일 이동평균 괴리율 (30%)
  │       ├─ 매수/매도 신호 비율 (30%)
  │       └─ 0~100 점수 산출 → market_indicators 저장
```

### 시나리오 11: AI 신호 페이지 (새 디자인)

```
사용자 → /signals 접속
  ├─ 오늘 신호 요약 카드
  │   ├─ 총 35건 | 매수 23건 | 매도 12건
  │   └─ 소스별: 라씨 15 | 스톡봇 12 | 퀀트 8
  │
  ├─ 소스 필터 탭
  │   └─ [전체] [라씨매매] [스톡봇] [퀀트]
  │
  ├─ 신호 카드 리스트 (카드형)
  │   ├─ 🔴 매수 | 라씨매매 | 09:21
  │   │   ├─ 팬오션 (028670)
  │   │   ├─ 신호가: 4,820원
  │   │   └─ 현재가: 4,950원 (+2.7%)
  │   └─ ...
  │
  └─ 기간 필터 (오늘 / 최근 7일 / 최근 30일)
```

### 시나리오 12: 모바일 네비게이션

```
모바일 사용자 → 앱 접속
  ├─ 하단 고정 탭 바 (5개)
  │   ├─ 🏠 홈
  │   ├─ 📊 종목 (전종목)
  │   ├─ 📈 시황
  │   ├─ 💼 투자 (투자종목)
  │   └─ ⚡ 신호
  │
  ├─ 더보기 (... 메뉴)
  │   ├─ 포트폴리오
  │   ├─ 수집기
  │   └─ 설정
  │
  └─ 화면 전환: 하단 탭 터치 시 페이지 이동
      └─ 활성 탭 하이라이트 (그라디언트 밑줄)
```

### 시나리오 13: 전 종목에서 복합 필터링

```
사용자 → /stocks 에서 필터 적용:
  ├─ 시장: KOSPI
  ├─ AI 신호: 매수
  ├─ PER: 5 ~ 20
  ├─ PBR: 0.5 ~ 2.0
  ├─ 정렬: AI점수 높은순

  → API 호출:
  GET /api/v1/stocks?market=KOSPI&signal=BUY
    &minPer=5&maxPer=20&minPbr=0.5&maxPbr=2.0
    &sortBy=ai_score&sortDir=desc&page=1&limit=50

  → SQL:
  SELECT * FROM stock_cache
  WHERE market = 'KOSPI'
    AND latest_signal_type IN ('BUY','BUY_FORECAST')
    AND per BETWEEN 5 AND 20
    AND pbr BETWEEN 0.5 AND 2.0
  ORDER BY ai_score DESC
  LIMIT 50 OFFSET 0

  → 결과: 127건 중 1~50 표시
  → 관심종목은 무조건 상단 고정 (별도 쿼리)
```

### 시나리오 14: 종목 On-Demand 실시간 조회

```
사용자 → /investment 에서 삼성전자 카드 확인
  ├─ 캐시 체크: stock_cache.updated_at
  │   ├─ 5분 이내 → 캐시 데이터 표시 (API 호출 없음)
  │   └─ 5분 초과 → 실시간 조회 트리거
  │
  ├─ 실시간 조회 흐름:
  │   ├─ GET /api/v1/stocks/005930/realtime
  │   ├─ 서버: KIS API inquire-price 호출
  │   ├─ 응답: { price, change, volume, per, pbr, ... }
  │   ├─ stock_cache UPSERT (캐시 갱신)
  │   └─ 클라이언트: 카드 데이터 업데이트 (페이드 애니메이션)
  │
  └─ 여러 종목 동시 조회 시:
      ├─ 배치로 묶어서 순차 호출 (Rate Limit 준수)
      └─ 로딩 스켈레톤 표시 → 데이터 도착 시 교체
```

### 시나리오 15: 초기 DB 구성 (최초 1회)

```
관리자 → /settings 에서 "전 종목 초기화" 버튼 클릭
  ├─ POST /api/v1/cron/stock-init
  │   ├─ Step 1: KIS API 전종목 리스트 조회
  │   │   └─ 업종별 조회 또는 KRX 데이터 활용
  │   │
  │   ├─ Step 2: stock_cache 테이블 bulk INSERT
  │   │   └─ symbol, name, market 만 세팅
  │   │
  │   ├─ Step 3: 기본 지표 배치 수집
  │   │   └─ 시나리오 9의 배치 프로세스 실행
  │   │
  │   └─ 완료: "2,453 종목 초기화 완료"
  │
  └─ 이후 매일 20:00 배치로 자동 업데이트
```

### 시나리오 16: 포트폴리오 보유종목과 전체 연동

```
시스템 → 저녁 배치 Cron 시:
  ├─ virtual_trades에서 현재 보유 종목 추출
  │   └─ side='BUY'인 미청산 포지션의 symbol 집합
  │
  ├─ stock_cache.is_holding UPDATE
  │   ├─ 보유 종목: is_holding = true
  │   └─ 비보유 종목: is_holding = false
  │
  └─ /stocks 페이지에서:
      ├─ 필터: "보유중" 선택 시
      │   → WHERE is_holding = true
      └─ 각 종목 행에 "보유" 배지 표시
```

---

## 추가 패키지

```bash
npm install yahoo-finance2           # Yahoo Finance API
npm install lightweight-charts@^4    # TradingView 차트
npm install @tanstack/react-table@^8 # 테이블
npm install lucide-react@^0.400      # 아이콘
```

---

## 파일 구조 (신규/수정)

```
web/src/
├── app/
│   ├── page.tsx                    [MODIFY] 대시보드 개편
│   ├── layout.tsx                  [MODIFY] 사이드바+탭바 레이아웃
│   ├── globals.css                 [MODIFY] 다크 프리미엄 디자인
│   ├── stocks/page.tsx             [NEW] 전종목 리스트
│   ├── market/page.tsx             [NEW] 투자 시황 점수
│   ├── investment/page.tsx         [NEW] 투자 종목 탭
│   ├── signals/page.tsx            [MODIFY] 새 디자인
│   ├── stock/[symbol]/page.tsx     [MODIFY] 투자지표 추가
│   ├── portfolio/page.tsx          [MODIFY] 새 디자인
│   ├── settings/page.tsx           [MODIFY] 새 디자인
│   └── api/v1/
│       ├── market-indicators/
│       │   ├── route.ts            [NEW]
│       │   └── weights/route.ts    [NEW]
│       ├── watchlist/route.ts      [NEW]
│       ├── stocks/
│       │   ├── route.ts            [NEW]
│       │   └── [symbol]/
│       │       └── realtime/route.ts [NEW]
│       └── cron/
│           ├── market-indicators/route.ts [NEW]
│           ├── stock-cache/route.ts       [NEW]
│           └── stock-init/route.ts        [NEW]
├── components/
│   ├── ui/                         [NEW] 공통 UI
│   ├── layout/                     [NEW] 사이드바, 탭바
│   ├── dashboard/                  [NEW] 대시보드 위젯
│   ├── stocks/                     [NEW] 종목 테이블/필터
│   ├── market/                     [NEW] 시황 게이지/슬라이더
│   └── investment/                 [NEW] 워치리스트
├── lib/
│   ├── kis-api.ts                  [MODIFY] 지표 조회 추가
│   ├── yahoo-finance.ts            [NEW] Yahoo Finance 래퍼
│   ├── market-score.ts             [NEW] 시황 점수 계산 로직
│   └── supabase.ts                 (기존 유지)
└── types/
    ├── signal.ts                   (기존 유지)
    ├── market.ts                   [NEW] 시황 타입
    └── stock.ts                    [NEW] 종목 타입
```

---

## Verification Plan

### 빌드 검증
```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web && npm run build
```

### 브라우저 검증 (각 시나리오별)
1. `/` — 대시보드: 시장 요약, 시황 미니 게이지 표시
2. `/stocks` — 전종목: 필터 조작, 관심종목 상단 고정, 무한 스크롤
3. `/market` — 시황: 게이지 표시, 슬라이더 조작 시 즉시 점수 변동
4. `/investment` — 투자종목: 검색/추가/제거
5. `/signals` — 신호: 새 디자인 카드형
6. `/stock/[symbol]` — 종목상세: 투자지표 카드
7. 모바일 뷰: 375px에서 하단 탭바, 사이드바 숨김

