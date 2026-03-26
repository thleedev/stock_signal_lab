# AI신호 종목추천/단기추천 개선 설계

> 작성일: 2026-03-26

## 1. 개요

AI신호 메뉴의 종목추천/단기추천 탭을 개선한다. 필터 UI 일관성, 성능 최적화, 노이즈 제거, 순위 트래킹을 목표로 한다.

## 2. 변경 범위

| # | 항목 | 요약 |
|---|------|------|
| 1 | 필터 UI 리디자인 | 종목메뉴와 일관된 버튼 그룹 기반, 드롭다운 최소화 |
| 2 | 날짜 옵션 간소화 | 오늘 / 신호전체 / 종목전체 (3개만) |
| 3 | 업데이트순 정렬 | 매수신호 날짜(signal_date) 기준 |
| 4 | 노이즈 필터 | 거래대금·회전율·관리종목·CB/BW·지분율 기반 필터링 |
| 5 | 성능 개선 | 스냅샷 테이블로 즉시 응답 |
| 6 | 순위 스냅샷 | 일별 순위 저장 → 과거 추적 |

## 3. DB 설계

### 3.1 `stock_ranking_snapshot` 테이블

```sql
create table stock_ranking_snapshot (
  id bigint generated always as identity primary key,
  snapshot_date date not null,
  snapshot_time timestamptz not null,
  model text not null,                    -- 'standard' | 'short_term'
  symbol text not null,
  name text,
  market text,                            -- KOSPI / KOSDAQ
  current_price int,
  market_cap bigint,
  -- 거래/유동성 지표
  daily_trading_value bigint,             -- 당일 거래대금
  avg_trading_value_20d bigint,           -- 20일 평균 거래대금
  turnover_rate numeric,                  -- 회전율 (거래량/유통주식수)
  -- 리스크 플래그
  is_managed boolean default false,       -- 관리종목
  has_recent_cbw boolean default false,   -- CB/BW 최근 발행
  major_shareholder_pct numeric,          -- 최대주주 지분율
  -- 종목추천 스코어
  score_total numeric,
  score_signal numeric,
  score_trend numeric,
  score_valuation numeric,
  score_supply numeric,
  score_risk numeric,
  -- 단기추천 스코어
  score_momentum numeric,
  score_catalyst numeric,
  -- 공통
  grade text,                             -- A+ / A / B+ / B / C / D
  characters text[],                      -- 투자성격 태그
  recommendation text,                    -- 추천 사유
  signal_date date,                       -- 최신 매수신호 날짜 (업데이트순 정렬용)
  raw_data jsonb,                         -- 전체 원본 데이터

  unique(snapshot_date, model, symbol)
);

create index idx_snapshot_date_model on stock_ranking_snapshot(snapshot_date, model);
```

### 3.2 `stock_dart_info` 테이블

```sql
create table stock_dart_info (
  symbol text primary key,
  has_recent_cbw boolean default false,   -- 최근 6개월 CB/BW 발행
  major_shareholder_pct numeric,          -- 최대주주 지분율 (%)
  major_shareholder_delta numeric,        -- 최대주주 지분 변동 (%p, 양수=증가)
  audit_opinion text,                     -- 감사의견 (적정/한정/부적정/의견거절)
  has_treasury_buyback boolean default false, -- 자사주 매입 진행 중
  revenue_growth_yoy numeric,            -- 매출 성장률 (전년 대비 %)
  operating_profit_growth_yoy numeric,   -- 영업이익 성장률 (전년 대비 %)
  updated_at timestamptz default now()
);
```

### 3.3 `stock_cache` 컬럼 추가

```sql
alter table stock_cache
  add column float_shares bigint,         -- 유통주식수
  add column is_managed boolean default false;  -- 관리종목 여부
```

### 3.4 데이터 보관

- `stock_ranking_snapshot`: 최근 30일만 유지, 초과분은 크론에서 삭제

## 4. 크론 설계

기존 `intraday-prices` 크론(평일 09:00~20:00 KST, 30분 간격)에 통합하여 크론 수를 늘리지 않는다.

### 실행 흐름

