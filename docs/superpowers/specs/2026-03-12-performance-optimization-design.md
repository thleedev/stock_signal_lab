# 성능 최적화 설계서

## 개요

DashboardStock 프로젝트의 서버/Cron 및 클라이언트 렌더링 성능을 개선한다.

## P0: stock_cache bulk upsert 전환

### 현황
- `prices/route.ts`의 `updateStockCache`: 3590건을 50건 배치 × 개별 UPDATE = 3590회 DB 왕복
- `cron/stock-cache/route.ts`: 20건 배치 × 개별 UPDATE = 3590회 DB 왕복

### 변경
- 개별 `.update().eq('symbol')` → `.upsert(array, { onConflict: 'symbol' })` bulk 방식
- 배치 크기를 500건으로 증가 (Supabase POST body 제한 고려)
- `updateStockCache`에서 `update` 대신 `upsert`를 사용하되, 기존 데이터를 덮어쓰지 않도록 변경 가능한 필드만 포함

### 예상 효과
- DB 왕복: 3590회 → ~8회 (500건 배치)
- cron 실행 시간 대폭 단축

## P0: 서버리스 메모리 캐시 개선

### 현황
- `naverCache`가 모듈 레벨 변수로, Vercel 서버리스 인스턴스 간 공유 안됨
- 한 인스턴스에서 POST로 갱신해도 다른 인스턴스는 매번 네이버 API 재호출

### 변경
- 메모리 캐시는 유지 (같은 인스턴스 내 60초 TTL)
- `stock_cache` 테이블의 `updated_at` 최신값을 체크하여 최근 60초 이내 업데이트가 있으면 DB에서 읽기
- 이미 fire-and-forget으로 DB 업데이트하고 있으므로 추가 인프라 불필요

## P1: market-indicators N+1 해소

### 현황
- Step 1: Yahoo 지표 루프 안에서 전일 값 조회 + upsert = 직렬 2N회
- Step 2: 지표 타입별 90일 히스토리 직렬 N회 조회

### 변경
- Step 1: Yahoo 호출을 `Promise.allSettled`로 병렬화, 전일 값을 `.in()` 단일 쿼리로 일괄 조회, 결과를 `upsert(array)`로 일괄 저장
- Step 2: `.in('indicator_type', types)` 단일 쿼리로 90일 히스토리 전체 조회 후 JS에서 그룹핑

## P1: daily-stats 병렬화

### 현황
- 3 sources × 2 execTypes = 6개 조합이 직렬 for 루프
- 각 조합마다 `getPortfolioValue` + 전일 스냅샷 조회 + upsert

### 변경
- 6개 조합을 `Promise.all`로 동시 실행
- 통합 스냅샷 2개도 `Promise.all`로 동시 실행
- 신호 통계 3개 소스도 `Promise.all`로 동시 실행

## P2: 클라이언트 렌더링 최적화

### StockRow 컴포넌트 분리 (stock-list-client.tsx)
- `renderRow` 인라인 함수 → `React.memo(StockRow)` 컴포넌트
- gap 값을 `displayStocks` useMemo에서 미리 계산하여 props로 전달
- `refreshPrices`의 `stocks` 의존성 제거 (useRef 활용)

### displayStocks useMemo 분리
- 1단계: stocks/favStocks/favGroupFilter 병합 메모
- 2단계: sortBy/gapSource 정렬 메모

### signalSet useMemo (stock-chart-section.tsx)
- `new Set(signalDates)` → `useMemo(() => new Set(signalDates), [signalDates])`
