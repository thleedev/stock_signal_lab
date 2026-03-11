# 시장 이벤트 리스크 스코어 시스템 설계

> 생성일: 2026-03-11
> 상태: 설계 검토 중

## 1. 개요

선물옵션 만기일, 글로벌 경제이벤트, 공휴일 등 시장 이벤트를 자동 수집하고, 리스크 점수로 정량화하여 기존 마켓 스코어와 통합한 "통합 시장 스코어"를 제공한다.

### 목표
- 선물옵션 만기일(매월 둘째 목요일, 분기 동시만기) 자동 표시
- FOMC, CPI, 고용지표 등 주요 경제이벤트 자동 수집
- 한국/미국 공휴일(휴장일) 표시
- 이벤트 리스크를 점수화하여 기존 마켓 스코어와 통합
- 기존 마켓 스코어 50점 고정 버그 수정

### 접근 방식
- 단일 `market_events` 테이블에 모든 이벤트 통합 저장
- 기존 크론 패턴과 동일한 방식으로 데이터 수집
- 무료 API + 규칙 기반 자동 생성

---

## 2. 데이터베이스 스키마

### 2.1 신규 테이블: `market_events`

```sql
CREATE TABLE market_events (
  id SERIAL PRIMARY KEY,
  event_date DATE NOT NULL,
  event_type TEXT NOT NULL,
  event_category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  country TEXT DEFAULT 'KR',
  impact_level INTEGER DEFAULT 1,
  risk_score NUMERIC(5,2) DEFAULT 0,
  source TEXT NOT NULL,
  actual_value TEXT,
  forecast_value TEXT,
  previous_value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_date, event_type, title)
);

CREATE INDEX idx_market_events_date ON market_events(event_date);
CREATE INDEX idx_market_events_category ON market_events(event_category);
```

**event_type 값:**
- `futures_expiry` | `options_expiry` | `simultaneous_expiry`
- `holiday`
- `fomc` | `cpi` | `employment` | `gdp`
- `earnings` | `ipo` | `custom`

**event_category 값:**
- `derivatives` — 선물옵션 만기
- `holiday` — 공휴일/휴장
- `economic` — 경제지표 발표
- `corporate` — 기업 이벤트

**source 값:**
- `rule_based` — 규칙 기반 자동 생성 (만기일)
- `nager_date` — Nager.Date API (공휴일)
- `investing_com` — Investing.com 크롤링 (경제이벤트)
- `manual` — 수동 입력

### 2.2 기존 테이블 확장: `market_score_history`

```sql
ALTER TABLE market_score_history
  ADD COLUMN event_risk_score NUMERIC(5,2),
  ADD COLUMN combined_score NUMERIC(5,2);
```

- `total_score`: 기존 마켓 스코어 (변경 없음)
- `event_risk_score`: 이벤트 리스크 스코어 (신규, 0~100)
- `combined_score`: 통합 스코어 (신규, 0~100)

### 2.3 이벤트별 기본 리스크 점수 매핑

| 이벤트 | event_type | impact_level | risk_score | 근거 |
|--------|-----------|-------------|------------|------|
| 동시만기일 | simultaneous_expiry | 5 | -20 | 변동성 급증, 프로그램 매매 집중 |
| 선물만기일 | futures_expiry | 3 | -10 | 롤오버 영향 |
| 옵션만기일 | options_expiry | 2 | -5 | 상대적으로 영향 적음 |
| FOMC | fomc | 5 | -15 | 글로벌 유동성 방향 결정 |
| CPI | cpi | 4 | -12 | 금리 방향 핵심 지표 |
| 고용지표 | employment | 4 | -10 | 경기 방향 지표 |
| GDP | gdp | 3 | -8 | 발표 지연으로 선반영 |
| 공휴일 | holiday | 1 | 0 | 휴장 정보만 (리스크 없음) |
| 기업실적 | earnings | 3 | -5 | 개별주 영향 |

---

## 3. 점수 시스템

### 3.1 마켓 스코어 50점 버그 수정

