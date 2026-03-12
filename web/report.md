# Stock-Cache 성능 개선 보고서

## 요약

1. **서버 Cron**: stock-cache-priority cron의 투자지표 조회를 **5병렬 × 200ms 딜레이**에서 **30병렬 × 딜레이 없음**으로 개선하여 **~52초 → 15.5초 (70% 단축)** 달성.
2. **클라이언트 가격 갱신**: 전체종목/GAP 페이지의 "현재가 갱신" 버튼을 벌크 API + 라이브 가격 오버레이로 전환하여 **GAP ~5분 → ~8초 (97% 단축)**, **전체종목 갱신 불가 → 즉시 반영**.

## 배경

### 기존 구조의 문제
- `stock-cache-priority` cron이 우선순위 종목(관심종목+워치리스트+최근시그널)의 투자지표(PER/PBR/EPS/BPS/52주고저/배당수익률)를 **종목당 1건씩** 네이버 개별 API로 조회
- 5건씩 배치 처리 + 배치 간 200ms 딜레이
- 950종목 기준 약 **47~60초** 소요

### 목표
- KRX 전종목 벌크 API 또는 대안을 통해 지표 조회 시간을 대폭 단축

## 조사 및 시행착오

### KRX API 시도 (실패)
- `data.krx.co.kr`의 JSON API (`getJsonData.cmd`) → **"LOGOUT" 응답** (봇 감지)
- OTP 기반 CSV 다운로드 방식 → 세션 쿠키 포함해도 **"LOGOUT" 응답**
- 세션 쿠키(JSESSIONID) 획득 후 API 호출 → 여전히 **차단**
- **결론**: KRX는 JavaScript 기반 봇 방지를 적용하여 서버 사이드(Node.js/Vercel)에서 직접 접근 불가

### 네이버 병렬 최적화 (성공)
- 네이버 개별 종목 API(`/api/stock/{symbol}/integration`)의 병렬 한계 테스트
- 50종목 동시 호출 시 **150ms** (49/50 성공) → Rate limit 없음 확인
- 기존 5병렬 → 30병렬로 증가, 200ms 딜레이 제거

## 구현 내용

### 변경 파일

| 파일 | 변경 |
|------|------|
| `src/lib/krx-api.ts` | 신규 - 네이버 고병렬 지표 벌크 조회 모듈 |
| `src/app/api/v1/cron/stock-cache-priority/route.ts` | 개선 - 고병렬 지표 + 52주 고저 포함 |
| `src/app/api/v1/cron/stock-cache/route.ts` | 유지 - 가격만 업데이트 (변경 없음) |
| `src/app/api/v1/prices/route.ts` | 개선 - POST 핸들러 fire-and-forget + 메모리 캐시 즉시 반환 |
| `src/hooks/use-price-refresh.ts` | 개선 - 200개 청크 분할 병렬 요청 |
| `src/app/gap/gap-client.tsx` | 개선 - 벌크 API로 수동 갱신 전환 |
| `src/components/stocks/stock-list-client.tsx` | 개선 - 벌크 API + 라이브 가격 오버레이 |

### 핵심 변경: `fetchBulkIndicators()`

```typescript
// 30건씩 병렬 호출, 딜레이 없음
export async function fetchBulkIndicators(
  symbols: string[],
  concurrency = 30
): Promise<Map<string, BulkIndicatorData>> {
  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency);
    await Promise.allSettled(batch.map(symbol => fetchSingleIndicator(symbol)));
    // 실패율 50% 초과 시에만 500ms 대기 (rate limit 방어)
  }
}
```

### 데이터 필드
- **기존**: PER, PBR, EPS, BPS, 배당수익률 (52주 고저 없었음)
- **개선 후**: PER, PBR, EPS, BPS, **52주 최고가, 52주 최저가**, 배당수익률

## 성능 측정 결과

### stock-cache-priority (실측, 950종목)

| 항목 | 기존 | 개선 후 | 개선율 |
|------|------|---------|--------|
| 지표 조회 방식 | 5병렬 × 200ms 딜레이 | 30병렬 × 딜레이 없음 | - |
| 전체 소요시간 | ~52초 | **15.5초** | **70% 단축** |
| 지표 조회 시간 | ~47초 | ~10초 | **79% 단축** |
| 성공률 | 약 95% | **99.9%** (949/950) | 향상 |

### 병렬도 벤치마크 (50종목 기준)

| 병렬 수 | 소요시간 | 종목당 |
|---------|---------|--------|
| 5 (기존) | 461ms | 9ms |
| 10 | 232ms | 5ms |
| 20 | 284ms | 6ms |
| 30 (채택) | ~200ms | ~4ms |
| 50 | 150ms | 3ms |

### stock-cache (전종목 가격, 변경 없음)

| 항목 | 결과 |
|------|------|
| 소요시간 | 29.9초 |
| 업데이트 종목 | 3,590개 |
| 네이버 조회 종목 | 4,237개 |

## 아키텍처

```
[Vercel Cron]
    │
    ├─ stock-cache (20:00 KST, 매일)
    │   └─ 네이버 전종목 시세 벌크 (2~5초)
    │       └─ stock_cache 가격 업데이트 (~25초 DB 쓰기)
    │
    └─ stock-cache-priority (10:00 KST, 매일)
        ├─ 네이버 전종목 시세 벌크 (2~5초)     ─┐
        │                                        ├─ 동시 실행 (Promise.all)
        └─ 네이버 고병렬 지표 조회 (30병렬, ~10초) ─┘
            └─ stock_cache 가격+지표 일괄 업데이트
```

