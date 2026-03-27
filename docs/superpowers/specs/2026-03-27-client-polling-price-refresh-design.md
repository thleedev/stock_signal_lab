# 클라이언트 폴링 기반 가격 갱신 설계

## 배경

현재 각 API(stocks, portfolio, ai-recommendations, 단기추천)가 요청마다 외부 API를 호출하거나 다중 DB 쿼리를 실행하여 응답이 느림 (1~15초). `stock_cache` 테이블에 이미 가격 데이터가 있으나 활용이 부족함.

## 목표

1. 페이지 진입 시 `stock_cache`의 가격이 5분 이상 경과했으면 클라이언트에서 자동 갱신
2. 모든 대상 페이지에 "N분 전 업데이트" 배지 + 수동 갱신 버튼 표시
3. `daily-prices` 크론 스케줄을 KST 16:00으로 변경

## 설계

### 1. 공용 훅: `usePriceRefresh`

**파일**: `web/src/hooks/use-price-refresh.ts`

```typescript
interface UsePriceRefreshOptions {
  initialUpdateTime?: string | null;
  staleMinutes?: number; // 기본 5분
  onPricesRefreshed?: (prices: LivePriceMap) => void;
}

interface UsePriceRefreshReturn {
  updateTime: string | null;
  refreshing: boolean;
  isStale: boolean;
  priceUpdateLabel: string | null;
  refreshPrices: () => Promise<void>;
}
```

**동작**:
- `POST /api/v1/prices` 호출 → 네이버 전종목 조회 + `stock_cache` 업데이트
- 마운트 시 `isStale`이면 자동 갱신
- `onPricesRefreshed` 콜백으로 호출자에게 가격 맵 전달

**기존 stocks 페이지 로직 추출**: `stock-list-client.tsx:598-648`의 `updateTime`, `refreshing`, `isStale`, `priceUpdateLabel`, `refreshPrices` 로직을 그대로 이동.

### 2. 공용 컴포넌트: `PriceUpdateBadge`

**파일**: `web/src/components/common/price-update-badge.tsx`

```typescript
interface PriceUpdateBadgeProps {
  priceUpdateLabel: string | null;
  isStale: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}
```

**UI**: "N분 전 업데이트" 텍스트 (stale시 `text-yellow-400`) + RefreshCw 아이콘 갱신 버튼. 기존 stocks 페이지의 682-695줄 UI를 그대로 추출.

### 3. 적용 대상 및 방식

| 페이지 | 컴포넌트 | 적용 방식 |
|--------|----------|----------|
| `/stocks` | `stock-list-client.tsx` | 기존 인라인 로직 → 훅+배지로 교체 |
| `/portfolio` | `page.tsx` (서버) | 클라이언트 래퍼 추가, PageHeader action에 배지 삽입 |
| `/signals` (종목추천/단기추천) | `RecommendationView.tsx` (클라이언트) | PageHeader action에 배지 추가 |

### 4. 서버 → 클라이언트 초기값 전달

각 서버 컴포넌트에서 1회 조회:

```sql
SELECT updated_at FROM stock_cache
WHERE current_price IS NOT NULL
ORDER BY updated_at DESC LIMIT 1
```

→ `lastPriceUpdate` prop으로 클라이언트에 전달.

### 5. vercel.json 크론 변경

```json
{
  "path": "/api/v1/cron/daily-prices",
  "schedule": "0 7 * * 1-5"
}
```

UTC 07:00 = KST 16:00 (평일만)

### 6. portfolio 페이지 클라이언트 래퍼

현재 `portfolio/page.tsx`는 순수 서버 컴포넌트. `PriceUpdateBadge`를 사용하려면 클라이언트 래퍼가 필요:

- `web/src/components/portfolio/portfolio-header.tsx` (클라이언트 컴포넌트)
- `lastPriceUpdate` prop 수신 → `usePriceRefresh` 훅 사용
- PageHeader의 action에 전략 탭 + PriceUpdateBadge 배치

### 7. signals 페이지 (AI신호 탭)

`signals/page.tsx`는 서버 컴포넌트. AI신호 탭의 PageHeader action에도 배지를 넣으려면 클라이언트 래퍼 필요. 단, signals 탭은 가격보다 신호 데이터가 핵심이므로 **종목추천/단기추천 탭(RecommendationView)에만 적용**.

## 변경 파일 목록

| 파일 | 변경 유형 |
|------|----------|
| `web/src/hooks/use-price-refresh.ts` | 새 파일 |
| `web/src/components/common/price-update-badge.tsx` | 새 파일 |
| `web/src/components/portfolio/portfolio-header.tsx` | 새 파일 |
| `web/src/components/stocks/stock-list-client.tsx` | 수정 (인라인 로직 → 훅) |
| `web/src/components/signals/RecommendationView.tsx` | 수정 (배지 추가) |
| `web/src/app/portfolio/page.tsx` | 수정 (lastPriceUpdate 조회, 래퍼 사용) |
| `web/src/app/signals/page.tsx` | 수정 (lastPriceUpdate 조회, prop 전달) |
| `web/vercel.json` | 수정 (daily-prices 스케줄 변경) |