**문제:** `market-client.tsx`에서 `scoreHistory`가 비어있을 때 synthetic breakdown을 생성하는데, `change_pct ?? 0` → `50 + (0 * dir * 5) = 50`으로 항상 50점.

**수정 방안:**
- synthetic breakdown 생성 시 `change_pct` 대신 indicator의 실제 `value`를 사용
- `market-score.ts`의 `calculateMarketScore()`와 동일한 min/max 정규화 로직 적용
- fallback 시에도 `indicator_weights` 테이블의 가중치를 정상 반영

### 3.2 3-레이어 스코어 구조

```
통합 스코어 (0~100) = 마켓 스코어 × 0.7 + 이벤트 리스크 스코어 × 0.3
```

- **마켓 스코어** (기존): VIX, 환율, 금리 등 10개 지표 가중평균 (0~100)
- **이벤트 리스크 스코어** (신규): 당일~7일 내 이벤트 리스크 합산 (0~100)
- **통합 스코어** (신규): 두 스코어의 가중 합산 (0~100)

### 3.3 이벤트 리스크 스코어 계산 로직

```typescript
function calculateEventRiskScore(events: MarketEvent[]): number {
  const today = new Date();
  let totalPenalty = 0;

  for (const event of events) {
    const daysUntil = diffDays(event.event_date, today);

    // 시간 감쇠: 당일 100%, 1일전 80%, 3일전 50%, 7일전 20%
    const decay = daysUntil === 0 ? 1.0
                : daysUntil <= 1 ? 0.8
                : daysUntil <= 3 ? 0.5
                : daysUntil <= 7 ? 0.2
                : 0;

    totalPenalty += Math.abs(event.risk_score) * decay;
  }

  // 0~100 스케일 (100 = 리스크 없음, 0 = 리스크 최대)
  return Math.max(0, Math.min(100, 100 - totalPenalty));
}
```

**시간 감쇠 근거:**
- 당일(D-Day): 이벤트 영향 최대 → 100% 반영
- D-1: 선반영 매매 활발 → 80%
- D-3: 시장 인지 시작 → 50%
- D-7: 약한 영향 → 20%
- 7일 초과: 무시

---

## 4. 데이터 수집 파이프라인

### 4.1 크론 엔드포인트

`POST /api/v1/cron/market-events`

### 4.2 수집 소스별 로직

#### (1) 선물옵션 만기일 — 규칙 기반 자동 생성
- 매월 둘째 목요일 계산
- 3/6/9/12월 = `simultaneous_expiry` (동시만기)
- 나머지 월 = `futures_expiry` (선물만기)
- 향후 3개월치 미리 생성
- 실행 주기: 월 1회

#### (2) 공휴일 — Nager.Date API
- `GET https://date.nager.at/api/v3/PublicHolidays/{year}/KR`
- `GET https://date.nager.at/api/v3/PublicHolidays/{year}/US`
- 한국 공휴일 → 휴장일로 표시
- 미국 공휴일 → 미국 시장 휴장 참고
- 실행 주기: 연 1회 (1월) + 월 1회 갱신

#### (3) 경제이벤트 — Investing.com 크롤링
- 주간 경제캘린더 페이지 파싱
- FOMC, CPI, 고용지표, GDP 등 주요 이벤트 추출
- impact_level 3 이상만 수집 (노이즈 제거)
- 발표 후 actual_value 업데이트
- 실행 주기: 주 1회 (일요일)

#### (4) 이벤트 점수 반영
- 기존 `market-indicators` 크론에 통합
- 매일 실행 시 이벤트 리스크 스코어 계산
- `market_score_history`에 `event_risk_score`, `combined_score` 저장

### 4.3 크론 실행 주기 요약

| 작업 | 주기 | 설명 |
|------|------|------|
| 만기일 생성 | 월 1회 | 3개월 앞까지 미리 생성 |
| 공휴일 수집 | 연 1회 (1월) | 한국+미국 공휴일 |
| 경제이벤트 수집 | 주 1회 (일요일) | 다음 주 경제캘린더 |
| 이벤트 점수 반영 | 매일 | 기존 market-indicators 크론에 통합 |

---

## 5. UI 표시

### 5.1 메인 대시보드 (`/`) — 이벤트 요약 카드