## 클라이언트 사이드 가격 갱신 개선

### 기존 문제

1. **전체종목 페이지**: "현재가 갱신" 버튼 클릭 → POST로 stock_cache 업데이트 대기(30초+) → stock_cache 재조회. 실제로는 fire-and-forget으로 DB 쓰기가 비동기라 갱신이 반영되지 않음.
2. **GAP 페이지**: 종목당 `/api/v1/stocks/${sym}/realtime` 개별 호출, 5병렬 × 1200ms 딜레이. 800+ 종목 기준 **~5분** 소요.
3. **usePriceRefresh 훅**: 심볼을 URL 하나에 전부 넣으나 서버에서 200개로 잘라 나머지 누락.
4. **GAP 상태 충돌 버그**: `refreshPrices`가 `stocks` 상태를 직접 업데이트하면, `stocksWithLivePrices` memo가 `usePriceRefresh` 훅의 **이전** `livePrices`를 다시 오버레이하여 수동 갱신 결과를 덮어씀. 가격이 변해도 DOM에 반영 안 됨.

### 해결

| 문제 | 해결 방법 |
|------|-----------|
| 전체종목 갱신 안됨 | POST → 네이버 메모리 캐시 갱신 → `?live=true`로 메모리 캐시에서 직접 읽기 (stock_cache DB 우회) |
| GAP 5분 소요 | 종목별 개별 호출 제거 → 벌크 `/api/v1/prices?live=true` + 200개 청크 병렬 |
| 심볼 누락 | `usePriceRefresh` 훅에 200개 청크 분할 로직 추가 |
| GAP 상태 충돌 | `refreshPrices`에서 별도 fetch+setStocks 제거 → POST 후 훅의 `refresh()` 호출로 `livePrices` 자체를 갱신. 가격 업데이트 경로를 하나로 통일 |

### 핵심 패턴: 라이브 가격 오버레이

```
[클라이언트]
    │
    ├─ 페이지 진입 시 (usePriceRefresh 훅)
    │   └─ GET /api/v1/prices?symbols=...&live=true (200개씩 청크)
    │       └─ 서버 메모리 캐시(60초 TTL)에서 즉시 반환
    │
    └─ "현재가 갱신" 버튼 클릭 시
        ├─ POST /api/v1/prices → 네이버 전종목 벌크 조회 → 메모리 캐시 강제 갱신
        │                        stock_cache DB는 fire-and-forget (사용자 응답 차단 안 함)
        └─ GET /api/v1/prices?symbols=...&live=true (200개씩 청크)
            └─ 방금 갱신된 메모리 캐시에서 즉시 읽기 → 클라이언트 상태에 오버레이
```

### 클라이언트 성능 측정 (실측)

| 페이지 | 항목 | 기존 | 개선 후 | 개선율 |
|--------|------|------|---------|--------|
| 전체종목 | 현재가 갱신 | 갱신 안됨 | **즉시 반영** (~5초) | - |
| GAP (301종목) | 현재가 갱신 | ~5분 | **~8초** | **97% 단축** |
| GAP (301종목) | 페이지 진입 자동 갱신 | ~5분 | **~3초** (메모리 캐시 hit) | **99% 단축** |

## 아키텍처 (전체)

```
[Vercel Cron - 서버 사이드]
    │
    ├─ stock-cache (20:00 KST, 매일)
    │   └─ 네이버 전종목 시세 벌크 (2~5초)
    │       └─ stock_cache 가격 업데이트 (~25초 DB 쓰기)
    │
    └─ stock-cache-priority (10:00 KST, 매일)
        ├─ 네이버 전종목 시세 벌크 (2~5초)     ─┐
        │                                        ├─ 동시 실행 (Promise.all)
        └─ 네이버 고병렬 지표 조회 (30병렬, ~10초) ─┘
            └─ stock_cache 가격+지표 일괄 업데이트

[클라이언트 사이드 - 실시간 가격]
    │
    ├─ usePriceRefresh 훅 (페이지 진입 시 자동)
    │   └─ GET /api/v1/prices?live=true (200개 청크 × 병렬)
    │       └─ 서버 메모리 캐시 (60초 TTL)
    │
    └─ "현재가 갱신" 버튼 (수동)
        ├─ POST /api/v1/prices → 메모리 캐시 강제 갱신
        └─ GET /api/v1/prices?live=true → 오버레이 적용
```

## 결론

- KRX API는 서버 사이드에서 봇 방지로 접근 불가 → **네이버 고병렬 최적화**로 대안 달성
- 투자지표 조회 **47초 → 10초** (79% 단축)
- 전체 priority cron **~52초 → 15.5초** (70% 단축)
- 추가 개선: **52주 최고/최저가** 데이터 신규 포함
- 실패율 방어 로직 탑재 (50% 초과 실패 시 자동 대기)
- **전체종목 페이지**: 갱신 불가 → 즉시 반영
- **GAP 페이지**: ~5분 → ~8초 (97% 단축)
- 라이브 가격 오버레이 패턴으로 stock_cache DB 동기화 지연에 무관하게 즉시 반영