```
[30분 크론]
  1. 전 종목 가격 수집 → stock_cache 업서트 (기존)
  2. 관리종목 플래그 갱신 (네이버 크롤링)
  3. 유통주식수 갱신 (네이버 크롤링, stock_cache.float_shares)
  4. stock-ranking 스코어링 실행 (standard + short_term)
  5. stock_ranking_snapshot 업서트
  6. 30일 초과 스냅샷 삭제
```

### DART 데이터 수집

- 20시 마감 크론에서만 실행 (일 1회)
- CB/BW 발행 + 최대주주 지분율 → `stock_dart_info` 업서트

## 5. API 설계

### 5.1 `GET /api/v1/stock-ranking` 변경

**조회 분기:**
- `date=오늘` → `stock_ranking_snapshot`에서 당일 최신 읽기
- `date=신호전체|종목전체` → `stock_ranking_snapshot`에서 최신 날짜 기준 읽기
- 수동 새로고침(🔄) → 실시간 계산 후 응답 + 비동기 스냅샷 업서트

**응답에 추가:**
- `snapshot_time`: 스냅샷 생성 시각
- `updating`: 현재 스냅샷 갱신 중 여부

### 5.2 `GET /api/v1/stock-ranking/status` (신규)

경량 폴링 엔드포인트:
```json
{
  "updating": false,
  "last_updated": "2026-03-26T11:30:00+09:00"
}
```

클라이언트가 30초 간격으로 폴링하여 스냅샷 갱신 상태를 감지한다.

### 5.3 `GET /api/v1/stock-ranking/snapshot` (신규)

과거 스냅샷 조회 (순위 트래킹용):
- `date`: 조회할 날짜 (YYYY-MM-DD)
- `model`: standard | short_term
- 해당 날짜의 마감(20시) 스냅샷 반환

## 6. 스코어링 개선

### 6.1 종목추천 (standard) — 리스크 카테고리 신설

**기존:** signal(10) + trend(40) + valuation(20) + supply(30) = 100
**변경:** signal(10) + trend(35) + valuation(20) + supply(25) + **risk(10)** = 100

#### score_supply 추가 항목

| 항목 | 점수 | 조건 |
|------|------|------|
| 거래대금 등급 | +15 / +10 | 300억↑ / 100억↑ |
| 거래대금 급증 (오늘 / 20일 평균) | +10 / +5 | 2배↑ / 1.5배↑ |
| 회전율 | +5 / 0 | 1~5% / 5%↑ (과열 의심) |
| 자사주 매입 진행 중 | +10 | DART 자사주 매입 공시 |
| 최대주주 지분 증가 | +5 | delta > 0 |

#### score_valuation 추가 항목

| 항목 | 점수 | 조건 |
|------|------|------|
| 매출 성장률 | +10 / +5 / 0 / -5 | 20%↑ / 5%↑ / 0~5% / 역성장 |
| 영업이익 성장률 | +10 / +5 / 0 / -5 | 20%↑ / 5%↑ / 0~5% / 역성장 |

#### score_risk (신설, 종목추천)

| 항목 | 감점 | 조건 |
|------|------|------|
| 관리종목 | -100 | 사실상 제외 |
| 감사의견 비적정 | -80 | 한정/부적정/의견거절 |
| CB/BW 최근 발행 | -30 | 희석 리스크 |
| 최대주주 지분율 < 20% | -20 | 경영권 불안정 |
| 최대주주 지분 감소 | -10 | delta < 0 |
| 거래대금 < 30억 | -25 | 노이즈 구간 |
| 20일 평균 거래대금 < 50억 | -15 | 유동성 부족 |
| 회전율 > 10% | -10 | 작전주 가능성 |

### 6.2 단기추천 (short_term) — score_risk 확장

기존 risk 항목(과열, 추격매수 등)에 추가:

| 항목 | 감점 | 조건 |
|------|------|------|
| 관리종목 | -100 | 사실상 제외 |
| 감사의견 비적정 | -80 | 한정/부적정/의견거절 |
| CB/BW 최근 발행 | -20 | 희석 리스크 |
| 최대주주 지분율 < 20% | -15 | 경영권 불안정 |
| 최대주주 지분 감소 | -10 | delta < 0 |
| 회전율 > 10% | -10 | 작전주 가능성 |
| 거래대금 < 30억 | -15 | 노이즈 구간 |

