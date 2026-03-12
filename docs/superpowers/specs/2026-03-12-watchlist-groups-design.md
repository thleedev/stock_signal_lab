# 종목 페이지 — 관심종목 그룹 관리 설계

**날짜**: 2026-03-12
**상태**: 승인됨

---

## 개요

"전종목" 메뉴를 "종목"으로 개명하고, 관심종목(favorite_stocks)을 다중 그룹으로 관리하는 기능을 추가한다. 기본 그룹은 항상 존재하며, 사용자가 커스텀 그룹을 추가/삭제/순서 변경할 수 있다.

**전제**: 현재 앱은 단일 사용자 구조이므로 `watchlist_groups`에 `user_id` 컬럼을 생략한다. RLS는 기존 앱과 동일하게 서비스 키 기반으로 유지한다.

---

## 1. 메뉴명 변경

| 위치 | 변경 전 | 변경 후 |
|---|---|---|
| `sidebar.tsx` | 전 종목 | 종목 |
| `mobile-tab-bar.tsx` | 종목 (확인 후 수정) | 종목 |

URL 경로(`/stocks`)는 그대로 유지.

---

## 2. UI 구조

```
[종목] 페이지
├── 그룹 탭 바
│   [전체] [기본] [그룹A] [그룹B] ··· [+]
│    ├─ [전체]: 고정, 삭제 불가, 드래그 불가
│    ├─ [기본]: 고정, 삭제 불가, 드래그 불가
│    ├─ 커스텀 탭: × 버튼으로 삭제, 드래그앤드랍으로 순서 변경
│    └─ [+]: 새 그룹 추가 (인라인 입력)
├── 검색창 + 시장/정렬 필터 (기존 유지)
└── 종목 리스트
```

---

## 3. 탭 동작

| 탭 | 표시 내용 | 삭제 가능 |
|---|---|---|
| 전체 | 모든 그룹 관심종목 합집합 (symbol 기준 dedup) | 불가 |
| 기본 | 기본 그룹 종목만 | 불가 |
| 커스텀 | 해당 그룹 종목만 | 가능 |

**[전체] 탭 dedup**: 한 종목이 여러 그룹에 속해 있더라도 [전체] 탭에서는 1회만 표시한다.

---

## 4. 진입 동작

- 즐겨찾기 종목이 하나라도 있음 → **[전체] 탭** 착지 (모든 그룹 관심종목 합집합 표시)
- 즐겨찾기 종목이 하나도 없음 → **전체 DB 종목** 표시 (기존 전종목 뷰 fallback)

---

## 5. 검색 동작

- 검색어 입력 시 → 현재 탭/그룹 무관하게 **전체 DB에서 검색** (`/api/v1/stocks?q=`)
- 검색 결과에서 관심종목은 ★ 표시
- 검색어 지우면 → 직전 탭 상태로 복귀

---

## 6. 종목 → 관심그룹 추가

### 별(★) 버튼
- 그룹이 [기본] 1개만 존재할 때: ★ 클릭 → 기본 그룹에 자동 추가
- 다중 그룹 존재할 때 (커스텀 그룹 1개 이상): ★ 클릭 → 그룹 선택 팝업 (체크박스 복수 선택)
- 그룹 수 판단 기준: 페이지 초기 로드 시 서버에서 내려받은 `watchlist_groups` 목록의 count
- 이 판단 로직은 `StockListClient`가 소유하며, `favGroupCount` prop으로 `StockActionMenu`에 전달

### StockActionMenu (우클릭/더보기 메뉴)
- "관심그룹에 추가 ▶" 서브메뉴 항상 표시
- 서브메뉴에 그룹 목록 나열, 현재 속한 그룹은 체크 표시

---

## 7. 그룹 추가

- [+] 버튼 클릭 → 탭 우측에 인라인 입력창 표시
- 이름 입력 후 Enter 또는 포커스 이탈 시 생성
- 빈 이름이면 취소
- **동일한 그룹명이 이미 존재하면 에러 토스트 표시 후 취소**
- 최대 그룹 수: **20개** (초과 시 [+] 버튼 비활성화, 툴팁 표시)

---

## 8. 그룹 삭제

- 커스텀 탭의 × 버튼 클릭 → 확인 다이얼로그 표시
- 확인 시:
  - 해당 그룹에만 속한 종목 → `watchlist_group_stocks`에서 제거 + `favorite_stocks`에서 제거 + `stock_cache.is_favorite = false`
  - 다른 그룹에도 속한 종목 → `watchlist_group_stocks`에서 해당 그룹 행만 제거, `favorite_stocks`와 `stock_cache.is_favorite` 유지
- 서버에서 "symbol이 어떤 그룹에도 속하지 않을 때"를 기준으로 `favorite_stocks` 삭제 여부 결정

---

## 9. 그룹 순서 변경

- 커스텀 탭을 드래그앤드랍으로 순서 변경
- [전체], [기본] 탭은 항상 맨 앞 고정 (드래그 불가)
- 순서는 `watchlist_groups.sort_order`에 저장
- 드래그 완료 후 클라이언트 debounce 500ms → 서버에 일괄 반영

---

## 10. 종목 정렬

- 그룹 탭 내 종목 정렬: 기존 정렬 옵션(이름순, 등락률순, 거래량순, PER순, Gap순) 적용
- 그룹 내 수동 드래그 순서 지원하지 않음

---

## 11. DB 스키마

### 신규 테이블: `watchlist_groups`

