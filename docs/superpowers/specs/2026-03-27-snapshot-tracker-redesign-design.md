# 순위 트래킹 리디자인 — 스냅샷 기반 수익률 추적

> 작성일: 2026-03-27

## 목적

과거 추천 종목의 **스냅샷 시점 가격**과 **현재 가격**을 비교하여 수익률을 확인하는 기능.
스냅샷은 모든 종목을 대상으로 하며, 같은 날 여러 번 저장 가능하고 타임라인으로 탐색할 수 있다.

## 핵심 요구사항

1. **당시 가격**: 스냅샷 저장 시점의 현재가 (실시간 API 최우선)
2. **등급**: 스냅샷 저장 시점의 등급 그대로 보존
3. **현재가**: 부모 컴포넌트의 `livePrices` 활용 (종목추천/단기추천에서 이미 전달됨), 없으면 `/api/v1/prices` fallback
4. **대상**: 점수 계산이 완료된 전체 종목 (`stock_cache` 기반)
5. **타임라인**: 같은 날짜 여러 스냅샷 → 시간별 타임라인 바로 탐색

---

## 설계

### 1. DB 스키마

#### `snapshot_sessions` (신규)

```sql
CREATE TABLE snapshot_sessions (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_date  DATE NOT NULL,
  session_time  TIMESTAMPTZ NOT NULL,
  model         TEXT NOT NULL,                    -- 'standard' | 'short_term'
  trigger_type  TEXT NOT NULL DEFAULT 'cron',     -- 'cron' | 'manual'
  total_count   INT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_snapshot_sessions_date_model
  ON snapshot_sessions (session_date, model);
```

#### `stock_ranking_snapshot` (변경)

- `session_id BIGINT REFERENCES snapshot_sessions(id)` FK 추가
- 유니크 제약: `UNIQUE(snapshot_date, model, symbol)` → `UNIQUE(session_id, symbol)`
- `snapshot_date`, `snapshot_time` 컬럼 유지 (쿼리 편의 + 하위 호환)

#### 데이터 마이그레이션

기존 스냅샷 행들을 `(snapshot_date, model)` 기준으로 그룹핑하여 `snapshot_sessions` 레코드 자동 생성 후 `session_id` 할당.

---

### 2. 스냅샷 저장 흐름

#### 자동 (크론)

1. `daily-prices` 크론잡 완료 시점에 스냅샷 생성 트리거
2. 기존 `stock-ranking` API의 `refresh=true` 로직 재활용
3. `snapshot_sessions` INSERT (`trigger_type: 'cron'`) → `session_id` 획득
4. 전체 종목 점수 계산 → `stock_ranking_snapshot`에 `session_id`와 함께 일괄 저장

#### 수동

1. 사용자가 "스냅샷 저장" 버튼 클릭 (FilterBar 또는 트래킹 모달)
2. `POST /api/v1/stock-ranking/snapshot` 호출 (`trigger_type: 'manual'`)
3. 동일하게 세션 생성 → 전체 종목 계산 → 저장
4. 진행 상태는 기존 `snapshot_update_status` 테이블 활용

#### 가격 소스 우선순위 (스냅샷 저장 시)

1. **실시간 API** — 최우선 (스냅샷 시점의 진짜 현재가)
2. **`daily_prices.close`** (당일) — 차선
3. **`stock_cache.current_price`** — fallback

---

### 3. 순위 트래킹 UI (SnapshotTracker 리뉴얼)

#### 모달 레이아웃

**헤더:**
- 제목 "순위 트래킹" + 모드 라벨(종목추천/단기추천)
- "현재 스냅샷 저장" 버튼 (수동 트리거)
- 닫기 버튼

**날짜 선택:**
- 최근 7영업일 버튼 (기존 유지)
- 날짜 선택 시 해당 날짜의 세션 목록 조회

**타임라인 바:**
- 선택된 날짜에 세션이 2개 이상이면 표시, 1개면 숨김
- 가로 바 형태, 각 세션 시각이 점(dot)으로 표시
- 자동(`cron`) = 파란 점, 수동(`manual`) = 초록 점
- 점 클릭으로 세션 전환

**요약 통계:**
- 총 종목 수, 평균 수익률

**테이블:**
- 순위, 종목명, 등급(스냅샷 시점), 당시가격, 현재가, 수익률
- 등급: `stock_ranking_snapshot.grade` (스냅샷 시점 값)
- 현재가: 부모 `livePrices` 우선, 없으면 `/api/v1/prices` 조회
- 종목 클릭 → 종목 상세 모달의 "수익률 추이" 탭으로 이동

#### 수동 스냅샷 저장 버튼 배치

- 순위 트래킹 모달 헤더
- `RecommendationFilterBar` (종목추천/단기추천 탭)

---

### 4. 종목별 수익률 추이

#### 접근 경로

1. 트래킹 모달에서 종목 클릭 → 종목 상세 모달의 "수익률 추이" 탭
2. 종목 상세 모달에서 직접 "수익률 추이" 탭 선택

#### 수익률 추이 탭 내용

- **라인 차트**: X축 = 스냅샷 날짜/시간, Y축 = 수익률(%)
  - 기준선(0%), 양수 빨강, 음수 파랑
- **하단 테이블**: 세션별 — 날짜, 시간, 당시가격, 현재가, 수익률, 등급

---

### 5. API 변경 사항

#### 신규 API

**`GET /api/v1/stock-ranking/sessions`**
- 파라미터: `date` (선택), `model` (기본: standard)
- 응답: `{ sessions: [{ id, session_time, trigger_type, total_count }] }`
- 용도: 타임라인 바 렌더링

**`GET /api/v1/stock-ranking/snapshot/history`**
- 파라미터: `symbol`, `model` (기본: standard), `limit` (기본: 30)
- 응답: `{ items: [{ session_id, session_date, session_time, snapshot_price, grade, score_total }] }`
- 용도: 종목별 수익률 추이

**`POST /api/v1/stock-ranking/snapshot`**
- 파라미터: `model`, `trigger_type: 'manual'`
- 응답: `{ session_id, status: 'started' }`
- 용도: 수동 스냅샷 생성

#### 기존 API 변경

**`GET /api/v1/stock-ranking/snapshot`** (조회)
- `session_id` 파라미터 추가
- `session_id` 있으면 해당 세션 스냅샷 반환
- `date`만 있으면 해당 날짜 최신 세션 반환 (하위 호환)

**`GET /api/v1/stock-ranking`** (메인)
- 스냅샷 저장 시 `snapshot_sessions` 레코드 생성 로직 추가
- 가격 소스: 실시간 API > `daily_prices.close` > `stock_cache.current_price`

**`/api/v1/cron/daily-prices`**
- 완료 시점에 스냅샷 생성 호출 추가

---

### 6. 에러 처리

- 스냅샷 저장 중 실패 시: 세션 레코드는 유지하되 `total_count = 0`으로 표시, 재시도 가능
- 동시 스냅샷 요청: 기존 `snapshot_update_status` 락 활용 — 진행 중이면 409 반환
- 현재가 조회 실패: `livePrices` → `/api/v1/prices` → '-' 표시 순서로 fallback

### 7. 테스트 전략

- **마이그레이션**: 기존 스냅샷 → 세션 변환 정합성 검증
- **API**: 세션 생성/조회, 스냅샷 저장/조회, 히스토리 조회
- **UI**: 타임라인 바 세션 전환, 수익률 계산 정확성, livePrices 전달 확인