기존 마켓 스코어 카드 옆에 이벤트 요약 카드 추가:

- 오늘/이번 주 주요 이벤트 목록 (최대 3개)
- 각 이벤트: 제목, D-Day 표시, 리스크 레벨 (색상 배지)
- 이벤트 리스크 스코어 게이지 바
- 통합 스코어 표시

**스코어 3개 나란히 표시:**

```
┌──────────┐ ┌──────────┐ ┌──────────┐
│ 통합 스코어│ │ 마켓 심리 │ │이벤트리스크│
│    52     │ │    62    │ │    35    │
│  주의     │ │  보통     │ │  위험     │
└──────────┘ └──────────┘ └──────────┘
```

스코어 해석 기준:
- 80~100: 매우 양호 (초록)
- 60~79: 양호 (연두)
- 40~59: 보통/주의 (노랑)
- 20~39: 위험 (주황)
- 0~19: 매우 위험 (빨강)

### 5.2 마켓 페이지 (`/market`) — 이벤트 상세 섹션

기존 마켓 심리 지표 아래에 이벤트 캘린더 섹션 추가:

- 탭 전환: [이번 주] [다음 주] [이번 달]
- 날짜별 이벤트 목록 (타임라인 형태)
- 각 이벤트: 날짜, 제목, 카테고리 배지, 리스크 점수, 예상/이전/실제값
- 색상 코딩: 빨강(높은 리스크) / 노랑(중간) / 회색(낮음/공휴일)

### 5.3 스코어 추이 차트 개선

기존 90일 마켓 스코어 차트를 확장:
- 탭: [통합 스코어] [마켓 스코어] [이벤트 리스크]
- 이벤트 발생일에 마커 표시 (세로 점선 + 라벨)

---

## 6. API 엔드포인트

### 신규

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/v1/market-events` | 이벤트 목록 조회 (기간, 카테고리 필터) |
| POST | `/api/v1/market-events` | 수동 이벤트 추가 |
| POST | `/api/v1/cron/market-events` | 이벤트 자동 수집 크론 |

### 기존 수정

| 메서드 | 경로 | 변경 내용 |
|--------|------|----------|
| POST | `/api/v1/cron/market-indicators` | 이벤트 리스크 스코어 + 통합 스코어 계산 추가 |

---

## 7. 파일 변경 요약

### 신규 파일
- `supabase/migrations/021_market_events.sql` — 테이블 생성 + score_history 확장
- `web/src/app/api/v1/market-events/route.ts` — 이벤트 CRUD API
- `web/src/app/api/v1/cron/market-events/route.ts` — 이벤트 수집 크론
- `web/src/lib/market-events.ts` — 만기일 계산, 크롤링, 리스크 계산 유틸
- `web/src/types/market-event.ts` — MarketEvent 타입 정의
- `web/src/components/market/event-calendar.tsx` — 이벤트 캘린더 컴포넌트
- `web/src/components/market/event-summary-card.tsx` — 이벤트 요약 카드

### 수정 파일
- `web/src/lib/market-score.ts` — 이벤트 리스크 스코어 계산 함수 추가
- `web/src/components/market/market-client.tsx` — 50점 버그 수정 + 3-스코어 표시
- `web/src/app/market/page.tsx` — 이벤트 데이터 로드 + 이벤트 섹션 추가
- `web/src/app/page.tsx` — 이벤트 요약 카드 + 통합 스코어 표시
- `web/src/app/api/v1/cron/market-indicators/route.ts` — 통합 스코어 계산 추가
- `web/scripts/run-migrations.ts` — migration 021 추가

---

## 8. 제약사항 및 고려사항

- Investing.com 크롤링은 사이트 구조 변경 시 깨질 수 있음 → 파싱 실패 시 graceful fallback
- 이벤트 리스크 점수는 사전 정의 값 기반이며, 시장 반응에 따른 동적 조정은 향후 과제
- 공휴일 데이터는 Nager.Date 무료 API 제한 (연간 호출 수) 고려하여 캐싱
- 크롤링 실패 시 기존 데이터 유지, 에러 로그만 기록
