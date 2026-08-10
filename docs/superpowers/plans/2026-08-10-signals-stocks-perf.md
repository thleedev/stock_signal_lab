# /signals·/stocks 표시 속도 개선 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/signals`의 서버 구간 1.3초와 500KB RSC 페이로드, `/stocks`의 장중 4초 외부 API 대기를 제거해 두 화면의 초기 표시 속도를 개선합니다.

**Architecture:** `/signals`는 1,000행 직렬 루프를 200행 단일 조회로 바꾸고 나머지는 신규 API로 무한 스크롤 이어받기를 합니다. 전량이 필요한 summary·industry 뷰는 뷰 전환 시점에 lazy 로드합니다. `/stocks`는 서버의 네이버 시세 호출을 클라이언트로 옮기고 `select("*")`를 필요한 컬럼만 명시로 바꿉니다. 두 페이지의 `force-dynamic`을 걷어내고 `revalidate = 30`을 적용합니다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase JS v2, Tailwind CSS v4, Vitest

## Global Constraints

근거가 되는 설계 문서는 `docs/superpowers/specs/2026-08-10-signals-stocks-perf-design.md`입니다. 모든 주석과 커밋 메시지는 한국어로 작성합니다. 서버에서 Supabase에 접근할 때는 `@/lib/supabase`의 `createServiceClient()`를 쓰고, 경로 별칭 `@/`는 `web/src/`를 가리킵니다. 이 계획의 모든 명령은 `web/` 디렉터리에서 실행합니다.

UI를 손대는 태스크는 `.claude/steering/design-tokens.md`의 디자인 토큰 규칙을 따릅니다. 색상은 `var(--...)` 변수를 쓰고, 카드 패딩은 `p-4`(기본) 또는 `p-8`(빈 상태), 섹션 간격은 `space-y-6`입니다.

테스트 환경에는 제약이 있습니다. Vitest의 `include`가 `src/**/*.test.ts`이고 `environment`가 `node`이므로 **`.tsx` 테스트는 실행되지 않고 React 컴포넌트 테스트도 불가능합니다.** 검증이 필요한 로직은 순수 함수로 분리해 `.ts` 파일에 테스트를 작성합니다. 컴포넌트 동작은 테스트 대신 로컬 실행으로 확인하며, UI가 바뀌는 태스크는 커밋 전에 `npm run dev`로 직접 눈으로 봅니다.

페이지네이션 기본 크기는 200행이고, 요약·업종 뷰가 전량을 채울 때의 요청 크기는 1000행입니다. 이 두 값은 여러 태스크에 걸쳐 나오므로 임의로 바꾸지 않습니다.

---

### Task 1: 활성 신호 변환 함수 이관

`page.tsx` 안에 있는 `toSignal` 변환 로직을 공유 모듈로 옮깁니다. 페이지와 신규 API 라우트가 같은 함수를 써야 무한 스크롤로 이어 붙인 행의 형태가 어긋나지 않습니다.

**Files:**
- Modify: `web/src/lib/signal-constants.ts` (파일 끝에 추가)
- Test: `web/src/lib/signal-constants.test.ts` (신규)

**Interfaces:**
- Consumes: 없음
- Produces: `ActiveSignalRow`, `ActiveSignal` 타입과 `toActiveSignal(row: ActiveSignalRow, type: "buy" | "sell"): ActiveSignal` 함수. Task 2와 Task 3이 이 함수를 씁니다.

- [ ] **Step 1: 실패하는 테스트 작성**

`web/src/lib/signal-constants.test.ts`를 새로 만듭니다.

```ts
import { describe, it, expect } from 'vitest';
import { toActiveSignal } from './signal-constants';

describe('toActiveSignal', () => {
  it('BUY 행을 신호 형태로 변환합니다', () => {
    const row = {
      symbol: '005930',
      name: '삼성전자',
      market: 'KOSPI',
      latest_signal_date: '2026-08-10T09:30:00+09:00',
      latest_signal_type: 'BUY_FORECAST',
      latest_signal_price: 71000,
    };
    expect(toActiveSignal(row, 'buy')).toEqual({
      symbol: '005930',
      name: '삼성전자',
      market: 'KOSPI',
      signal_type: 'BUY_FORECAST',
      source: '',
      timestamp: '2026-08-10T09:30:00+09:00',
      signal_price: '71000',
      sector: '',
    });
  });

  it('SELL 행은 latest_sell_date 를 timestamp 로 씁니다', () => {
    const row = {
      symbol: '000660',
      name: 'SK하이닉스',
      market: 'KOSDAQ',
      latest_sell_date: '2026-08-09T15:00:00+09:00',
    };
    const result = toActiveSignal(row, 'sell');
    expect(result.signal_type).toBe('SELL');
    expect(result.timestamp).toBe('2026-08-09T15:00:00+09:00');
    expect(result.signal_price).toBe('');
  });

  it('name 이 비면 symbol 로, market 이 비면 기타로 대체합니다', () => {
    const row = { symbol: '123456', latest_signal_date: '2026-08-10T09:00:00+09:00' };
    const result = toActiveSignal(row, 'buy');
    expect(result.name).toBe('123456');
    expect(result.market).toBe('기타');
  });

  it('latest_signal_type 이 없는 BUY 행은 BUY 로 채웁니다', () => {
    const row = { symbol: '123456', name: '테스트', latest_signal_date: '2026-08-10T09:00:00+09:00' };
    expect(toActiveSignal(row, 'buy').signal_type).toBe('BUY');
  });

  it('latest_signal_price 가 0 이면 빈 문자열이 아니라 "0" 입니다', () => {
    const row = { symbol: '123456', latest_signal_date: '2026-08-10T09:00:00+09:00', latest_signal_price: 0 };
    expect(toActiveSignal(row, 'buy').signal_price).toBe('0');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd web && npx vitest run src/lib/signal-constants.test.ts`
Expected: FAIL — `toActiveSignal` is not a function / 모듈에 export 없음

- [ ] **Step 3: 함수 구현**

`web/src/lib/signal-constants.ts` 파일 끝에 추가합니다.

```ts
/** stock_cache 기반 활성 신호 원본 행 */
export type ActiveSignalRow = {
  symbol: string;
  name?: string | null;
  market?: string | null;
  latest_signal_date?: string | null;
  latest_signal_type?: string | null;
  latest_signal_price?: number | null;
  latest_sell_date?: string | null;
};

/** SignalColumns 가 소비하는 신호 형태 */
export type ActiveSignal = {
  symbol: string;
  name: string;
  market: string;
  signal_type: string;
  source: string;
  timestamp: string;
  signal_price: string;
  sector: string;
};

/**
 * stock_cache 행을 활성 신호로 변환합니다.
 *
 * 페이지의 최초 200행과 API 의 이어받기 행이 같은 형태여야 하므로
 * 양쪽 모두 이 함수를 사용합니다. source·sector 가 빈 문자열인 것은
 * stock_cache 에 해당 정보가 없기 때문이며 기존 동작과 같습니다.
 */
export function toActiveSignal(row: ActiveSignalRow, type: 'buy' | 'sell'): ActiveSignal {
  const price = row.latest_signal_price;
  return {
    symbol: row.symbol,
    name: row.name || row.symbol,
    market: row.market || '기타',
    signal_type: type === 'buy' ? row.latest_signal_type || 'BUY' : 'SELL',
    source: '',
    timestamp: (type === 'buy' ? row.latest_signal_date : row.latest_sell_date) ?? '',
    signal_price: type === 'buy' && price !== null && price !== undefined ? String(price) : '',
    sector: '',
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd web && npx vitest run src/lib/signal-constants.test.ts`
Expected: PASS — 5개 테스트 모두 통과