## 7. 필터바 UI

### 7.1 레이아웃 (한 행)

```
[🔍 검색...]  [오늘|신호전체|종목전체]  [전체|KOSPI|KOSDAQ]  [점수↓|이름|업데이트|괴리율]  [성격 ▾]  [노이즈 제외]  🔄
 텍스트박스     ── 버튼그룹 ──────    ── 버튼그룹 ────   ── 버튼그룹 ──────────   드롭다운   토글    버튼
```

- **검색**: 맨 앞 텍스트박스, 종목메뉴와 동일 패턴
- **날짜**: 3개 버튼 그룹 (기존 7일 날짜 선택 제거)
  - 오늘: 당일 스냅샷
  - 신호전체: 매수신호가 있는 모든 종목 (signal_all)
  - 종목전체: 신호 유무 관계없이 전체 종목 (all)
- **시장**: 종목메뉴와 동일한 3버튼 그룹
- **정렬**: 4개 버튼 그룹, 선택 시 방향 토글(↑/↓)
  - "업데이트순"은 `signal_date` 기준 DESC/ASC
- **성격**: 유일한 드롭다운 (8종류 태그)
- **노이즈 제외**: 토글 스위치
- **🔄 새로고침**: 실시간 재계산 + 스냅샷 업데이트

### 7.2 노이즈 제외 필터 조건 (토글 ON 시)

| 기준 | 조건 |
|------|------|
| 일 거래대금 | ≥ 100억 |
| 20일 평균 거래대금 | ≥ 50억 |
| 회전율 | ≥ 1% |
| 관리종목 | 제외 |
| CB/BW 최근 발행 | 제외 |
| 최대주주 지분율 | ≥ 20% |

### 7.3 모바일

- 검색 + 날짜 + 시장은 유지
- 정렬 + 성격 + 노이즈 토글은 "⋯" 팝업으로 접기

### 7.4 스냅샷 업데이트 알림

- 크론 갱신 감지 시 필터바 하단에 슬림 배너: "순위 업데이트 중..."
- 완료 시 자동 사라짐 + 데이터 리프레시
- 감지 방식: `/api/v1/stock-ranking/status` 30초 폴링

## 8. 수동 새로고침 흐름

```
사용자 🔄 클릭
  → 로딩 스피너 표시
  → stock-ranking API 호출 (refresh=true 파라미터)
  → 서버: 실시간 스코어링 실행
  → 응답 반환 (UI 업데이트)
  → 비동기: stock_ranking_snapshot 업서트
```

## 9. 외부 API 연동

### 9.1 네이버 (기존 패턴 확장)

- **관리종목 여부**: 종목 상세 페이지에서 관리종목 마크 크롤링
- **유통주식수**: 종목 상세 페이지에서 크롤링 → `stock_cache.float_shares`
- 30분 크론에서 갱신

### 9.2 DART OpenAPI (신규)

- **CB/BW 발행**: 공시 검색 API → 최근 6개월 내 CB/BW 관련 공시 존재 여부
- **최대주주 지분율 + 변동**: 대량보유 상황보고 API → 지분율 및 전기 대비 변동
- **감사의견**: 사업보고서 API → 최신 감사의견 (적정/한정/부적정/의견거절)
- **자사주 매입**: 주요사항보고서 API → 자사주 매입 공시 존재 여부
- **매출/영업이익 성장률**: 재무제표 API → 전년 대비 성장률
- 일 1회(20시 마감 크론) 갱신
- API 키: 환경변수 `DART_API_KEY`
- 일 요청 한도: 10,000건 (무료)

## 10. 순위 트래킹

- 매일 20시 마감 크론이 최종 스냅샷 저장
- UI에서 과거 날짜 선택 시 `/api/v1/stock-ranking/snapshot?date=2026-03-25&model=standard` 호출
- 해당 날짜의 마감 스냅샷을 동일한 카드 UI로 표시
- 오늘 가격과 비교하여 실제 수익률 표시 가능 (스냅샷의 current_price vs 오늘 current_price)