```sql
CREATE TABLE watchlist_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (name)  -- 그룹명 중복 방지
);

-- 기본 그룹 초기 데이터
INSERT INTO watchlist_groups (name, sort_order, is_default)
VALUES ('기본', 0, true);

CREATE INDEX idx_watchlist_groups_sort ON watchlist_groups(sort_order);
```

### 신규 테이블: `watchlist_group_stocks`

```sql
CREATE TABLE watchlist_group_stocks (
  group_id UUID REFERENCES watchlist_groups(id) ON DELETE CASCADE,
  symbol VARCHAR(10) NOT NULL,
  added_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (group_id, symbol)
);

CREATE INDEX idx_wgs_symbol ON watchlist_group_stocks(symbol);
```

### 기존 테이블: `favorite_stocks` 역할 및 마이그레이션

- **역할**: 즐겨찾기 마스터 테이블 유지 (`symbol` PK). 어떤 그룹에도 속하는 종목의 존재 여부를 나타낸다.
- **동기화 규칙**:
  - 그룹에 종목 추가 → `favorite_stocks`에 없으면 INSERT
  - 그룹에서 종목 제거 → 해당 symbol이 다른 그룹에도 없으면 `favorite_stocks` DELETE + `stock_cache.is_favorite = false`
- `group_name` 컬럼은 **deprecated** 처리. 새 코드에서는 읽지 않으며, 마이그레이션 후 제거 가능.

```sql
-- 마이그레이션: 기존 favorite_stocks → 기본 그룹에 추가
INSERT INTO watchlist_group_stocks (group_id, symbol, added_at)
SELECT
  (SELECT id FROM watchlist_groups WHERE is_default = true LIMIT 1),
  symbol,
  added_at
FROM favorite_stocks
ON CONFLICT DO NOTHING;
```

---

## 12. API

### 신규 엔드포인트

| 메서드 | 경로 | 역할 |
|---|---|---|
| GET | `/api/v1/watchlist-groups` | 그룹 목록 조회 (sort_order 순) |
| POST | `/api/v1/watchlist-groups` | 그룹 생성 |
| PATCH | `/api/v1/watchlist-groups/:id` | 그룹명 변경 |
| DELETE | `/api/v1/watchlist-groups/:id` | 그룹 삭제 (종목 정리 포함) |
| PUT | `/api/v1/watchlist-groups/reorder` | 그룹 순서 일괄 변경 (`{ ids: UUID[] }`) |
| GET | `/api/v1/watchlist-groups/:id/stocks` | 그룹 내 종목 조회 |
| POST | `/api/v1/watchlist-groups/:id/stocks` | 그룹에 종목 추가 |
| DELETE | `/api/v1/watchlist-groups/:id/stocks/:symbol` | 그룹에서 종목 제거 |

### 기존 API 변경

| 엔드포인트 | 변경 내용 |
|---|---|
| `GET /api/v1/favorites` | `groups: string[]` 필드 추가 (해당 종목이 속한 그룹 목록) |
| `POST /api/v1/favorites` | `group_id` 파라미터 추가 (없으면 기본 그룹) |
| `PATCH /api/v1/favorites` | **deprecated** — 새 코드에서는 `PUT /api/v1/watchlist-groups/reorder` 사용 |

---

## 13. 컴포넌트 변경

| 컴포넌트 | 변경 내용 |
|---|---|
| `sidebar.tsx` | 메뉴명 "전 종목" → "종목" |
| `mobile-tab-bar.tsx` | 메뉴명 확인 및 수정 |
| `stocks/page.tsx` | `watchlist_groups` 서버사이드 로드 추가 |
| `stock-list-client.tsx` | `favGroups` prop 타입 변경(`Record<string,string>` → `Record<string,string[]>`), 그룹 탭 UI, 진입/검색 로직, `favGroupCount` prop 추가 |
| `stock-action-menu.tsx` | "관심그룹에 추가 ▶" 서브메뉴 추가, `favGroupCount` prop 수신 |
| `settings/favorites-manager.tsx` | 새 API(`watchlist-groups`)로 완전 재연동, `group_name` 직접 참조 제거 |

### 신규 컴포넌트

| 컴포넌트 | 역할 |
|---|---|
| `WatchlistGroupTabs` | 그룹 탭 바 (드래그앤드랍, [+] 버튼, × 버튼) |
| `GroupSelectPopup` | ★ 클릭 시 그룹 선택 팝업 (체크박스 복수 선택) |

---

## 14. 데이터 흐름

```
진입
  ↓
서버: watchlist_groups 목록 + favorite_stocks count 조회 (병렬)
  ↓
즐겨찾기 있음? → [전체] 탭 착지, 합집합 종목 표시 (symbol dedup)
즐겨찾기 없음? → 전체 DB 종목 표시 (기존 뷰)
  ↓
탭 클릭 → 해당 그룹 종목만 표시
검색 입력 → 전체 DB API 호출 (/api/v1/stocks?q=...)
그룹 순서 변경 → 클라이언트 debounce 500ms → PUT /api/v1/watchlist-groups/reorder
```

---

## 15. 비기능 요구사항

- 그룹 탭 드래그앤드랍: `@dnd-kit/core` 사용 (프로젝트에 이미 존재하면 재사용)
- 그룹 순서 변경 후 서버 반영 debounce 500ms
- 그룹 삭제 확인 다이얼로그 필수 (실수 방지)
- 최대 그룹 수: 20개 (UI + API 모두 검증)
- 그룹명 중복 시 에러 토스트 표시
