# 주도주 & 테마 모멘텀 반영 설계

**날짜**: 2026-04-14  
**상태**: 승인됨

## 배경 및 문제

현재 종목 추천 시스템은 개별 종목의 기술적/재무적/수급 지표만으로 점수를 산출한다. 주도주(시장을 이끄는 핵심 종목)와 테마주(동반 상승하는 테마 묶음)의 시장 맥락이 반영되지 않아 실제 시장 상황과 괴리가 발생한다.

## 목표

1. **테마 분류**: KRX 업종(상위) + 네이버 테마(하위) 2계층으로 종목-테마 매핑
2. **테마 강도 점수**: 당일 테마 모멘텀을 정규화해 기존 수급 점수에 보너스 반영
3. **주도주 판별**: 복합 기준(수익률 + 거래대금 + 수급)으로 주도주 플래그 부여 및 보너스 반영
4. **UI**: 테마 태그, 주도주 배지, 핫 테마 현황 표시

---

## 아키텍처 개요

```
[GitHub Actions - 일 1회]
  ├── KRX 업종 크롤러 → stock_sectors 테이블
  └── 네이버 테마 크롤러 → stock_themes + theme_stocks 테이블
                              (테마 강도 계산 + 주도주 판별 포함)

[추천 생성 시 - /api/v1/ai-recommendations/generate]
  ├── 기존 점수 계산 (signal/technical/valuation/supply/earnings/risk)
  ├── theme_stocks 조회 (해당 종목의 테마 + is_leader)
  ├── 수급 점수 += 테마 강도 보너스 (최대 +10)
  ├── 주도주면 수급 + 추세(촉매) += 보너스 (최대 +8)
  └── 과열 테마면 리스크 -= 5

[UI - 추천 카드]
  ├── 테마 태그 (강도 순 최대 2개)
  ├── 👑 주도주 배지
  ├── ⚠️ 테마 과열 경고
  └── 핫 테마 Top 5 현황 배너
```

---

## 데이터 레이어

### 새 테이블

#### `stock_sectors` — KRX 업종 (상위 레이어)

```sql
CREATE TABLE stock_sectors (
  sector_code TEXT NOT NULL,
  sector_name TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  updated_at  DATE NOT NULL,
  PRIMARY KEY (sector_code, symbol)
);
```

업종-종목 매핑은 변동이 적으므로 일 1회 전체 upsert.

---

#### `stock_themes` — 네이버 테마 메타 + 당일 강도 (하위 레이어)

```sql
CREATE TABLE stock_themes (
  theme_id        TEXT NOT NULL,
  theme_name      TEXT NOT NULL,
  avg_change_pct  FLOAT,       -- 테마 내 종목 평균 등락률
  top_change_pct  FLOAT,       -- 테마 내 최고 등락률
  stock_count     INT,
  momentum_score  FLOAT,       -- 정규화된 테마 강도 (0~100)
  is_hot          BOOLEAN DEFAULT FALSE, -- 상위 10% 과열 여부
  date            DATE NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (theme_id, date)
);
```

`momentum_score` 계산:
- 전체 테마의 `avg_change_pct`를 min-max 정규화 → 0~100
- 정규화 후 상위 10% = `is_hot = true`

---

#### `theme_stocks` — 테마-종목 매핑 (일별)

```sql
CREATE TABLE theme_stocks (
  theme_id   TEXT NOT NULL,
  symbol     TEXT NOT NULL,
  name       TEXT NOT NULL,
  change_pct FLOAT,        -- 당일 등락률
  is_leader  BOOLEAN DEFAULT FALSE, -- 주도주 여부
  date       DATE NOT NULL,
  PRIMARY KEY (theme_id, symbol, date)
);
```

---

### 크롤러 설계

**KRX 업종 크롤러** (`scripts/crawl-sectors.ts`)
- 소스: KRX 업종 분류 API (`data.krx.co.kr`)
- 주기: 일 1회 (장 종료 후 18:00 KST)
- 동작: 전체 업종-종목 매핑 upsert

**네이버 테마 크롤러** (`scripts/crawl-themes.ts`)
- 소스: 네이버 증권 테마 (`finance.naver.com/sise/theme.naver`)
- 주기: 일 1회 (장 종료 후 18:30 KST, 섹터 크롤 이후)
- 동작:
  1. 전체 테마 목록 수집 → `stock_themes` upsert
  2. 테마별 종목 목록 + 당일 등락률 수집 → `theme_stocks` upsert
  3. 주도주 판별 후 `is_leader` 업데이트
  4. `momentum_score` 정규화 및 `is_hot` 계산