- [ ] **Step 5: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/lib/signal-constants.ts web/src/lib/signal-constants.test.ts
git commit -m "refactor: 활성 신호 변환 함수를 signal-constants로 이관

페이지와 이어받기 API 가 같은 변환을 써야 무한 스크롤로 붙인 행의
형태가 어긋나지 않습니다."
```

---

### Task 2: 활성 신호 이어받기 API

`stock_cache` 기반 BUY/SELL 활성 목록을 페이지 단위로 내려주는 라우트를 만듭니다. 기존 `/api/v1/signals`는 `signals` 테이블을 조회하므로 의미가 달라 별도 라우트로 분리합니다.

**Files:**
- Create: `web/src/app/api/v1/signals/active/route.ts`
- Create: `web/src/app/api/v1/signals/active/params.ts`
- Test: `web/src/app/api/v1/signals/active/params.test.ts`

**Interfaces:**
- Consumes: Task 1의 `toActiveSignal`, `ActiveSignal`
- Produces: `GET /api/v1/signals/active?type=buy|sell&offset=0&limit=200` → `{ items: ActiveSignal[], total: number, hasMore: boolean }`. Task 4와 Task 5의 클라이언트가 호출합니다. 파라미터 파싱 함수 `parseActiveParams(searchParams: URLSearchParams): { type: 'buy' | 'sell'; offset: number; limit: number }`.

- [ ] **Step 1: 실패하는 테스트 작성**

라우트 본체는 Supabase에 의존해 node 환경에서 테스트하기 어려우므로, 파라미터 파싱만 순수 함수로 분리해 테스트합니다.

`web/src/app/api/v1/signals/active/params.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseActiveParams } from './params';

const parse = (qs: string) => parseActiveParams(new URLSearchParams(qs));

describe('parseActiveParams', () => {
  it('기본값은 buy, offset 0, limit 200 입니다', () => {
    expect(parse('')).toEqual({ type: 'buy', offset: 0, limit: 200 });
  });

  it('type=sell 을 인식합니다', () => {
    expect(parse('type=sell').type).toBe('sell');
  });

  it('알 수 없는 type 은 buy 로 떨어뜨립니다', () => {
    expect(parse('type=hold').type).toBe('buy');
  });

  it('limit 은 1000 을 넘지 못합니다', () => {
    expect(parse('limit=5000').limit).toBe(1000);
  });

  it('limit 이 0 이하이면 기본값 200 을 씁니다', () => {
    expect(parse('limit=0').limit).toBe(200);
    expect(parse('limit=-10').limit).toBe(200);
  });

  it('숫자가 아닌 offset 은 0 으로 처리합니다', () => {
    expect(parse('offset=abc').offset).toBe(0);
    expect(parse('offset=-5').offset).toBe(0);
  });

  it('정상 값은 그대로 통과시킵니다', () => {
    expect(parse('type=sell&offset=400&limit=200')).toEqual({
      type: 'sell', offset: 400, limit: 200,
    });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd web && npx vitest run src/app/api/v1/signals/active/params.test.ts`
Expected: FAIL — `./params` 모듈을 찾을 수 없음

- [ ] **Step 3: 파라미터 파서 구현**

`web/src/app/api/v1/signals/active/params.ts`:

```ts
export type ActiveParams = {
  type: 'buy' | 'sell';
  offset: number;
  limit: number;
};

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

/** 쿼리스트링을 활성 신호 조회 파라미터로 정규화합니다. */
export function parseActiveParams(searchParams: URLSearchParams): ActiveParams {
  const type = searchParams.get('type') === 'sell' ? 'sell' : 'buy';

  const rawOffset = Number.parseInt(searchParams.get('offset') ?? '', 10);
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

  const rawLimit = Number.parseInt(searchParams.get('limit') ?? '', 10);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT;

  return { type, offset, limit };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd web && npx vitest run src/app/api/v1/signals/active/params.test.ts`
Expected: PASS — 7개 테스트 모두 통과

- [ ] **Step 5: 라우트 구현**

`web/src/app/api/v1/signals/active/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { toActiveSignal, type ActiveSignalRow } from '@/lib/signal-constants';
import { parseActiveParams } from './params';

export const dynamic = 'force-dynamic';

const BUY_COLUMNS = 'symbol, name, market, latest_signal_date, latest_signal_type, latest_signal_price';
const SELL_COLUMNS = 'symbol, name, market, latest_sell_date';

/**
 * GET /api/v1/signals/active
 * stock_cache 기준 현재 BUY/SELL 상태 종목을 페이지 단위로 반환합니다.
 * /signals 의 date=all 모드가 최초 200행 이후를 이어받을 때 사용합니다.
 */
export async function GET(request: NextRequest) {
  const { type, offset, limit } = parseActiveParams(new URL(request.url).searchParams);
  const supabase = createServiceClient();

  const query =
    type === 'buy'
      ? supabase
          .from('stock_cache')
          .select(BUY_COLUMNS, { count: 'exact' })
          .eq('has_active_sell', false)
          .not('latest_signal_date', 'is', null)
          .order('latest_signal_date', { ascending: false })
      : supabase
          .from('stock_cache')
          .select(SELL_COLUMNS, { count: 'exact' })
          .eq('has_active_sell', true)
          .not('latest_sell_date', 'is', null)
          .order('latest_sell_date', { ascending: false });

  const { data, count, error } = await query.range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = (data ?? []).map((row) => toActiveSignal(row as unknown as ActiveSignalRow, type));
  const total = count ?? 0;

  return NextResponse.json({ items, total, hasMore: offset + items.length < total });
}
```

- [ ] **Step 6: 라우트 동작 확인**

개발 서버를 띄우고 실제 응답을 확인합니다.

```bash
cd web && npm run dev
```

다른 터미널에서:

```bash
curl -s 'http://localhost:3000/api/v1/signals/active?type=buy&offset=0&limit=3' | head -c 600
curl -s 'http://localhost:3000/api/v1/signals/active?type=sell&offset=0&limit=3' | head -c 600
```

Expected: 각각 `items` 3건, `total`이 1600 안팎(BUY 약 1,678 / SELL 약 1,570), `hasMore: true`. `items[0]`에 `symbol`, `name`, `market`, `signal_type`, `timestamp` 필드가 모두 있어야 합니다.

- [ ] **Step 7: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/app/api/v1/signals/active/
git commit -m "feat: 활성 신호 이어받기 API 추가

stock_cache 기준 BUY/SELL 목록을 200행 단위로 반환합니다.
/signals 의 무한 스크롤과 요약 뷰 전량 로드가 사용합니다."
```

---

### Task 3: /signals 서버 쿼리 개편

1,000행 직렬 루프를 걷어내고 최초 200행 + 전체 건수 구조로 바꿉니다. 이 태스크가 서버 구간 1.3초를 제거하는 핵심입니다.

**Files:**
- Modify: `web/src/app/signals/page.tsx:1-14` (선언부), `:74-118` (date=all 분기), `:246-259` (SignalColumns 호출)

**Interfaces:**
- Consumes: Task 1의 `toActiveSignal`
- Produces: `SignalColumns`에 새 props `buyTotal: number`, `sellTotal: number`, `isActiveMode: boolean`을 전달합니다. Task 4가 이 props를 소비합니다.

- [ ] **Step 1: 캐시 선언 교체**

`web/src/app/signals/page.tsx:14`의 아래 줄을 찾습니다.

```ts
export const dynamic = 'force-dynamic';
```

다음으로 교체합니다.

```ts
// searchParams 를 읽으므로 Next.js 가 자동으로 동적 렌더링합니다.
// revalidate 는 fetch 캐시와 클라이언트 라우터 캐시(staleTimes.dynamic)에 작용합니다.
export const revalidate = 30;
```

- [ ] **Step 2: import 추가**

`web/src/app/signals/page.tsx:7`의 아래 줄을 찾습니다.

```ts
import { extractSignalPrice } from "@/lib/signal-constants";
```

다음으로 교체합니다.

```ts
import { extractSignalPrice, toActiveSignal, type ActiveSignalRow } from "@/lib/signal-constants";
```

- [ ] **Step 3: 직렬 루프를 200행 조회로 교체**

`page.tsx`의 `if (selectedDate === "all") {` 블록 안쪽 전체 — `const PAGE = 1000;`부터 `sellSignals = activeSellRows.map((s) => toSignal(s, "sell"));`까지, 그리고 그 사이의 `toSignal` 함수 정의를 포함해 모두 삭제하고 다음으로 교체합니다.

```ts
      // ── 전체 모드: 현재 BUY/SELL 상태 종목 (stock_cache 기반, 기간 무관) ──
      // 최초 화면은 최신순 200행만 보내고 나머지는 클라이언트가
      // /api/v1/signals/active 로 이어받습니다. 전체 건수는 head 조회로
      // 본문 전송 없이 가져옵니다.
      const INITIAL = 200;
      const BUY_COLUMNS = "symbol, name, market, latest_signal_date, latest_signal_type, latest_signal_price";
      const SELL_COLUMNS = "symbol, name, market, latest_sell_date";

      const [
        { data: buyRows, count: buyCount },
        { data: sellRows, count: sellCount },
      ] = await Promise.all([
        supabase
          .from("stock_cache")
          .select(BUY_COLUMNS, { count: "exact" })
          .eq("has_active_sell", false)
          .not("latest_signal_date", "is", null)
          .order("latest_signal_date", { ascending: false })
          .range(0, INITIAL - 1),
        supabase
          .from("stock_cache")
          .select(SELL_COLUMNS, { count: "exact" })
          .eq("has_active_sell", true)
          .not("latest_sell_date", "is", null)
          .order("latest_sell_date", { ascending: false })
          .range(0, INITIAL - 1),
      ]);

      buySignals = (buyRows ?? []).map(
        (s) => toActiveSignal(s as unknown as ActiveSignalRow, "buy") as unknown as Record<string, string>
      );
      sellSignals = (sellRows ?? []).map(
        (s) => toActiveSignal(s as unknown as ActiveSignalRow, "sell") as unknown as Record<string, string>
      );
      buyTotal = buyCount ?? buySignals.length;
      sellTotal = sellCount ?? sellSignals.length;
      isActiveMode = true;
```

- [ ] **Step 4: 총계 변수 선언 추가**

`page.tsx`에서 `let buySignals` / `let sellSignals` 선언부를 찾습니다.

```ts
  let buySignals: (Record<string, string> & { is_leader?: boolean })[] = [];
  let sellSignals: (Record<string, string> & { is_leader?: boolean })[] = [];
```

바로 아래에 다음 세 줄을 추가합니다.

```ts
  // 활성 모드에서만 서버 총계가 실제 건수와 다릅니다(최초 200행만 전송).
  let buyTotal = 0;
  let sellTotal = 0;
  let isActiveMode = false;
```

- [ ] **Step 5: 날짜 범위 모드에도 총계 설정**

`date` 범위 모드(`} else {` 블록)의 끝, `sellSignals = signals.filter(...)` 줄 바로 다음에 추가합니다. 이 모드는 전량을 이미 보내므로 총계가 배열 길이와 같습니다.

```ts
      buyTotal = buySignals.length;
      sellTotal = sellSignals.length;
```

- [ ] **Step 6: SignalColumns 에 총계 전달**

`page.tsx`의 `<SignalColumns` 호출에서 `symbolGroups={symbolGroups}` 다음 줄에 추가합니다.

```tsx
            buyTotal={buyTotal}
            sellTotal={sellTotal}
            isActiveMode={isActiveMode}
```

주도주 필터가 켜졌을 때는 서버가 보낸 200행 중 일부만 남으므로 총계 표시가 맞지 않습니다. `buyTotal` 전달을 다음처럼 바꿔 필터 적용 시에는 실제 배열 길이를 씁니다.

```tsx
            buyTotal={leaderOnly ? buySignals.filter((s) => (s as Record<string, unknown>).is_leader === true).length : buyTotal}
            sellTotal={sellTotal}
            isActiveMode={isActiveMode && !leaderOnly}
```

- [ ] **Step 7: 타입 검사와 빌드 확인**

Task 4에서 props를 받도록 고치기 전이므로 타입 오류가 납니다. 이 단계에서는 Task 4를 먼저 끝낸 뒤 함께 확인합니다. 다음만 실행해 문법 오류가 없는지 봅니다.

Run: `cd web && npx tsc --noEmit 2>&1 | grep -v "signal-columns" | head -20`
Expected: `page.tsx` 관련 오류가 없어야 합니다. `signal-columns` props 불일치 오류만 남습니다.

- [ ] **Step 8: 커밋하지 않고 Task 4 로 진행**

Task 4를 끝낸 뒤 두 파일을 함께 커밋합니다. 중간 상태로는 빌드가 통과하지 않습니다.

---

### Task 4: /signals 무한 스크롤

서버가 보낸 200행 뒤를 스크롤로 이어받습니다. 총계를 표시해 사용자가 전체 규모를 알 수 있게 합니다.

**Files:**
- Modify: `web/src/app/signals/signal-columns.tsx:335-360` (props·상태), `:452-500` (뷰 전환·목록 렌더)
- Create: `web/src/components/signals/use-active-signals.ts`
- Test: `web/src/components/signals/merge-signals.test.ts`
- Create: `web/src/components/signals/merge-signals.ts`

**Interfaces:**
- Consumes: Task 2의 `GET /api/v1/signals/active`, Task 3의 `buyTotal`·`sellTotal`·`isActiveMode` props
- Produces: `mergeSignals(existing, incoming)` 중복 제거 함수와 `useActiveSignals(...)` 훅. Task 5가 같은 훅의 전량 로드 경로를 씁니다.

- [ ] **Step 1: 중복 제거 함수의 실패하는 테스트 작성**

`web/src/components/signals/merge-signals.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mergeSignals } from './merge-signals';

const sig = (symbol: string, name = symbol) => ({ symbol, name });

describe('mergeSignals', () => {
  it('새 행을 뒤에 이어 붙입니다', () => {
    const result = mergeSignals([sig('A'), sig('B')], [sig('C')]);
    expect(result.map((s) => s.symbol)).toEqual(['A', 'B', 'C']);
  });

  it('이미 있는 symbol 은 건너뜁니다', () => {
    const result = mergeSignals([sig('A'), sig('B')], [sig('B'), sig('C')]);
    expect(result.map((s) => s.symbol)).toEqual(['A', 'B', 'C']);
  });

  it('기존 행의 값을 새 행이 덮어쓰지 않습니다', () => {
    const result = mergeSignals([sig('A', '원래이름')], [sig('A', '새이름')]);
    expect(result[0].name).toBe('원래이름');
  });

  it('들어오는 배열 안의 중복도 제거합니다', () => {
    const result = mergeSignals([], [sig('A'), sig('A'), sig('B')]);
    expect(result.map((s) => s.symbol)).toEqual(['A', 'B']);
  });

  it('빈 배열끼리 병합하면 빈 배열입니다', () => {
    expect(mergeSignals([], [])).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd web && npx vitest run src/components/signals/merge-signals.test.ts`
Expected: FAIL — `./merge-signals` 모듈을 찾을 수 없음

- [ ] **Step 3: 중복 제거 함수 구현**

`web/src/components/signals/merge-signals.ts`:

```ts
/**
 * 이어받은 신호를 기존 목록 뒤에 붙이되 symbol 중복을 제거합니다.
 * 자동 새로고침과 이어받기가 겹치면 같은 종목이 두 번 들어올 수 있어
 * 먼저 들어온 행을 유지합니다.
 */
export function mergeSignals<T extends { symbol: string }>(existing: T[], incoming: T[]): T[] {
  const seen = new Set(existing.map((s) => s.symbol));
  const merged = [...existing];
  for (const item of incoming) {
    if (seen.has(item.symbol)) continue;
    seen.add(item.symbol);
    merged.push(item);
  }
  return merged;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd web && npx vitest run src/components/signals/merge-signals.test.ts`
Expected: PASS — 5개 테스트 모두 통과

- [ ] **Step 5: 이어받기 훅 구현**

`web/src/components/signals/use-active-signals.ts`:

```ts
"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { mergeSignals } from "./merge-signals";

type Row = Record<string, string>;

const PAGE_SIZE = 200;
const FULL_PAGE_SIZE = 1000;

async function fetchPage(type: "buy" | "sell", offset: number, limit: number) {
  const res = await fetch(`/api/v1/signals/active?type=${type}&offset=${offset}&limit=${limit}`);
  if (!res.ok) throw new Error(`활성 신호 조회 실패: ${res.status}`);
  return (await res.json()) as { items: Row[]; total: number; hasMore: boolean };
}

/**
 * 서버가 보낸 최초 목록 뒤를 이어받습니다.
 *
 * initial 이 바뀌면(서버 재검증) 이어받은 분량을 버리고 처음부터 다시 시작합니다.
 * loadAll 은 요약·업종 뷰가 전량을 필요로 할 때 씁니다.
 */
export function useActiveSignals(initial: Row[], total: number, type: "buy" | "sell", enabled: boolean) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);
  const loadingRef = useRef(false);

  // 서버 데이터가 갱신되면 이어받은 분량을 리셋합니다.
  useEffect(() => {
    setRows(initial);
    setComplete(false);
  }, [initial]);

  const hasMore = enabled && !complete && rows.length < total;

  const loadMore = useCallback(async () => {
    if (!enabled || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const page = await fetchPage(type, rows.length, PAGE_SIZE);
      setRows((prev) => mergeSignals(prev, page.items));
      if (!page.hasMore) setComplete(true);
    } catch (e) {
      console.error("[useActiveSignals] 이어받기 실패:", e);
      setComplete(true);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [enabled, type, rows.length]);

  const loadAll = useCallback(async () => {
    if (!enabled || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      let acc = rows;
      let offset = acc.length;
      // 총계까지 1000행씩 채웁니다. 서버가 hasMore=false 를 주면 멈춥니다.
      for (;;) {
        const page = await fetchPage(type, offset, FULL_PAGE_SIZE);
        acc = mergeSignals(acc, page.items);
        offset = acc.length;
        if (!page.hasMore || page.items.length === 0) break;
      }
      setRows(acc);
      setComplete(true);
    } catch (e) {
      console.error("[useActiveSignals] 전량 로드 실패:", e);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [enabled, type, rows]);

  return { rows, loading, hasMore, loadMore, loadAll, complete };
}
```

- [ ] **Step 6: SignalColumns props 확장**

`signal-columns.tsx`의 `export default function SignalColumns({...})` props 타입에서 다음 줄을 찾습니다.

```ts
  symbolGroups?: Record<string, string[]>;
}) {
```

다음으로 교체합니다.

```ts
  symbolGroups?: Record<string, string[]>;
  buyTotal?: number;
  sellTotal?: number;
  isActiveMode?: boolean;
}) {
```

구조 분해 인자 목록에서 `symbolGroups: initialSymbolGroups = {},` 다음 줄에 추가합니다.

```ts
  buyTotal = 0,
  sellTotal = 0,
  isActiveMode = false,
```

- [ ] **Step 7: 훅 연결과 자동 새로고침 조정**

`signal-columns.tsx` 상단 import에 추가합니다.

```ts
import { useActiveSignals } from "@/components/signals/use-active-signals";
```

`const [actionMenu, setActionMenu] = useState<...>(null);` 바로 다음에 추가합니다.

```ts
  const buy = useActiveSignals(buySignals, buyTotal, "buy", isActiveMode);
  const sell = useActiveSignals(sellSignals, sellTotal, "sell", isActiveMode);

  // 이어받기를 시작했으면 자동 새로고침이 스크롤 위치를 초기화하지 않도록 멈춥니다.
  const hasLoadedMore = buy.rows.length > buySignals.length || sell.rows.length > sellSignals.length;
```

기존 자동 새로고침 `useEffect`의 조건문을 수정합니다. 다음 줄을 찾습니다.

```ts
      if (day >= 1 && day <= 5 && kstHour >= 9 && kstHour < 20) {
        router.refresh();
      }
```

다음으로 교체합니다.

```ts
      if (hasLoadedMore) return;
      if (day >= 1 && day <= 5 && kstHour >= 9 && kstHour < 20) {
        router.refresh();
      }
```

같은 `useEffect`의 의존성 배열 `}, [router]);`를 `}, [router, hasLoadedMore]);`로 바꿉니다.

- [ ] **Step 8: 목록 렌더를 훅 데이터로 교체하고 감시 요소 추가**

`viewMode === "list"` 분기에서 `buySignals`를 쓰는 곳을 `buy.rows`로, `sellSignals`를 쓰는 곳을 `sell.rows`로 바꿉니다. 모바일 탭의 건수 표시는 총계를 쓰도록 바꿉니다. 다음 줄을 찾습니다.

```tsx
            <span className="ml-1.5 text-xs opacity-70">
              ({buySignals.length})
            </span>
```

다음으로 교체합니다.

```tsx
            <span className="ml-1.5 text-xs opacity-70">
              ({isActiveMode ? buyTotal : buy.rows.length})
            </span>
```

매도 탭도 같은 방식으로 `sellSignals.length` → `isActiveMode ? sellTotal : sell.rows.length`로 바꿉니다.

각 목록의 마지막 항목 뒤에 감시 요소를 넣습니다. 매수 목록 컨테이너의 닫는 태그 직전에 추가합니다.

```tsx
        <InfiniteSentinel
          hasMore={buy.hasMore}
          loading={buy.loading}
          onReach={buy.loadMore}
          loaded={buy.rows.length}
          total={buyTotal}
        />
```

매도 목록에도 같은 요소를 `sell` 기준으로 추가합니다.

- [ ] **Step 9: 감시 컴포넌트 추가**

`signal-columns.tsx`의 `SignalCard` 함수 정의 바로 위에 추가합니다.

```tsx
/** 스크롤 끝에 닿으면 다음 페이지를 요청하는 감시 요소 */
function InfiniteSentinel({
  hasMore,
  loading,
  onReach,
  loaded,
  total,
}: {
  hasMore: boolean;
  loading: boolean;
  onReach: () => void;
  loaded: number;
  total: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasMore || !ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) onReach();
      },
      { rootMargin: "200px" }
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [hasMore, onReach]);

  if (total === 0) return null;

  return (
    <div ref={ref} className="py-4 text-center text-xs text-[var(--muted)]">
      {loading
        ? "불러오는 중…"
        : hasMore
          ? `${loaded} / ${total}건`
          : `전체 ${total}건`}
    </div>
  );
}
```

`signal-columns.tsx` 최상단 import에 `useRef`를 추가합니다. 다음 줄을 찾습니다.

```ts
import { useState, useCallback, useMemo, useEffect } from "react";
```

다음으로 교체합니다.

```ts
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
```

- [ ] **Step 10: 빌드와 린트 확인**

Run: `cd web && npx tsc --noEmit && npm run lint`
Expected: 오류 없음

- [ ] **Step 11: 로컬에서 동작 확인**

```bash
cd web && npm run dev
```

브라우저에서 `http://localhost:3000/signals`를 엽니다. 다음을 확인합니다.

1. 목록 하단에 `200 / 1678건` 형태가 보입니다.
2. 스크롤을 내리면 "불러오는 중…"이 잠깐 뜨고 200행이 더 붙습니다.
3. 끝까지 내리면 `전체 1678건`으로 바뀌고 더 이상 요청이 없습니다.
4. 개발자도구 Network 탭에서 `/api/v1/signals/active` 요청이 중복 없이 순차로 나갑니다.
5. 매도 탭도 같게 동작합니다.

- [ ] **Step 12: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/app/signals/page.tsx web/src/app/signals/signal-columns.tsx web/src/components/signals/
git commit -m "perf: /signals 최초 200행 + 무한 스크롤로 전환

1000행 직렬 루프 5라운드를 200행 조회 2라운드로 줄였습니다.
3248행 전량 전송이 사라져 RSC 페이로드가 크게 감소합니다.
이어받기 중에는 장중 자동 새로고침을 멈춰 스크롤 위치를 지킵니다."
```

---

### Task 5: 요약·업종 뷰 전량 로드

`summary`와 `industry` 뷰는 넘겨받은 배열 전체를 클라이언트에서 집계합니다. 200행만 있으면 내용이 틀어지므로 뷰를 여는 시점에 전량을 채웁니다.

**Files:**
- Modify: `web/src/app/signals/signal-columns.tsx:490-500` (뷰 전환 렌더 분기)

**Interfaces:**
- Consumes: Task 4의 `buy.loadAll`, `sell.loadAll`, `buy.complete`, `sell.complete`
- Produces: 없음

- [ ] **Step 1: 뷰 전환 시 전량 로드 트리거 추가**

`signal-columns.tsx`에서 `const [viewMode, setViewMode] = useState<...>("list");` 아래, 훅 선언 다음 위치에 추가합니다.

```ts
  // 요약·업종 뷰는 전체 집계가 필요하므로 뷰를 여는 시점에 전량을 채웁니다.
  const needsFullData = viewMode === "summary" || viewMode === "industry";
  const fullDataReady = !isActiveMode || (buy.complete && sell.complete);

  useEffect(() => {
    if (!needsFullData || !isActiveMode) return;
    if (!buy.complete) buy.loadAll();
    if (!sell.complete) sell.loadAll();
    // loadAll 은 rows 에 의존해 매 렌더 새로 만들어지므로 의존성에서 제외합니다.
    // complete 플래그가 재호출을 막습니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsFullData, isActiveMode, buy.complete, sell.complete]);
```

- [ ] **Step 2: 요약·업종 뷰 렌더를 전량 데이터로 교체**

다음 렌더 분기를 찾습니다.

```tsx
      {viewMode === "summary" ? (
        <SectorSummaryView buySignals={buySignals} sellSignals={sellSignals} onStockClick={handleSignalClick} />
      ) : viewMode === "industry" ? (
        <IndustrySummaryView buySignals={buySignals} sellSignals={sellSignals} onStockClick={handleSignalClick} />
      ) : (
```

다음으로 교체합니다.

```tsx
      {needsFullData && !fullDataReady ? (
        <div className="card p-8 text-center text-[var(--muted)]">
          전체 {buyTotal + sellTotal}건 집계 중…
        </div>
      ) : viewMode === "summary" ? (
        <SectorSummaryView buySignals={buy.rows} sellSignals={sell.rows} onStockClick={handleSignalClick} />
      ) : viewMode === "industry" ? (
        <IndustrySummaryView buySignals={buy.rows} sellSignals={sell.rows} onStockClick={handleSignalClick} />
      ) : (
```

- [ ] **Step 3: 빌드와 린트 확인**

Run: `cd web && npx tsc --noEmit && npm run lint`
Expected: 오류 없음

- [ ] **Step 4: 개선 전후 집계 일치 확인**

개선 전 값을 먼저 기록해 둡니다. 개선 전 커밋으로 잠시 되돌려 확인합니다.

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git stash
git log --oneline -5
```

`git checkout <Task 1 이전 커밋> -- web/src/app/signals/` 로 원본을 꺼내 `npm run dev`를 띄우고 `/signals`의 요약 뷰에서 소스별 "매수 N / 매도 M" 숫자와 업종 뷰의 업종 개수를 메모합니다. 확인이 끝나면 되돌립니다.

```bash
git checkout HEAD -- web/src/app/signals/
git stash pop
```

개선 후 같은 화면의 숫자가 메모와 일치하는지 확인합니다.

- [ ] **Step 5: 로컬에서 동작 확인**

`http://localhost:3000/signals`에서 다음을 확인합니다.

1. 요약 아이콘을 누르면 "전체 3248건 집계 중…"이 뜨고 잠시 뒤 목록이 나옵니다.
2. 나온 숫자가 Step 4에서 메모한 개선 전 값과 같습니다.
3. 업종 아이콘으로 바꿔도 다시 로드하지 않고 즉시 나옵니다.
4. 목록 뷰로 돌아갔다가 다시 요약으로 가도 재요청이 없습니다.

- [ ] **Step 6: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/app/signals/signal-columns.tsx
git commit -m "fix: 요약·업종 뷰 전환 시 전량 로드로 집계 정합성 유지

두 뷰는 전달받은 배열 전체를 집계하므로 200행만으로는 내용이
틀어집니다. 뷰를 여는 시점에 전량을 채우고 한 번 받으면 재사용합니다."
```

---

### Task 6: /signals Suspense 스트리밍

헤더와 필터가 데이터 대기 없이 먼저 페인트되게 합니다.

**Files:**
- Modify: `web/src/app/signals/page.tsx` (렌더 구조)
- Create: `web/src/app/signals/signals-skeleton.tsx`

**Interfaces:**
- Consumes: 없음
- Produces: `SignalsSkeleton` 컴포넌트

- [ ] **Step 1: 스켈레톤 컴포넌트 작성**

`web/src/app/signals/signals-skeleton.tsx`:

```tsx
/** SignalColumns 로딩 중 자리를 지키는 스켈레톤 */
export function SignalsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {[0, 1].map((col) => (
        <div key={col} className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border)]">
            <div className="h-4 w-24 rounded bg-[var(--card-hover)] animate-pulse" />
          </div>
          <div className="divide-y divide-[var(--border)]">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="px-4 py-3 flex items-center gap-3">
                <div className="h-5 w-12 rounded bg-[var(--card-hover)] animate-pulse" />
                <div className="h-4 flex-1 rounded bg-[var(--card-hover)] animate-pulse" />
                <div className="h-4 w-16 rounded bg-[var(--card-hover)] animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 무거운 조회를 별도 서버 컴포넌트로 분리**

현재 `SignalsPage` 하나가 `searchParams` 파싱, 즐겨찾기·관심그룹 공통 조회, 신호 조회, 렌더를 모두 합니다. 이 중 조회 부분을 같은 파일 안의 async 서버 컴포넌트 두 개로 나눕니다.

`SignalsContent`는 공통 조회와 신호 조회를 하고 `SignalColumns`를 반환합니다. `RecommendationContent`는 공통 조회만 하고 `RecommendationView`를 반환합니다. 두 분기는 `activeTab`으로 배타 선택되므로 공통 조회가 중복 실행되지 않습니다.

`SignalsPage`에는 `searchParams` 파싱, `last7` 계산, 오늘 신호 유무 판정, 헤더·필터 렌더만 남깁니다. 즐겨찾기·관심그룹 조회 4건은 `SignalsPage`에서 삭제하고 두 Content 컴포넌트로 각각 옮깁니다.

`page.tsx` 상단에 import를 추가합니다.

```tsx
import { Suspense } from "react";
import { SignalsSkeleton } from "./signals-skeleton";
```

반환 JSX에서 `<SignalColumns ... />` 호출 전체를 다음으로 교체합니다.

```tsx
          <Suspense fallback={<SignalsSkeleton />}>
            <SignalsContent
              selectedDate={selectedDate}
              activeSource={activeSource}
              leaderOnly={leaderOnly}
              last7={last7}
            />
          </Suspense>
```

`<RecommendationView ... />` 호출 전체를 다음으로 교체합니다.

```tsx
        <Suspense fallback={<SignalsSkeleton />}>
          <RecommendationContent defaultDateMode={defaultDateMode} />
        </Suspense>
```

파일 끝에 두 컴포넌트를 추가합니다. 본문에는 `SignalsPage`에서 옮긴 조회 코드를 그대로 넣습니다.

```tsx
/** 즐겨찾기·관심그룹 조회 — 두 Content 컴포넌트가 공유합니다. */
async function fetchCommon(supabase: ReturnType<typeof createServiceClient>) {
  const [{ data: favorites }, { data: watchlistItems }, { data: groupRows }, { data: groupStockRows }] =
    await Promise.all([
      supabase.from("favorite_stocks").select("symbol"),
      supabase.from("watchlist").select("symbol"),
      supabase.from("watchlist_groups").select("*").order("sort_order"),
      supabase.from("watchlist_group_stocks").select("group_id, symbol"),
    ]);

  const symbolGroups: Record<string, string[]> = {};
  for (const r of groupStockRows ?? []) {
    if (!symbolGroups[r.symbol]) symbolGroups[r.symbol] = [];
    symbolGroups[r.symbol].push(r.group_id);
  }

  return {
    favoriteSymbols: (favorites ?? []).map((f: { symbol: string }) => f.symbol),
    watchlistSymbols: (watchlistItems ?? []).map((w: { symbol: string }) => w.symbol),
    groups: (groupRows ?? []) as WatchlistGroup[],
    symbolGroups,
  };
}
```

`SignalsContent`는 `fetchCommon`과 신호 조회를 하나의 `Promise.all`로 묶어 실행한 뒤 `SignalColumns`를 반환합니다. Task 3에서 만든 200행 조회와 총계 계산 코드를 그대로 옮겨 씁니다. `RecommendationContent`는 `fetchCommon`만 호출하고 그 결과를 `RecommendationView`에 넘깁니다.

- [ ] **Step 3: HotThemesBanner 경계 추가**

`<HotThemesBanner />` 호출을 다음으로 감쌉니다.

```tsx
          <Suspense fallback={<div className="h-10" />}>
            <HotThemesBanner />
          </Suspense>
```

- [ ] **Step 4: 빌드와 린트 확인**

Run: `cd web && npx tsc --noEmit && npm run lint`
Expected: 오류 없음

- [ ] **Step 5: 스트리밍 동작 확인**

`npm run dev` 상태에서 개발자도구 Network 탭을 열고 스로틀링을 `Slow 3G`로 설정한 뒤 `/signals`를 새로고침합니다.

1. 페이지 제목 "AI 신호", 탭 전환 버튼, 날짜·소스 필터가 목록보다 먼저 나타납니다.
2. 목록 자리에는 스켈레톤 카드 2열이 보입니다.
3. 스켈레톤이 실제 목록으로 바뀝니다.
4. 필터를 스켈레톤 상태에서도 누를 수 있습니다.

- [ ] **Step 6: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/app/signals/
git commit -m "perf: /signals 헤더·필터를 데이터 대기 없이 먼저 렌더

무거운 신호 조회를 Suspense 경계 안으로 옮겨 헤더와 필터가
먼저 페인트되게 했습니다. 사용자가 로딩 중에도 필터를 조작합니다."
```

---

### Task 7: 실시간 시세 API

`/stocks`가 서버에서 기다리던 네이버 시세 조회를 클라이언트가 호출할 라우트로 옮깁니다.

**Files:**
- Create: `web/src/app/api/v1/stocks/live-prices/route.ts`

**Interfaces:**
- Consumes: `fetchAllStockPrices` (`@/lib/naver-stock-api`)
- Produces: `GET /api/v1/stocks/live-prices` → `{ prices: Record<string, { current_price: number; price_change: number; price_change_pct: number; volume: number; market_cap: number }>, marketOpen: boolean }`. Task 9의 클라이언트가 호출합니다.

- [ ] **Step 1: 라우트 구현**

`web/src/app/api/v1/stocks/live-prices/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { fetchAllStockPrices } from '@/lib/naver-stock-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** 장중(KST 평일 08~20시) 여부 */
function isMarketHours(): boolean {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const hour = kst.getUTCHours();
  const day = kst.getUTCDay();
  return day >= 1 && day <= 5 && hour >= 8 && hour < 20;
}

/**
 * GET /api/v1/stocks/live-prices
 * 네이버 전종목 현재가를 반환합니다.
 * /stocks 가 마운트 후 호출해 stock_cache 가격 위에 덮어씁니다.
 * 장중이 아니면 빈 응답을 즉시 돌려줍니다.
 */
export async function GET() {
  if (!isMarketHours()) {
    return NextResponse.json({ prices: {}, marketOpen: false });
  }

  try {
    const priceMap = await fetchAllStockPrices();
    const prices: Record<string, unknown> = {};
    for (const [symbol, p] of priceMap) {
      prices[symbol] = {
        current_price: p.current_price,
        price_change: p.price_change,
        price_change_pct: p.price_change_pct,
        volume: p.volume,
        market_cap: p.market_cap,
      };
    }
    return NextResponse.json({ prices, marketOpen: true });
  } catch (e) {
    console.error('[live-prices] 네이버 시세 조회 실패:', e);
    return NextResponse.json({ prices: {}, marketOpen: true });
  }
}
```

- [ ] **Step 2: 동작 확인**

```bash
cd web && npm run dev
```

다른 터미널에서:

```bash
curl -s 'http://localhost:3000/api/v1/stocks/live-prices' | head -c 400
```

Expected: 장중이면 `marketOpen: true`와 종목 코드를 키로 하는 `prices` 객체, 장 마감 후면 `{"prices":{},"marketOpen":false}`가 즉시 반환됩니다. 장 마감 후 응답은 100ms 안에 돌아와야 합니다.

- [ ] **Step 3: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/app/api/v1/stocks/live-prices/
git commit -m "feat: 실시간 시세 조회 API 추가

/stocks 가 서버 렌더링 중 네이버 API 를 기다리는 대신
클라이언트가 마운트 후 호출하도록 라우트를 분리했습니다."
```

---

### Task 8: /stocks 서버 쿼리 개편

47개 컬럼 전량 조회를 필요한 컬럼만으로 줄이고, 서버의 네이버 시세 대기를 없앱니다.

**Files:**
- Modify: `web/src/app/stocks/page.tsx:1-31` (import·선언·타임아웃 유틸), `:32-75` (쿼리·시세 병합)

**Interfaces:**
- Consumes: 없음
- Produces: `StockListClient`에 `marketOpen: boolean` prop을 추가로 전달합니다. Task 9가 소비합니다.

- [ ] **Step 1: 컬럼 상수 정의와 import 정리**

`web/src/app/stocks/page.tsx`의 상단 import에서 다음 줄을 삭제합니다.

```ts
import { fetchAllStockPrices, type StockPriceData } from "@/lib/naver-stock-api";
```

`export const dynamic = 'force-dynamic';`을 다음으로 교체합니다.

```ts
export const revalidate = 30;

/**
 * StockCache 타입이 실제로 쓰는 컬럼만 명시합니다.
 * stock_cache 는 47개 컬럼이라 select("*") 는 100행에 102KB 를 씁니다.
 */
const STOCK_COLUMNS = [
  "symbol", "name", "market", "current_price", "price_change", "price_change_pct",
  "volume", "market_cap", "per", "pbr", "roe", "eps", "bps", "dividend_yield",
  "high_52w", "low_52w", "latest_signal_type", "latest_signal_date",
  "signal_count_30d", "ai_score", "is_holding", "high_90d_pct",
  "is_favorite", "updated_at",
].join(", ");
```

- [ ] **Step 2: 장중 판정만 남기고 시세 대기 제거**

`isMarketHours` 함수는 클라이언트에 `marketOpen`을 알려주는 용도로 남깁니다. `withTimeout` 함수 전체와 `livePricePromise` 선언, `applyLive` 함수, `hasLive` 변수를 모두 삭제합니다.

`Promise.all` 배열에서 `livePricePromise,` 줄과 구조 분해의 `livePrices,` 줄을 삭제합니다.

- [ ] **Step 3: 쿼리 컬럼 교체**

`Promise.all` 안의 두 `stock_cache` 조회를 다음으로 바꿉니다.

```ts
    supabase.from("stock_cache").select(STOCK_COLUMNS).eq("is_favorite", true).order("name"),
    supabase.from("stock_cache").select(STOCK_COLUMNS).order("name").limit(100),
```

- [ ] **Step 4: applyLive 호출 제거**

다음 두 줄을 찾습니다.

```ts
  const favorites = (rawFavorites ?? []).map(fixName).map(applyLive);
  const stocks = (rawStocks ?? []).map(fixName).map(applyLive);
```

다음으로 교체합니다.

```ts
  const favorites = (rawFavorites ?? []).map(fixName);
  const stocks = (rawStocks ?? []).map(fixName);
```

- [ ] **Step 5: marketOpen prop 전달**

`<StockListClient` 호출의 `hasFavorites={hasFavorites}` 다음 줄에 추가합니다.

```tsx
      marketOpen={isMarketHours()}
```

- [ ] **Step 6: 빌드 확인**

Task 9에서 prop을 받도록 고치기 전이므로 `marketOpen` 관련 타입 오류가 남습니다.

Run: `cd web && npx tsc --noEmit 2>&1 | grep -v "marketOpen" | head -20`
Expected: `stocks/page.tsx`의 다른 오류가 없어야 합니다.

- [ ] **Step 7: 커밋하지 않고 Task 9 로 진행**

Task 9를 끝낸 뒤 함께 커밋합니다.

---

### Task 9: /stocks 클라이언트 시세 병합

DB 가격으로 먼저 그린 화면 위에 실시간 시세를 얹습니다.

**Files:**
- Modify: `web/src/components/stocks/stock-list-client.tsx` (props·상태·병합)

**Interfaces:**
- Consumes: Task 7의 `GET /api/v1/stocks/live-prices`, Task 8의 `marketOpen` prop
- Produces: 없음

- [ ] **Step 1: props 확장**

`stock-list-client.tsx`의 props 타입에 추가합니다.

```ts
  marketOpen?: boolean;
```

구조 분해 인자에 추가합니다.

```ts
  marketOpen = false,
```

- [ ] **Step 2: 시세 병합 로직 추가**

이 컴포넌트는 `stocks`(`:152`)와 `favStocks`(`:157`) 두 상태를 두고, `stocksMap`(`:307`) → `mergedStocks`(`:310`) → `displayStocks`(`:378`) 순으로 파생값을 만듭니다. 파생 단계마다 손대면 참조 지점이 많아 위험하므로, **두 원본 상태를 한 번 덮어쓰는 방식**을 씁니다. 하위 파이프라인이 자동으로 반영됩니다.

`const [pinMounted, setPinMounted] = useState(false);` (`:183`) 다음에 추가합니다.

```ts
  // 장중에는 마운트 후 실시간 시세를 받아 DB 가격 위에 덮어씁니다.
  // 서버 렌더링에서 네이버 API 를 기다리지 않으므로 첫 페인트가 지연되지 않습니다.
  useEffect(() => {
    if (!marketOpen) return;
    let cancelled = false;

    const applyLive = (
      rows: StockCache[],
      prices: Record<string, Partial<StockCache>>
    ): StockCache[] =>
      rows.map((row) => {
        const live = prices[row.symbol];
        if (!live) return row;
        return {
          ...row,
          current_price: live.current_price ?? row.current_price,
          price_change: live.price_change ?? row.price_change,
          price_change_pct: live.price_change_pct ?? row.price_change_pct,
          volume: (live.volume ?? 0) > 0 ? live.volume! : row.volume,
          market_cap: live.market_cap || row.market_cap,
        };
      });

    fetch("/api/v1/stocks/live-prices")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.prices) return;
        const prices = json.prices as Record<string, Partial<StockCache>>;
        if (Object.keys(prices).length === 0) return;
        setStocks((prev) => applyLive(prev, prices));
        setFavStocks((prev) => applyLive(prev, prices));
      })
      .catch((e) => console.error("[stocks] 실시간 시세 조회 실패:", e));

    return () => { cancelled = true; };
  }, [marketOpen]);
```

- [ ] **Step 3: 병합 범위 확인**

무한 스크롤로 나중에 추가되는 행에는 이 시세가 붙지 않습니다. 개선 전에도 서버 렌더 시점의 100행에만 적용됐으므로 동등한 동작입니다. 별도 처리를 넣지 않습니다.

`stocks`와 `favStocks`의 setter 이름이 `setStocks`·`setFavStocks`가 맞는지 `:152`와 `:157`에서 확인합니다.

- [ ] **Step 4: 빌드와 린트 확인**

Run: `cd web && npx tsc --noEmit && npm run lint`
Expected: 오류 없음

- [ ] **Step 5: 로컬에서 동작 확인**

`npm run dev` 상태에서 `http://localhost:3000/stocks`를 엽니다.

1. 페이지가 이전보다 눈에 띄게 빨리 표시됩니다.
2. 장중이면 잠시 뒤 가격이 실시간 값으로 바뀝니다.
3. 장 마감 후에는 `/api/v1/stocks/live-prices` 요청이 나가지 않습니다.
4. 정렬·필터·즐겨찾기 토글이 모두 정상입니다.
5. 가격 갱신 배지가 정상 표시됩니다.

- [ ] **Step 6: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add web/src/app/stocks/page.tsx web/src/components/stocks/stock-list-client.tsx
git commit -m "perf: /stocks 서버의 네이버 시세 대기 제거, 조회 컬럼 축소

장중 최대 4초 서버 대기를 없애고 클라이언트가 마운트 후 시세를
받아 덮어씁니다. select(*) 47컬럼을 화면이 쓰는 24컬럼으로 줄였습니다."
```

---

### Task 10: 통합 검증과 성능 기록

전체 회귀를 확인하고 개선 효과를 수치로 남깁니다.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-10-signals-stocks-perf-design.md` (측정 결과 추가)

**Interfaces:**
- Consumes: Task 1~9의 결과 전부
- Produces: 없음

- [ ] **Step 1: 전체 테스트 실행**

Run: `cd web && npm run test`
Expected: 기존 테스트 전부 통과 + 신규 17개(Task 1의 5개, Task 2의 7개, Task 4의 5개) 통과

- [ ] **Step 2: 린트와 프로덕션 빌드**

Run: `cd web && npm run lint && npm run build`
Expected: 오류·경고 없이 빌드 성공. 빌드 출력에서 `/signals`와 `/stocks`가 동적 렌더링(ƒ)으로 표시되는지 확인합니다.

- [ ] **Step 3: 성능 측정**

프로덕션 빌드로 서버를 띄웁니다.

```bash
cd web && npm run build && npm run start
```

다른 터미널에서 두 페이지의 응답 시간과 본문 크기를 잽니다.

```bash
for p in /signals /stocks; do
  curl -s -o /tmp/page.html -w "$p — %{time_starttransfer}s TTFB, %{time_total}s 총, %{size_download} bytes\n" "http://localhost:3000$p"
done
```

- [ ] **Step 4: 기능 회귀 확인**

`/signals`부터 봅니다. 목록 뷰에서 스크롤을 끝까지 내려 전체 건수만큼 이어 받아지는지, 요약·업종 뷰의 종목 나열이 개선 전과 같은지 확인합니다. 날짜 필터는 오늘·최근7일·전체·특정일 네 가지를 모두 눌러 보고, 소스 필터와 주도주 필터를 각 뷰에서 조합해 봅니다. 종목분석 탭으로 전환했다가 돌아오는 동작도 함께 확인합니다.

`/stocks`는 장중과 장 마감 후 두 조건에서 가격 표시와 갱신 배지가 정상인지 봅니다. 즐겨찾기와 관심그룹을 바꿨을 때 두 페이지 모두 즉시 반영되는지 확인합니다.

마지막으로 개발자도구의 반응형 모드에서 폭을 375px로 줄여 두 페이지가 깨지지 않는지 봅니다.

- [ ] **Step 5: 측정 결과를 설계 문서에 기록**

설계 문서 `docs/superpowers/specs/2026-08-10-signals-stocks-perf-design.md` 끝에 "## 측정 결과" 절을 추가하고 Step 3의 개선 전후 수치를 표로 남깁니다. 개선 전 수치는 설계 문서 "배경" 절의 계측값을 씁니다.

- [ ] **Step 6: 커밋**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git add docs/superpowers/specs/2026-08-10-signals-stocks-perf-design.md
git commit -m "docs: /signals·/stocks 개선 전후 성능 측정 결과 기록"
```

---

## 자체 검토 결과

**스펙 커버리지** — 설계 문서의 7개 절이 모두 태스크에 대응합니다. 1절(데이터 계층)은 Task 3, 2절(이어받기 API)은 Task 2, 3절(무한 스크롤)은 Task 4, 4절(뷰 정합성)은 Task 5, 5절(Suspense)은 Task 6, 6절(/stocks)은 Task 7~9, 7절(캐시)은 Task 3 Step 1과 Task 8 Step 1에 나뉘어 들어갔습니다. 검증 절은 Task 10입니다.

**타입 일관성** — `toActiveSignal`(Task 1)은 Task 2와 Task 3이 같은 이름으로 씁니다. `mergeSignals`(Task 4)는 Task 4 내부에서만 쓰입니다. `buyTotal`·`sellTotal`·`isActiveMode`는 Task 3이 넘기고 Task 4가 받습니다. `marketOpen`은 Task 8이 넘기고 Task 9가 받습니다.

**주의 사항** — Task 3과 Task 8은 단독으로 빌드가 통과하지 않습니다. 각각 Task 4, Task 9와 짝으로 완료해야 합니다. 계획 안에 명시했습니다.

Task 3이 `page.tsx`의 쿼리를 고치고 Task 6이 같은 파일의 구조를 다시 나눕니다. 한 번에 하면 변경 폭이 커져 회귀 원인을 좁히기 어려우므로 의도적으로 나눴습니다. Task 6은 조회 로직을 옮기기만 하고 쿼리 내용은 바꾸지 않습니다.

Task 9의 병합 방식은 `stocks`·`favStocks` 두 상태를 덮어쓰는 쪽으로 정했습니다. 파생값 파이프라인이 `stocksMap` → `mergedStocks` → `displayStocks` 3단계라 중간에 끼워 넣으면 참조 지점이 많아지기 때문입니다. 무한 스크롤로 나중에 추가되는 행에 시세가 붙지 않는 점은 개선 전과 같은 동작입니다.