**주도주 판별 조건** (테마 내, 3개 중 2개 이상 충족):
1. 테마 내 5일 수익률 상위 30% (`daily_prices` 참조)
2. 당일 거래대금 > 섹터 평균 × 1.5배 (`stock_cache.volume_vs_sector` 참조)
3. 외국인 또는 기관 순매수 (`stock_cache.foreign_net_qty > 0 OR institution_net_qty > 0`)

---

## 점수 반영 로직

### 테마 강도 보너스 → 수급 점수

추천 생성 시 `theme_stocks`에서 해당 종목의 테마를 조회, 가장 강한 테마의 `momentum_score` 사용:

```
테마 보너스 = momentum_score / 100 × 10   (최대 +10점)
```

- `momentum_score` 80 → 수급 점수 +8점
- `momentum_score` 50 → 수급 점수 +5점
- 테마 미소속 종목 → 보너스 없음

**과열 감점**: 소속 테마 중 `is_hot = true`가 있으면 리스크 점수에 `-5점` 추가.

---

### 주도주 보너스 → 수급 + 추세/촉매 점수

`is_leader = true`인 종목:

| 모델 | 수급 보너스 | 추세/촉매 보너스 | 합계 |
|------|------------|----------------|------|
| 표준 (standard) | +5점 | 추세 +3점 | 최대 +8점 |
| 초단기 (short_term) | +5점 | 촉매 +3점 | 최대 +8점 |

---

### 보너스 상한 및 총계

| 보너스 종류 | 최대값 |
|------------|--------|
| 테마 강도 → 수급 | +10점 |
| 주도주 → 수급 | +5점 |
| 주도주 → 추세/촉매 | +3점 |
| 과열 테마 → 리스크 감점 | -5점 |
| **순 최대 보너스** | **+18점** |

기존 점수 체계(100점 만점)에서 과도하지 않은 수준.

---

### 추천 생성 흐름 변경

```
기존: 점수 계산 → 가중합 → 저장
변경: 점수 계산 → theme_stocks 조회 → 보너스 적용 → 가중합 → 저장
```

`generate/route.ts`에서 종목 배치 조회 시 `theme_stocks`도 함께 조회 (N+1 방지).

---

## UI 변경

### 추천 카드

기존 배지 행에 테마 태그와 주도주 배지 추가:

```
[SK하이닉스]  87점
🏷 반도체  🏷 AI인프라        ← 테마 태그 (강도 순 최대 2개)
👑 주도주  ⚡ 동반매수  🔥 거래량폭발   ← 배지
⚠️ 테마 과열 구간             ← 과열 경고 (해당 시)
```

- 테마 태그: `theme_stocks` → `stock_themes.theme_name` + `momentum_score` 기반 색상 (강도에 따라 진하게)
- 주도주 배지: `is_leader = true` 시 표시
- 과열 경고: `is_hot = true`인 테마 소속 시 기존 리스크 섹션에 추가

### 신호 페이지 필터

소스 필터 옆에 테마 필터 추가:
- 테마별 드롭다운: 오늘 핫 테마 상위 10개 + 전체
- 주도주만 보기 토글

### 핫 테마 현황 배너 (신호 페이지 상단)

```
🔥 오늘의 핫 테마
1위 AI인프라 +3.2%   2위 방산 +2.8%   3위 반도체 +2.1% ...
```

`stock_themes`에서 `momentum_score` 상위 5개 표시. 장 중 실시간 갱신 없이 일 1회 크롤 데이터 사용.

---

## 구현 범위 (코딩 작업)

1. **DB 마이그레이션**: `stock_sectors`, `stock_themes`, `theme_stocks` 테이블 생성
2. **크롤러 스크립트**: `scripts/crawl-sectors.ts`, `scripts/crawl-themes.ts`
3. **GitHub Actions 워크플로**: 일 1회 크롤러 실행 (18:00, 18:30 KST)
4. **점수 반영**: `web/src/lib/ai-recommendation/supply-score.ts` 등 보너스 적용 로직
5. **추천 생성 API**: `generate/route.ts`에서 `theme_stocks` 배치 조회 + 보너스 적용
6. **UI**: 추천 카드 테마 태그/배지, 필터, 핫 테마 배너

---

## 미포함 범위

- 테마 데이터 실시간 갱신 (일 1회로 충분)
- 테마 이력 관리 (날짜별 보관은 하되 UI에서 이력 조회 기능은 미포함)
- 테마 수동 편집 UI
- KRX 업종을 점수에 직접 반영 (UI 필터/그룹핑 용도만 사용)
