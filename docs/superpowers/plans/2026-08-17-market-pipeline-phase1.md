# 투자 시황 파이프라인 정상화 (단계 1) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 시황 지표가 정확한 값·등락률·기준 시각을 갖고 화면에 도달하게 하고, 수집 실패가 조용히 묻히지 않게 만듭니다.

**Architecture:** 지표 정의를 루트 `shared/market/` 한 곳에 모으고 배치와 웹이 그것만 참조합니다. 수집기는 소스별 모듈로 분리해 폴백을 갖추며, 배치 step 은 오류를 반환값으로 돌려주고 진입점이 그것을 집계해 종료 코드와 알림으로 드러냅니다. 화면 변경은 결손 표시 하나로 최소화하며, 판정 엔진 재설계는 단계 2 로 미룹니다.

**Tech Stack:** TypeScript, Node 20, tsx, Supabase JS v2, Next.js 16, Vitest, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-08-17-market-page-redesign-design.md`

## 개요

이 계획은 설계 문서가 정의한 세 단계 중 첫째를 다룹니다. 화면 재설계는 단계 3 이며 여기서는 손대지 않습니다. 예외가 하나 있는데, 지표가 하나도 없을 때 화면이 초록으로 「적극 매수 가능」을 띄우는 동작만은 지금 고칩니다. 파이프라인을 고쳐 놓고도 그 결과가 화면에서 여전히 거짓으로 보이면 정상화를 확인할 방법이 없기 때문입니다.

작업은 아래에서 위로 쌓습니다. 먼저 지표 정의를 한곳에 모아 배치와 웹이 같은 사실을 보게 만들고(Task 1), 소스별 수집기와 파생 계산을 순수 함수로 분리해 테스트로 고정합니다(Task 2~4). 그 위에서 스키마를 정리하고(Task 5) 배치를 재작성해 등락률을 되살리며(Task 6), 그동안 없던 국내 수급과 롤링 통계를 새로 수집합니다(Task 7~8). 마지막으로 조회 절단을 고치고(Task 9) 결손을 화면에 드러낸 뒤(Task 10), 실패가 묻히지 않도록 감지와 알림을 붙이고(Task 11) 배치를 3분할하며(Task 12) 죽은 코드를 걷어냅니다(Task 13).

각 태스크는 독립적으로 테스트되고 커밋됩니다. Task 5 이후의 실행 검증 단계는 Supabase 접근이 필요하므로, 환경변수를 얻지 못하면 코드 작성과 타입 검사까지만 진행하고 실제 실행은 GitHub Actions 의 `workflow_dispatch` 로 확인합니다.

## Global Constraints

아래 제약은 모든 태스크에 암묵적으로 포함됩니다. 특히 첫 세 항목은 배치와 웹이 코드를 공유하는 구조에서 나오는 것이라, 어기면 한쪽이 조용히 깨집니다.

| 제약 | 내용 |
|---|---|
| 언어 | 모든 주석·커밋 메시지·로그 문자열은 한국어로 작성합니다 |
| 모듈 해석 | 배치(`.github/scripts/`)는 ESM 이라 상대 경로 import 에 `.js` 확장자를 붙이고, 웹(`web/src/`)은 붙이지 않습니다 |
| 공유 모듈 | `shared/market/` 의 파일은 다른 파일을 import 하지 않는 자족 모듈로 유지합니다. 양쪽 해석 규칙이 달라 내부 import 가 생기면 한쪽이 깨집니다 |
| 단위 | 저장 단위는 소스가 주는 원 단위를 그대로 씁니다. 수집 시점 변환을 금지하고 임계값을 저장 단위에 맞춥니다 |
| 오류 전파 | 배치 step 의 반환형은 `Promise<{ errors: string[] }>` 입니다. 예외를 삼키고 정상 반환하지 않습니다 |
| 조회 | 1000행을 넘길 수 있는 Supabase 조회는 `.range()` 페이지네이션 또는 명시적 `.limit()` 을 씁니다 |
| 테스트 | `npm run test` (web 디렉터리)로 실행하며 네트워크를 타지 않습니다. 외부 응답은 고정 문자열로 주입합니다 |
| 커밋 | 태스크마다 최소 1회 남깁니다 |

---

## File Structure

**신설**

| 경로 | 책임 |
|---|---|
| `shared/market/catalog.ts` | 지표 정의 단일 출처 — 키·라벨·계층·소스·단위·임계값·가중치 |
| `shared/market/catalog.test.ts` | 카탈로그 정합성 검사 |
| `shared/market/sources/fred.ts` | FRED 무키 CSV 파싱 (순수 함수 + fetch 래퍼) |
| `shared/market/sources/fred.test.ts` | CSV 파싱 회귀 |
| `shared/market/sources/quotes.ts` | Yahoo·네이버 응답 파싱 (순수 함수 + fetch 래퍼) |
| `shared/market/sources/quotes.test.ts` | 응답 파싱 회귀 |
| `shared/market/derive.ts` | 실현변동성·등락률 계산 |
| `shared/market/derive.test.ts` | 파생 계산 회귀 |
| `.github/scripts/batch/step12-investor-daily.ts` | 코스피 일별 수급 수집 |
| `.github/scripts/batch/step13-indicator-stats.ts` | 롤링 통계 계산 |
| `.github/scripts/shared/notify.ts` | 텔레그램 발신 |
| `supabase/migrations/079_market_pipeline_phase1.sql` | 신규 테이블·컬럼 |

**수정**

| 경로 | 변경 내용 |
|---|---|
| `.github/scripts/batch/step6-market-data.ts` | 전면 재작성 — 카탈로그 기반, 등락률 기록, 오류 반환 |
| `.github/scripts/batch/step7-events.ts` | HTTP 상태 검사, 오류 반환 |
| `.github/scripts/batch/index.ts` | 오류 집계, 종료 코드, 알림, 신규 모드 분기 |
| `.github/workflows/daily-batch.yml` | 배치 3분할 |
| `web/vitest.config.ts` | `shared/` 포함 |
| `web/tsconfig.json` | `@shared/*` path |
| `web/src/lib/market-thresholds.ts` | 임계값을 카탈로그에서 파생, 커버리지 반환 |
| `web/src/types/market.ts` | 죽은 티커 정리 |
| `web/src/app/market/page.tsx` | 조회 절단 수정, KST 기준일 |
| `web/src/components/market/market-client.tsx` | 결손 표시, 기준일 노출 |
| `web/src/app/api/v1/market-indicators/realtime/route.ts` | 카탈로그 참조, KR_3Y 제거 |
| `web/src/app/api/v1/cron/market-score/route.ts` | 조회 절단 수정 |
| `web/src/app/api/v1/market-indicators/etf-sentiment/route.ts` | 조회 절단, 오류 노출 |

**삭제**

`web/src/hooks/use-market-indicators.ts`, `web/src/components/market/event-summary-card.tsx`, `web/scripts/fetch-market-indicators.ts`, `web/migrations/add_risk_index.sql`, `web/src/app/api/v1/cron/sector-stats/`

---

## Task 1: 공유 카탈로그 신설

**Files:**
- Create: `shared/market/catalog.ts`
- Create: `shared/market/catalog.test.ts`
- Modify: `web/vitest.config.ts`
- Modify: `web/tsconfig.json`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `IndicatorSpec` 타입, `CATALOG: Record<string, IndicatorSpec>`, `activeIndicators(): IndicatorSpec[]`, `Unit` 타입

- [ ] **Step 1: vitest 가 shared/ 를 보도록 설정**

`web/vitest.config.ts` 의 `include` 와 `resolve.alias` 를 수정합니다. 기존 TZ 관련 주석 블록은 그대로 둡니다.

```ts
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', '../shared/**/*.test.ts'],
    exclude: ['node_modules'],
    env: { TZ },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
});
```

`web/tsconfig.json` 의 `compilerOptions.paths` 에 항목을 추가합니다.

```json
"paths": {
  "@/*": ["./src/*"],
  "@shared/*": ["../shared/*"]
}
```

같은 파일의 `include` 배열에 `"../shared/**/*.ts"` 를 추가합니다.

- [ ] **Step 2: 카탈로그 정합성 테스트 작성**

`shared/market/catalog.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CATALOG, activeIndicators, type IndicatorSpec } from './catalog';

describe('지표 카탈로그', () => {
  it('키와 spec.key 가 일치한다', () => {
    for (const [key, spec] of Object.entries(CATALOG)) {
      expect(spec.key).toBe(key);
    }
  });

  it('임계값 단위가 저장 단위와 같다', () => {
    for (const spec of Object.values(CATALOG)) {
      expect(spec.thresholds.unit).toBe(spec.unit);
    }
  });

  it('direction 1 은 임계값이 오름차순, -1 은 내림차순이다', () => {
    for (const spec of Object.values(CATALOG)) {
      const [a, b, c] = spec.thresholds.levels;
      if (spec.direction === 1) {
        expect(a).toBeLessThan(b);
        expect(b).toBeLessThan(c);
      } else if (spec.direction === -1) {
        expect(a).toBeGreaterThan(b);
        expect(b).toBeGreaterThan(c);
      }
    }
  });

  it('가중치는 양수다', () => {
    for (const spec of Object.values(CATALOG)) {
      expect(spec.weight).toBeGreaterThan(0);
    }
  });

  it('활성 지표만 activeIndicators 에 담긴다', () => {
    const active = activeIndicators();
    expect(active.every((s) => s.enabled)).toBe(true);
    expect(active.length).toBeGreaterThan(0);
  });

  it('HY_SPREAD 임계값이 percent 단위다', () => {
    // FRED BAMLH0A0HYM2 는 2.71 같은 percent 값을 준다.
    // bps 기준 450 을 쓰면 어떤 신용위기에도 레벨 0 이 된다.
    const spec = CATALOG.HY_SPREAD as IndicatorSpec;
    expect(spec.unit).toBe('percent');
    expect(spec.thresholds.levels[0]).toBeLessThan(20);
  });

  it('YIELD_CURVE 임계값이 percent_point 단위다', () => {
    const spec = CATALOG.YIELD_CURVE as IndicatorSpec;
    expect(spec.unit).toBe('percent_point');
    expect(Math.abs(spec.thresholds.levels[0])).toBeLessThan(10);
  });

  it('죽은 소스는 카탈로그에서 비활성이다', () => {
    // VKOSPI: ^VKOSPI 404 delisted / CNN_FEAR_GREED: HTTP 418 차단
    expect(CATALOG.VKOSPI?.enabled ?? false).toBe(false);
    expect(CATALOG.CNN_FEAR_GREED).toBeUndefined();
    expect(CATALOG.FEAR_GREED).toBeUndefined();
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd web && npx vitest run ../shared/market/catalog.test.ts`
Expected: FAIL — `Failed to resolve import "./catalog"`

- [ ] **Step 4: 카탈로그 구현**

`shared/market/catalog.ts`:

```ts
/**
 * 시황 지표 카탈로그 — 단일 출처
 *
 * 배치(.github/scripts)와 웹(web/src)이 함께 읽습니다.
 * 양쪽 모듈 해석 규칙이 달라 이 파일은 다른 파일을 import 하지 않습니다.
 *
 * unit 은 "저장 단위"입니다. 수집 시점 변환을 하지 않고 소스가 주는 값을
 * 그대로 저장하며, 임계값을 저장 단위에 맞춥니다. FRED 가 주는 percent 값에
 * bps 임계값을 적용해 판정이 사문화된 사고를 구조적으로 막기 위함입니다.
 */

export type Unit = 'index' | 'percent' | 'percent_point' | 'krw' | 'usd' | 'won_100m';

export type Layer = 'global' | 'domestic';

export type SourceSpec =
  | { kind: 'fred'; seriesId: string }
  | { kind: 'yahoo'; ticker: string }
  | { kind: 'naver_index'; symbol: string }
  | { kind: 'naver_investor'; field: 'foreign' | 'institution' }
  | { kind: 'ecos'; statCode: string; itemCode: string }
  | { kind: 'derived'; from: string };

export interface IndicatorSpec {
  key: string;
  label: string;
  layer: Layer;
  /** 비활성 지표는 수집·판정에서 제외되나 정의는 이력으로 남긴다 */
  enabled: boolean;
  source: SourceSpec;
  fallback?: SourceSpec;
  unit: Unit;
  /** 값이 클수록 위험이면 1, 작을수록 위험이면 -1 */
  direction: 1 | -1;
  /** [주의, 위험, 극위험] 경계. 단위는 thresholds.unit 이며 unit 과 같아야 한다 */
  thresholds: { unit: Unit; levels: [number, number, number] };
  display: { suffix: string; digits: number };
  weight: number;
  /** 원값 대신 파생값으로 판정하는 지표 */
  derive?: 'drawdown_52w' | 'ma200_diff' | 'net_5d_sum';
  /** 이 일수를 넘겨 갱신이 없으면 결손으로 본다 */
  maxStaleDays: number;
  /** 비활성 사유 — enabled=false 일 때만 채운다 */
  disabledReason?: string;
}

export const CATALOG: Record<string, IndicatorSpec> = {
  // ── 글로벌 층 (간밤 선행) ────────────────────────────────
  VIX: {
    key: 'VIX',
    label: 'VIX (미국 변동성지수)',
    layer: 'global',
    enabled: true,
    source: { kind: 'fred', seriesId: 'VIXCLS' },
    fallback: { kind: 'yahoo', ticker: '^VIX' },
    unit: 'index',
    direction: 1,
    thresholds: { unit: 'index', levels: [20, 25, 30] },
    display: { suffix: '', digits: 2 },
    weight: 3,
    maxStaleDays: 4,
  },
  HY_SPREAD: {
    key: 'HY_SPREAD',
    label: '하이일드 스프레드',
    layer: 'global',
    enabled: true,
    source: { kind: 'fred', seriesId: 'BAMLH0A0HYM2' },
    unit: 'percent',
    direction: 1,
    // FRED 실측 2.71(percent). 과거 위기 국면 기준으로 4.5/5.5/7.0 을 잡는다.
    thresholds: { unit: 'percent', levels: [4.5, 5.5, 7.0] },
    display: { suffix: '%', digits: 2 },
    weight: 3,
    maxStaleDays: 5,
  },
  YIELD_CURVE: {
    key: 'YIELD_CURVE',
    label: '장단기 금리차 (10Y-2Y)',
    layer: 'global',
    enabled: true,
    source: { kind: 'fred', seriesId: 'T10Y2Y' },
    unit: 'percent_point',
    direction: -1,
    // FRED 실측 0.51(percent point). 역전이 위험 신호이므로 내림차순.
    thresholds: { unit: 'percent_point', levels: [0.5, 0.0, -0.5] },
    display: { suffix: 'pp', digits: 2 },
    weight: 2,
    maxStaleDays: 5,
  },
  US_10Y: {
    key: 'US_10Y',
    label: '미국 10년물 금리',
    layer: 'global',
    enabled: true,
    source: { kind: 'fred', seriesId: 'DGS10' },
    fallback: { kind: 'yahoo', ticker: '^TNX' },
    unit: 'percent',
    direction: 1,
    thresholds: { unit: 'percent', levels: [4.0, 4.5, 5.0] },
    display: { suffix: '%', digits: 3 },
    weight: 2,
    maxStaleDays: 5,
  },
  DXY: {
    key: 'DXY',
    label: '달러 인덱스',
    layer: 'global',
    enabled: true,
    source: { kind: 'yahoo', ticker: 'DX-Y.NYB' },
    unit: 'index',
    direction: 1,
    thresholds: { unit: 'index', levels: [100, 104, 108] },
    display: { suffix: '', digits: 2 },
    weight: 2,
    maxStaleDays: 4,
  },
  WTI: {
    key: 'WTI',
    label: 'WTI 원유',
    layer: 'global',
    enabled: true,
    source: { kind: 'yahoo', ticker: 'CL=F' },
    unit: 'usd',
    direction: 1,
    thresholds: { unit: 'usd', levels: [75, 90, 100] },
    display: { suffix: '', digits: 2 },
    weight: 2,
    maxStaleDays: 4,
  },
  GOLD: {
    key: 'GOLD',
    label: '금 200일 이격도',
    layer: 'global',
    enabled: true,
    source: { kind: 'yahoo', ticker: 'GC=F' },
    unit: 'usd',
    direction: 1,
    thresholds: { unit: 'usd', levels: [10, 20, 30] },
    display: { suffix: '', digits: 2 },
    weight: 1,
    derive: 'ma200_diff',
    maxStaleDays: 4,
  },
  EWY: {
    key: 'EWY',
    label: 'EWY 52주 고점 대비',
    layer: 'global',
    enabled: true,
    source: { kind: 'yahoo', ticker: 'EWY' },
    unit: 'usd',
    direction: -1,
    thresholds: { unit: 'usd', levels: [-7, -15, -25] },
    display: { suffix: '', digits: 2 },
    weight: 1,
    derive: 'drawdown_52w',
    maxStaleDays: 4,
  },

  // ── 국내 층 (당일) ──────────────────────────────────────
  KOSPI: {
    key: 'KOSPI',
    label: 'KOSPI 52주 고점 대비',
    layer: 'domestic',
    enabled: true,
    source: { kind: 'naver_index', symbol: 'KOSPI' },
    fallback: { kind: 'yahoo', ticker: '^KS11' },
    unit: 'index',
    direction: -1,
    thresholds: { unit: 'index', levels: [-7, -15, -25] },
    display: { suffix: '', digits: 2 },
    weight: 2,
    derive: 'drawdown_52w',
    maxStaleDays: 3,
  },
  KOSDAQ: {
    key: 'KOSDAQ',
    label: 'KOSDAQ 52주 고점 대비',
    layer: 'domestic',
    enabled: true,
    source: { kind: 'naver_index', symbol: 'KOSDAQ' },
    fallback: { kind: 'yahoo', ticker: '^KQ11' },
    unit: 'index',
    direction: -1,
    thresholds: { unit: 'index', levels: [-10, -20, -30] },
    display: { suffix: '', digits: 2 },
    weight: 1,
    derive: 'drawdown_52w',
    maxStaleDays: 3,
  },
  KR_VOL_20D: {
    key: 'KR_VOL_20D',
    label: 'KOSPI 20일 실현변동성',
    layer: 'domestic',
    enabled: true,
    source: { kind: 'derived', from: 'KOSPI' },
    unit: 'percent',
    direction: 1,
    // 연율화 표준편차(%). VKOSPI 대용이며 KRX OpenAPI 키 확보 시 교체한다.
    thresholds: { unit: 'percent', levels: [18, 25, 35] },
    display: { suffix: '%', digits: 1 },
    weight: 3,
    maxStaleDays: 3,
  },
  USD_KRW: {
    key: 'USD_KRW',
    label: '원/달러 환율',
    layer: 'domestic',
    enabled: true,
    source: { kind: 'yahoo', ticker: 'KRW=X' },
    fallback: { kind: 'fred', seriesId: 'DEXKOUS' },
    unit: 'krw',
    direction: 1,
    thresholds: { unit: 'krw', levels: [1380, 1430, 1480] },
    display: { suffix: '원', digits: 2 },
    weight: 3,
    maxStaleDays: 3,
  },
  FOREIGN_NET: {
    key: 'FOREIGN_NET',
    label: '외국인 5일 누적 순매수',
    layer: 'domestic',
    enabled: true,
    source: { kind: 'naver_investor', field: 'foreign' },
    unit: 'won_100m',
    direction: -1,
    // 억원. 5일 누적 순매도가 깊을수록 위험.
    thresholds: { unit: 'won_100m', levels: [-5000, -12000, -25000] },
    display: { suffix: '억', digits: 0 },
    weight: 3,
    derive: 'net_5d_sum',
    maxStaleDays: 3,
  },
  INSTITUTION_NET: {
    key: 'INSTITUTION_NET',
    label: '기관 5일 누적 순매수',
    layer: 'domestic',
    enabled: true,
    source: { kind: 'naver_investor', field: 'institution' },
    unit: 'won_100m',
    direction: -1,
    thresholds: { unit: 'won_100m', levels: [-4000, -9000, -18000] },
    display: { suffix: '억', digits: 0 },
    weight: 2,
    derive: 'net_5d_sum',
    maxStaleDays: 3,
  },

  // ── 비활성 (정의만 이력으로 유지) ─────────────────────────
  VKOSPI: {
    key: 'VKOSPI',
    label: 'VKOSPI (한국 변동성지수)',
    layer: 'domestic',
    enabled: false,
    disabledReason: 'Yahoo ^VKOSPI 404 delisted, KRX 정보데이터시스템 로그인 월. KRX OpenAPI 키 확보 시 재개',
    source: { kind: 'yahoo', ticker: '^VKOSPI' },
    unit: 'index',
    direction: 1,
    thresholds: { unit: 'index', levels: [22, 28, 35] },
    display: { suffix: '', digits: 2 },
    weight: 3,
    maxStaleDays: 3,
  },
  KR_3Y: {
    key: 'KR_3Y',
    label: '국고채 3년',
    layer: 'domestic',
    enabled: false,
    disabledReason: 'ECOS 인증키 미발급. 기존 배치는 ^IRX(미국 13주), 실시간은 122630.KS(KODEX 레버리지)를 넣어 두 자산이 섞여 있었음',
    source: { kind: 'ecos', statCode: '817Y002', itemCode: '010200000' },
    unit: 'percent',
    direction: 1,
    thresholds: { unit: 'percent', levels: [3.2, 3.8, 4.5] },
    display: { suffix: '%', digits: 3 },
    weight: 1.5,
    maxStaleDays: 5,
  },
};

/** 수집·판정 대상 지표 */
export function activeIndicators(): IndicatorSpec[] {
  return Object.values(CATALOG).filter((s) => s.enabled);
}

/** 계층별 활성 지표 */
export function indicatorsByLayer(layer: Layer): IndicatorSpec[] {
  return activeIndicators().filter((s) => s.layer === layer);
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd web && npx vitest run ../shared/market/catalog.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 6: 기존 테스트 회귀 확인**

Run: `cd web && npm run test`
Expected: 기존 테스트 전부 PASS, 신규 8건 추가

- [ ] **Step 7: 커밋**

```bash
git add shared/market/catalog.ts shared/market/catalog.test.ts web/vitest.config.ts web/tsconfig.json
git commit -m "feat: 시황 지표 카탈로그를 shared/market 으로 단일화

지표 정의가 배치 티커표·웹 티커표·임계값·DB 가중치·화면 포맷 여섯 곳에
흩어져 서로 다른 집합을 담고 있던 문제를 해소한다. unit 과 thresholds.unit
을 함께 선언해 FRED percent 값에 bps 임계값을 적용하던 사고를 막는다.
VKOSPI 와 KR_3Y 는 소스 확보 전까지 비활성으로 정의만 남긴다."
```

---

## Task 2: FRED 무키 CSV 수집기

**Files:**
- Create: `shared/market/sources/fred.ts`
- Create: `shared/market/sources/fred.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `parseFredCsv(csv: string): FredPoint[]`, `fetchFredSeries(seriesId: string, from: string, to: string): Promise<FredPoint[]>`, `FredPoint = { date: string; value: number }`

- [ ] **Step 1: CSV 파싱 테스트 작성**

`shared/market/sources/fred.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseFredCsv, latestOf } from './fred';

// FRED 무키 CSV 실제 응답 형태.
// 결측은 마침표가 아니라 빈 문자열이다 (2026-08-17 실측 확인).
const SAMPLE = `observation_date,VIXCLS
2020-02-03,17.97
2020-02-04,16.05
2020-12-25,
2020-02-05,15.15
`;

describe('FRED CSV 파싱', () => {
  it('헤더를 건너뛰고 값을 파싱한다', () => {
    const points = parseFredCsv(SAMPLE);
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({ date: '2020-02-03', value: 17.97 });
  });

  it('빈 문자열 결측을 제외한다', () => {
    const points = parseFredCsv(SAMPLE);
    expect(points.some((p) => p.date === '2020-12-25')).toBe(false);
  });

  it('마침표 결측도 제외한다', () => {
    const points = parseFredCsv('observation_date,DGS10\n2020-01-01,.\n2020-01-02,1.88\n');
    expect(points).toHaveLength(1);
    expect(points[0].value).toBe(1.88);
  });

  it('빈 입력에서 빈 배열을 낸다', () => {
    expect(parseFredCsv('')).toEqual([]);
    expect(parseFredCsv('observation_date,VIXCLS\n')).toEqual([]);
  });

  it('CRLF 줄바꿈을 처리한다', () => {
    const points = parseFredCsv('observation_date,VIXCLS\r\n2020-02-03,17.97\r\n');
    expect(points).toHaveLength(1);
    expect(points[0].value).toBe(17.97);
  });

  it('latestOf 는 날짜가 가장 늦은 값을 낸다', () => {
    const points = parseFredCsv(SAMPLE);
    expect(latestOf(points)).toEqual({ date: '2020-02-05', value: 15.15 });
  });

  it('latestOf 는 빈 배열에서 null 을 낸다', () => {
    expect(latestOf([])).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd web && npx vitest run ../shared/market/sources/fred.test.ts`
Expected: FAIL — `Failed to resolve import "./fred"`

- [ ] **Step 3: 구현**

`shared/market/sources/fred.ts`:

```ts
/**
 * FRED 시계열 수집 — API 키 없는 공개 CSV 경로를 쓴다.
 *
 * https://fred.stlouisfed.org/graph/fredgraph.csv?id=<SERIES>&cosd=&coed=
 *
 * 기존 코드는 api.stlouisfed.org 의 JSON API 를 써서 FRED_API_KEY 가 없으면
 * 지표가 통째로 빠졌습니다. CSV 경로는 키를 요구하지 않습니다.
 *
 * 결측 표기가 JSON API 의 마침표가 아니라 빈 문자열이므로 양쪽을 모두 걸러냅니다.
 *
 * BAMLH0A0HYM2 는 ICE 저작권 제한으로 이 경로에서 최근 3년치만 반환됩니다.
 */

export interface FredPoint {
  date: string;
  value: number;
}

/** CSV 본문을 파싱한다. 결측 행은 제외한다. */
export function parseFredCsv(csv: string): FredPoint[] {
  const out: FredPoint[] = [];
  const lines = csv.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const comma = line.indexOf(',');
    if (comma < 0) continue;
    const date = line.slice(0, comma).trim();
    const raw = line.slice(comma + 1).trim();
    if (!raw || raw === '.') continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    out.push({ date, value });
  }
  return out;
}

/** 날짜가 가장 늦은 관측치 */
export function latestOf(points: FredPoint[]): FredPoint | null {
  let best: FredPoint | null = null;
  for (const p of points) {
    if (!best || p.date > best.date) best = p;
  }
  return best;
}

/** 시계열을 받아 파싱한다. 실패 시 예외를 던진다. */
export async function fetchFredSeries(
  seriesId: string,
  from: string,
  to: string,
): Promise<FredPoint[]> {
  const url =
    `https://fred.stlouisfed.org/graph/fredgraph.csv` +
    `?id=${encodeURIComponent(seriesId)}&cosd=${from}&coed=${to}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new Error(`FRED ${seriesId} HTTP ${res.status}`);
  }
  const text = await res.text();
  const points = parseFredCsv(text);
  if (points.length === 0) {
    throw new Error(`FRED ${seriesId} 관측치 0건 (${from}~${to})`);
  }
  return points;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd web && npx vitest run ../shared/market/sources/fred.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: 실제 호출 1회 검증**

Run:
```bash
curl -s --max-time 20 "https://fred.stlouisfed.org/graph/fredgraph.csv?id=T10Y2Y&cosd=2026-08-01&coed=2026-08-17" | head -5
```
Expected: `observation_date,T10Y2Y` 헤더와 소수점 값 (0.5 안팎). 값이 50 근처로 나오면 단위 가정이 틀린 것이므로 카탈로그 임계값을 재검토합니다.

- [ ] **Step 6: 커밋**

```bash
git add shared/market/sources/fred.ts shared/market/sources/fred.test.ts
git commit -m "feat: FRED 수집을 무키 CSV 경로로 전환

기존 JSON API 는 FRED_API_KEY 가 없으면 HY_SPREAD 와 YIELD_CURVE 가
통째로 빠졌다. 공개 CSV 경로는 키를 요구하지 않는다. 결측 표기가
마침표가 아니라 빈 문자열이므로 양쪽을 모두 걸러낸다."
```

---

## Task 3: Yahoo·네이버 시세 수집기

**Files:**
- Create: `shared/market/sources/quotes.ts`
- Create: `shared/market/sources/quotes.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `parseYahooChart(json: unknown): QuotePoint[]`, `parseNaverSiseJson(text: string): QuotePoint[]`, `fetchYahooDaily(ticker, from, to): Promise<QuotePoint[]>`, `fetchNaverIndexDaily(symbol, from, to): Promise<QuotePoint[]>`, `QuotePoint = { date: string; close: number }`

- [ ] **Step 1: 파싱 테스트 작성**

`shared/market/sources/quotes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseYahooChart, parseNaverSiseJson } from './quotes';

const YAHOO = {
  chart: {
    result: [
      {
        meta: { symbol: '^KS11', gmtoffset: 32400 },
        timestamp: [1580601600, 1580688000, 1580774400],
        indicators: { quote: [{ close: [2118.88, 2157.9, null] }] },
      },
    ],
  },
};

// 네이버 siseJson 은 JS 리터럴에 가까운 형태를 준다.
// 키가 따옴표 없이 오고 마지막에 쉼표가 붙는 경우가 있어 JSON.parse 가 실패한다.
const NAVER = `[['날짜','시가','고가','저가','종가','거래량','외국인소진율'],
['20150102', 1914.24, 1929.15, 1909.67, 1926.44, 258775, 0.0],
['20150105', 1926.44, 1930.10, 1901.05, 1915.65, 301254, 0.0]]`;

describe('Yahoo chart 파싱', () => {
  it('타임스탬프와 종가를 날짜별로 묶는다', () => {
    const points = parseYahooChart(YAHOO);
    expect(points).toHaveLength(2);
    expect(points[0].close).toBe(2118.88);
  });

  it('null 종가를 제외한다', () => {
    const points = parseYahooChart(YAHOO);
    expect(points.every((p) => Number.isFinite(p.close))).toBe(true);
  });

  it('KST 기준 날짜로 변환한다', () => {
    // 1580601600 = 2020-02-02T00:00:00Z = KST 2020-02-02 09:00
    const points = parseYahooChart(YAHOO);
    expect(points[0].date).toBe('2020-02-02');
  });

  it('빈 응답에서 빈 배열을 낸다', () => {
    expect(parseYahooChart({})).toEqual([]);
    expect(parseYahooChart({ chart: { result: [] } })).toEqual([]);
    expect(parseYahooChart(null)).toEqual([]);
  });
});

describe('네이버 siseJson 파싱', () => {
  it('헤더 행을 건너뛰고 종가를 뽑는다', () => {
    const points = parseNaverSiseJson(NAVER);
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual({ date: '2015-01-02', close: 1926.44 });
  });

  it('YYYYMMDD 를 하이픈 형식으로 바꾼다', () => {
    const points = parseNaverSiseJson(NAVER);
    expect(points[1].date).toBe('2015-01-05');
  });

  it('빈 입력에서 빈 배열을 낸다', () => {
    expect(parseNaverSiseJson('')).toEqual([]);
    expect(parseNaverSiseJson('[]')).toEqual([]);
  });

  it('차단 응답(HTML)에서 빈 배열을 낸다', () => {
    expect(parseNaverSiseJson('<html><body>error</body></html>')).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd web && npx vitest run ../shared/market/sources/quotes.test.ts`
Expected: FAIL — `Failed to resolve import "./quotes"`

- [ ] **Step 3: 구현**

`shared/market/sources/quotes.ts`:

```ts
/**
 * 시세 수집 — Yahoo chart v8 과 네이버 siseJson.
 *
 * Yahoo 는 쿠키 없이 호출하면 HTTP 429 로 차단되며 재현성이 불안정합니다.
 * fc.yahoo.com 에서 A3 쿠키를 받아 붙이면 통과하지만 배치에서 신뢰하기 어려워,
 * 한국 지수는 네이버를 주 소스로 두고 Yahoo 를 폴백으로 씁니다.
 * 두 소스의 KOSPI 종가가 2015-01-02 부터 완전히 일치하는 것을 확인했습니다.
 */

export interface QuotePoint {
  date: string;
  close: number;
}

interface YahooChartShape {
  chart?: {
    result?: {
      meta?: { gmtoffset?: number };
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
  };
}

/** epoch 초를 KST 날짜 문자열로 변환 */
function toKstDate(epochSec: number): string {
  return new Date((epochSec + 9 * 3600) * 1000).toISOString().slice(0, 10);
}

export function parseYahooChart(json: unknown): QuotePoint[] {
  const shape = json as YahooChartShape | null;
  const result = shape?.chart?.result?.[0];
  const stamps = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!stamps || !closes) return [];

  const out: QuotePoint[] = [];
  for (let i = 0; i < stamps.length; i++) {
    const close = closes[i];
    if (close == null || !Number.isFinite(close)) continue;
    out.push({ date: toKstDate(stamps[i]), close });
  }
  return out;
}

/**
 * 네이버 siseJson 응답 파싱.
 * 응답이 순수 JSON 이 아니라 작은따옴표 JS 리터럴이라 정규식으로 행을 뽑습니다.
 */
export function parseNaverSiseJson(text: string): QuotePoint[] {
  if (!text || text.includes('<html')) return [];
  const out: QuotePoint[] = [];
  // ['20150102', 1914.24, 1929.15, 1909.67, 1926.44, 258775, 0.0]
  const rowRe = /\[\s*['"](\d{8})['"]\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(text)) !== null) {
    const ymd = m[1];
    const close = Number(m[5]);
    if (!Number.isFinite(close)) continue;
    out.push({
      date: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`,
      close,
    });
  }
  return out;
}

/** 날짜 문자열(YYYY-MM-DD)을 epoch 초로 */
function toEpoch(date: string): number {
  return Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
}

export async function fetchYahooDaily(
  ticker: string,
  from: string,
  to: string,
): Promise<QuotePoint[]> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?period1=${toEpoch(from)}&period2=${toEpoch(to) + 86400}&interval=1d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Yahoo ${ticker} HTTP ${res.status}`);
  const points = parseYahooChart(await res.json());
  if (points.length === 0) throw new Error(`Yahoo ${ticker} 관측치 0건`);
  return points;
}

export async function fetchNaverIndexDaily(
  symbol: string,
  from: string,
  to: string,
): Promise<QuotePoint[]> {
  const url =
    `https://api.finance.naver.com/siseJson.naver` +
    `?symbol=${encodeURIComponent(symbol)}&requestType=1` +
    `&startTime=${from.replace(/-/g, '')}&endTime=${to.replace(/-/g, '')}&timeframe=day`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://finance.naver.com/' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`네이버 ${symbol} HTTP ${res.status}`);
  const points = parseNaverSiseJson(await res.text());
  if (points.length === 0) throw new Error(`네이버 ${symbol} 관측치 0건`);
  return points;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd web && npx vitest run ../shared/market/sources/quotes.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: 네이버 실제 호출 검증**

Run:
```bash
curl -s --max-time 20 -H "User-Agent: Mozilla/5.0" -H "Referer: https://finance.naver.com/" \
  "https://api.finance.naver.com/siseJson.naver?symbol=KOSPI&requestType=1&startTime=20260801&endTime=20260817&timeframe=day" | head -c 300
```
Expected: `[['날짜','시가',...],['20260801',...]` 형태

- [ ] **Step 6: 커밋**

```bash
git add shared/market/sources/quotes.ts shared/market/sources/quotes.test.ts
git commit -m "feat: 네이버 지수 수집기 추가, Yahoo 를 폴백으로 강등

Yahoo 는 쿠키 없이 호출하면 429 로 차단되고 재현성이 불안정하다.
KOSPI 종가가 두 소스에서 완전히 일치하는 것을 확인해 네이버를 주 소스로
둔다."
```

---

## Task 4: 파생 계산 모듈

**Files:**
- Create: `shared/market/derive.ts`
- Create: `shared/market/derive.test.ts`

**Interfaces:**
- Consumes: `QuotePoint` (Task 3 — 타입만 재선언, import 하지 않음)
- Produces: `realizedVol20d(closes: number[]): number | null`, `changePct(current: number, prev: number): number | null`, `drawdown52w(current: number, history: number[]): number | null`, `ma200Diff(current: number, history: number[]): number | null`

- [ ] **Step 1: 테스트 작성**

`shared/market/derive.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { realizedVol20d, changePct, drawdown52w, ma200Diff } from './derive';

describe('등락률', () => {
  it('상승률을 퍼센트로 낸다', () => {
    expect(changePct(110, 100)).toBeCloseTo(10, 6);
  });

  it('하락률을 음수로 낸다', () => {
    expect(changePct(90, 100)).toBeCloseTo(-10, 6);
  });

  it('직전값이 0 이면 null 을 낸다', () => {
    expect(changePct(10, 0)).toBeNull();
  });

  it('직전값이 없으면 null 을 낸다', () => {
    expect(changePct(10, null)).toBeNull();
  });
});

describe('20일 실현변동성', () => {
  it('변동이 없으면 0 을 낸다', () => {
    const flat = Array(21).fill(100);
    expect(realizedVol20d(flat)).toBeCloseTo(0, 6);
  });

  it('종가가 21개 미만이면 null 을 낸다', () => {
    expect(realizedVol20d(Array(20).fill(100))).toBeNull();
  });

  it('변동이 클수록 값이 커진다', () => {
    const mild = [100, 101, 100, 101, 100, 101, 100, 101, 100, 101,
                  100, 101, 100, 101, 100, 101, 100, 101, 100, 101, 100];
    const wild = [100, 110, 100, 110, 100, 110, 100, 110, 100, 110,
                  100, 110, 100, 110, 100, 110, 100, 110, 100, 110, 100];
    const a = realizedVol20d(mild);
    const b = realizedVol20d(wild);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(b!).toBeGreaterThan(a!);
  });

  it('연율화된 퍼센트 값을 낸다', () => {
    // 일간 1% 진폭이 반복되면 연율화 변동성은 10% 를 넘는다
    const series = Array.from({ length: 21 }, (_, i) => (i % 2 === 0 ? 100 : 101));
    const v = realizedVol20d(series);
    expect(v).not.toBeNull();
    expect(v!).toBeGreaterThan(10);
    expect(v!).toBeLessThan(30);
  });

  it('0 이하 종가가 섞이면 null 을 낸다', () => {
    const bad = Array(21).fill(100);
    bad[5] = 0;
    expect(realizedVol20d(bad)).toBeNull();
  });
});

describe('52주 낙폭', () => {
  it('고점 대비 낙폭을 음수 퍼센트로 낸다', () => {
    const hist = Array(60).fill(0).map((_, i) => (i === 0 ? 200 : 150));
    expect(drawdown52w(150, hist)).toBeCloseTo(-25, 6);
  });

  it('현재가 고점이면 0 을 낸다', () => {
    const hist = Array(60).fill(100);
    expect(drawdown52w(120, hist)).toBeCloseTo(0, 6);
  });

  it('이력이 50개 미만이면 null 을 낸다', () => {
    expect(drawdown52w(100, Array(49).fill(100))).toBeNull();
  });
});

describe('200일 이격도', () => {
  it('평균 대비 이격을 퍼센트로 낸다', () => {
    const hist = Array(200).fill(100);
    expect(ma200Diff(110, hist)).toBeCloseTo(10, 6);
  });

  it('이력이 50개 미만이면 null 을 낸다', () => {
    expect(ma200Diff(100, Array(49).fill(100))).toBeNull();
  });

  it('평균이 0 이면 null 을 낸다', () => {
    expect(ma200Diff(100, Array(60).fill(0))).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd web && npx vitest run ../shared/market/derive.test.ts`
Expected: FAIL — `Failed to resolve import "./derive"`

- [ ] **Step 3: 구현**

`shared/market/derive.ts`:

```ts
/**
 * 지표 파생 계산.
 *
 * 이 파일은 다른 파일을 import 하지 않습니다 (배치·웹 공유 제약).
 */

const TRADING_DAYS_PER_YEAR = 252;

/** 직전값 대비 등락률(%). 계산 불가면 null. */
export function changePct(current: number, prev: number | null | undefined): number | null {
  if (prev == null || prev === 0) return null;
  if (!Number.isFinite(current) || !Number.isFinite(prev)) return null;
  return ((current - prev) / prev) * 100;
}

/**
 * 20일 실현변동성 — 일간 로그수익률 표준편차를 연율화한 퍼센트.
 * VKOSPI 대용으로 쓰며, 내재변동성과 수준은 다르나 방향성은 같이 움직입니다.
 *
 * closes 는 시간 오름차순이며 최소 21개가 필요합니다(수익률 20개).
 */
export function realizedVol20d(closes: number[]): number | null {
  if (closes.length < 21) return null;
  const window = closes.slice(-21);
  const returns: number[] = [];
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1];
    const cur = window[i];
    if (!(prev > 0) || !(cur > 0)) return null;
    returns.push(Math.log(cur / prev));
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100;
}

/** 52주 고점 대비 낙폭(%). 음수일수록 깊은 조정. */
export function drawdown52w(current: number, history: number[]): number | null {
  if (history.length < 50) return null;
  let max = current;
  for (const v of history) if (v > max) max = v;
  if (max <= 0) return null;
  return ((current - max) / max) * 100;
}

/** 200일 이동평균 대비 이격도(%). */
export function ma200Diff(current: number, history: number[]): number | null {
  if (history.length < 50) return null;
  const window = history.slice(0, 200);
  const sum = window.reduce((a, b) => a + b, 0);
  const ma = sum / window.length;
  if (ma === 0) return null;
  return ((current - ma) / ma) * 100;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd web && npx vitest run ../shared/market/derive.test.ts`
Expected: PASS — 15 tests

- [ ] **Step 5: 커밋**

```bash
git add shared/market/derive.ts shared/market/derive.test.ts
git commit -m "feat: 지표 파생 계산 모듈 추가

등락률·20일 실현변동성·52주 낙폭·200일 이격도를 한곳에 모으고 테스트로
고정한다. 실현변동성은 소스가 사망한 VKOSPI 를 대신한다."
```

---

## Task 5: 스키마 마이그레이션

**Files:**
- Create: `supabase/migrations/079_market_pipeline_phase1.sql`

**Interfaces:**
- Consumes: 없음
- Produces: 테이블 `market_investor_daily`, `market_indicator_stats`; 컬럼 `market_indicators.source`, `market_indicators.collected_at`

- [ ] **Step 1: 마이그레이션 작성**

`supabase/migrations/079_market_pipeline_phase1.sql`:

```sql
-- 시황 파이프라인 정상화 (단계 1)
--
-- 1) market_indicators 에 출처·수집시각 추가
--    지금까지 어느 소스에서 온 값인지 사후 판별할 단서가 없었다.
-- 2) 코스피 일별 수급 테이블 신설
--    기존 step2 는 종목별 최근 5영업일 스냅숏을 덮어써 일별 이력이 남지 않는다.
-- 3) 지표 롤링 통계 테이블 신설
--    252일 분위수·52주 고점을 매 요청 계산하다 PostgREST 1000행 상한에 잘려
--    실제로는 약 70~90일 창으로 산출되던 문제를 배치 선계산으로 옮긴다.

ALTER TABLE market_indicators
  ADD COLUMN IF NOT EXISTS source VARCHAR(20),
  ADD COLUMN IF NOT EXISTS collected_at TIMESTAMPTZ;

COMMENT ON COLUMN market_indicators.source IS '수집 소스: fred | yahoo | naver | derived | backfill';
COMMENT ON COLUMN market_indicators.collected_at IS '수집 시각. date 는 관측일이라 둘이 다를 수 있다';

CREATE INDEX IF NOT EXISTS idx_market_indicators_type_date
  ON market_indicators (indicator_type, date DESC);

-- 코스피 전체 일별 투자자 순매수 (억원)
CREATE TABLE IF NOT EXISTS market_investor_daily (
  date DATE PRIMARY KEY,
  individual_net NUMERIC(14,2),
  foreign_net NUMERIC(14,2),
  institution_net NUMERIC(14,2),
  collected_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE market_investor_daily IS '코스피 전체 일별 투자자별 순매수, 단위 억원. 네이버 investorDealTrendDay 수집';

ALTER TABLE market_investor_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "market_investor_daily_all" ON market_investor_daily FOR ALL USING (true);

-- 지표 롤링 통계 (배치 선계산)
CREATE TABLE IF NOT EXISTS market_indicator_stats (
  indicator_key VARCHAR(30) NOT NULL,
  as_of DATE NOT NULL,
  high_52w NUMERIC(15,4),
  low_52w NUMERIC(15,4),
  ma_200d NUMERIC(15,4),
  ma_20d NUMERIC(15,4),
  pct_rank_252d NUMERIC(6,4),
  stddev_20d NUMERIC(15,6),
  sample_days INTEGER NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (indicator_key, as_of)
);

COMMENT ON COLUMN market_indicator_stats.sample_days IS '실제 계산에 쓰인 관측일 수. 기대보다 짧으면 조회가 절단된 것이다';

ALTER TABLE market_indicator_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "market_indicator_stats_all" ON market_indicator_stats FOR ALL USING (true);

-- KR_3Y 는 배치가 ^IRX(미국 13주 T-bill), 실시간이 122630.KS(KODEX 레버리지 ETF)
-- 두 자산을 같은 키에 번갈아 넣어 왔다. 구분이 불가능하므로 전량 삭제한다.
DELETE FROM market_indicators WHERE indicator_type = 'KR_3Y';

-- FEAR_GREED 는 배치가 CNN 값, 실시간이 VIX 역산값을 같은 키에 넣었다.
-- CNN 소스가 HTTP 418 로 차단되어 재수집도 불가하므로 삭제한다.
DELETE FROM market_indicators WHERE indicator_type = 'FEAR_GREED';

-- KORU 는 RISK_THRESHOLDS 에 정의가 없어 판정되지 않았고 EWY 와 중복이다.
DELETE FROM market_indicators WHERE indicator_type = 'KORU';
```

- [ ] **Step 2: SQL 문법 검증**

Run: `cd /Users/thlee/GoogleDrive/DashboardStock && npx --yes sql-formatter --language postgresql supabase/migrations/079_market_pipeline_phase1.sql > /dev/null && echo OK`
Expected: `OK`

문법 검증 도구를 쓸 수 없으면 Supabase 대시보드의 SQL 에디터에 붙여 실행 계획만 확인합니다.

- [ ] **Step 3: 마이그레이션 적용**

Supabase 대시보드 SQL 에디터에서 파일 내용을 실행합니다. 로컬 CLI 가 연결되어 있으면 `supabase db push` 를 씁니다.

적용 후 확인:
```sql
SELECT indicator_type, COUNT(*) FROM market_indicators GROUP BY 1 ORDER BY 1;
```
Expected: `KR_3Y`, `FEAR_GREED`, `KORU` 가 결과에 없음

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/079_market_pipeline_phase1.sql
git commit -m "feat: 시황 파이프라인 단계1 스키마

market_indicators 에 출처·수집시각을 추가하고, 코스피 일별 수급과 지표
롤링 통계 테이블을 신설한다. 서로 다른 자산이 섞여 있던 KR_3Y·FEAR_GREED
행과 판정되지 않던 KORU 행을 삭제한다."
```

---

## Task 6: step6 재작성

**Files:**
- Modify: `.github/scripts/batch/step6-market-data.ts` (전면 재작성)

**Interfaces:**
- Consumes: `CATALOG`, `activeIndicators` (Task 1); `fetchFredSeries`, `latestOf` (Task 2); `fetchYahooDaily`, `fetchNaverIndexDaily` (Task 3); `changePct`, `realizedVol20d` (Task 4)
- Produces: `runStep6MarketData(opts: { date: string }): Promise<{ errors: string[]; collected: number }>`

- [ ] **Step 1: 재작성**

`.github/scripts/batch/step6-market-data.ts` 를 다음으로 완전히 교체합니다.

```ts
// .github/scripts/batch/step6-market-data.ts
//
// 시황 지표 수집. 지표 정의는 shared/market/catalog.ts 가 단일 출처이며
// 이 파일은 소스 종류별 수집만 담당합니다.
//
// 기존 구현은 date/indicator_type/value 세 컬럼만 upsert 해 prev_value 와
// change_pct 가 서비스 시작 이래 NULL 이었습니다. 두 컬럼을 계산하던 코드는
// web/scripts/fetch-market-indicators.ts 에 있었으나 호출자가 없었습니다.
import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';
import { activeIndicators, type IndicatorSpec } from '../../../shared/market/catalog.js';
import { fetchFredSeries, latestOf } from '../../../shared/market/sources/fred.js';
import { fetchYahooDaily, fetchNaverIndexDaily } from '../../../shared/market/sources/quotes.js';
import { changePct, realizedVol20d } from '../../../shared/market/derive.js';

interface IndicatorRow {
  date: string;
  indicator_type: string;
  value: number;
  prev_value: number | null;
  change_pct: number | null;
  source: string;
  collected_at: string;
}

/** 수집 결과: 최근 두 관측치와 출처 */
interface Collected {
  date: string;
  value: number;
  prev: number | null;
  source: string;
  /** 실현변동성 계산에 쓸 종가 시계열 (KOSPI 만 채운다) */
  series?: number[];
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

async function collectOne(spec: IndicatorSpec, source = spec.source): Promise<Collected> {
  const to = new Date().toISOString().slice(0, 10);

  if (source.kind === 'fred') {
    const points = await fetchFredSeries(source.seriesId, daysAgo(40), to);
    points.sort((a, b) => a.date.localeCompare(b.date));
    const last = latestOf(points);
    if (!last) throw new Error(`${spec.key}: FRED 관측치 없음`);
    const prev = points.length >= 2 ? points[points.length - 2].value : null;
    return { date: last.date, value: last.value, prev, source: 'fred' };
  }

  if (source.kind === 'yahoo') {
    const points = await fetchYahooDaily(source.ticker, daysAgo(400), to);
    points.sort((a, b) => a.date.localeCompare(b.date));
    const last = points[points.length - 1];
    const prev = points.length >= 2 ? points[points.length - 2].close : null;
    return {
      date: last.date,
      value: last.close,
      prev,
      source: 'yahoo',
      series: points.map((p) => p.close),
    };
  }

  if (source.kind === 'naver_index') {
    const points = await fetchNaverIndexDaily(source.symbol, daysAgo(400), to);
    points.sort((a, b) => a.date.localeCompare(b.date));
    const last = points[points.length - 1];
    const prev = points.length >= 2 ? points[points.length - 2].close : null;
    return {
      date: last.date,
      value: last.close,
      prev,
      source: 'naver',
      series: points.map((p) => p.close),
    };
  }

  throw new Error(`${spec.key}: 이 step 이 다루지 않는 소스 ${source.kind}`);
}

export async function runStep6MarketData(): Promise<{ errors: string[]; collected: number }> {
  log('step6', '시황 지표 수집 시작');
  const errors: string[] = [];
  const rows: IndicatorRow[] = [];
  const collectedAt = new Date().toISOString();
  const seriesByKey: Record<string, number[]> = {};

  // 파생 지표(derived)는 원본 수집 후 계산하므로 뒤로 미룬다
  const specs = activeIndicators().filter((s) => s.source.kind !== 'derived');
  const derivedSpecs = activeIndicators().filter((s) => s.source.kind === 'derived');

  const settled = await Promise.allSettled(
    specs.map(async (spec) => {
      try {
        return { spec, got: await collectOne(spec) };
      } catch (primaryErr) {
        if (!spec.fallback) throw primaryErr;
        log('step6', `${spec.key} 주 소스 실패, 폴백 시도: ${(primaryErr as Error).message}`);
        const got = await collectOne(spec, spec.fallback);
        return { spec, got };
      }
    }),
  );

  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === 'rejected') {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      errors.push(`step6 ${specs[i].key}: ${msg}`);
      log('step6', `${specs[i].key} 수집 실패: ${msg}`);
      continue;
    }
    const { spec, got } = r.value;
    if (got.series) seriesByKey[spec.key] = got.series;
    rows.push({
      date: got.date,
      indicator_type: spec.key,
      value: got.value,
      prev_value: got.prev,
      change_pct: changePct(got.value, got.prev),
      source: got.source,
      collected_at: collectedAt,
    });
  }

  // 파생 지표
  for (const spec of derivedSpecs) {
    if (spec.source.kind !== 'derived') continue;
    const series = seriesByKey[spec.source.from];
    if (!series) {
      errors.push(`step6 ${spec.key}: 원본 ${spec.source.from} 시계열 없음`);
      continue;
    }
    if (spec.key === 'KR_VOL_20D') {
      const value = realizedVol20d(series);
      if (value === null) {
        errors.push(`step6 ${spec.key}: 실현변동성 계산 불가 (종가 ${series.length}건)`);
        continue;
      }
      const prevValue = realizedVol20d(series.slice(0, -1));
      const baseRow = rows.find((r) => r.indicator_type === spec.source.kind === undefined ? false : r.indicator_type === (spec.source as { from: string }).from);
      rows.push({
        date: baseRow?.date ?? new Date().toISOString().slice(0, 10),
        indicator_type: spec.key,
        value,
        prev_value: prevValue,
        change_pct: changePct(value, prevValue),
        source: 'derived',
        collected_at: collectedAt,
      });
    }
  }

  log('step6', `수집 ${rows.length}건 / 실패 ${errors.length}건`);

  if (rows.length > 0) {
    const { error } = await supabase
      .from('market_indicators')
      .upsert(rows, { onConflict: 'date,indicator_type' });
    if (error) {
      errors.push(`step6 upsert: ${error.message}`);
      log('step6', `upsert 오류: ${error.message}`);
    }
  }

  // 활성 지표의 절반 이상이 실패하면 파이프라인 이상으로 본다
  const active = activeIndicators().length;
  if (rows.length * 2 < active) {
    errors.push(`step6: 활성 지표 ${active}개 중 ${rows.length}개만 수집됨`);
  }

  log('step6', `완료: ${rows.length}개 지표 갱신`);
  return { errors, collected: rows.length };
}
```

- [ ] **Step 2: 파생 지표 baseRow 참조 정리**

위 코드의 `baseRow` 계산식은 읽기 어렵습니다. 해당 블록을 다음으로 교체합니다.

```ts
    if (spec.key === 'KR_VOL_20D') {
      const value = realizedVol20d(series);
      if (value === null) {
        errors.push(`step6 ${spec.key}: 실현변동성 계산 불가 (종가 ${series.length}건)`);
        continue;
      }
      const prevValue = realizedVol20d(series.slice(0, -1));
      const baseRow = rows.find((r) => r.indicator_type === spec.source.from);
      rows.push({
        date: baseRow?.date ?? new Date().toISOString().slice(0, 10),
        indicator_type: spec.key,
        value,
        prev_value: prevValue,
        change_pct: changePct(value, prevValue),
        source: 'derived',
        collected_at: collectedAt,
      });
    }
```

`spec.source.from` 접근을 위해 루프 시작에 타입 좁히기를 둡니다. 루프 첫 줄의 `if (spec.source.kind !== 'derived') continue;` 가 그 역할을 하므로 추가 작업은 없습니다.

- [ ] **Step 3: 타입 검사**

Run: `cd .github/scripts && npx tsc --noEmit`
Expected: 오류 없음. `../../../shared/market/catalog.js` 해석 실패가 나오면 `tsconfig.json` 의 `include` 에 `"../../shared/**/*.ts"` 를 추가합니다.

- [ ] **Step 4: 실제 실행 검증**

Run:
```bash
cd .github/scripts && SUPABASE_URL="$SUPABASE_URL" SUPABASE_SERVICE_KEY="$SUPABASE_SERVICE_KEY" \
  npx tsx -e "import('./batch/step6-market-data.js').then(m => m.runStep6MarketData()).then(r => console.log(JSON.stringify(r)))"
```
Expected: `{"errors":[],"collected":12}` 형태. 실패 지표가 있으면 `errors` 에 지표명과 사유가 담깁니다.

환경변수가 없으면 이 단계를 건너뛰고 Step 5 로 갑니다.

- [ ] **Step 5: DB 확인**

```sql
SELECT indicator_type, date, value, prev_value, change_pct, source
FROM market_indicators
WHERE collected_at > now() - interval '1 hour'
ORDER BY indicator_type;
```
Expected: `prev_value` 와 `change_pct` 가 NULL 이 아닌 행이 존재

- [ ] **Step 6: 커밋**

```bash
git add .github/scripts/batch/step6-market-data.ts
git commit -m "fix: 시황 지표 수집이 등락률을 기록하도록 복원

기존 구현은 date/indicator_type/value 세 컬럼만 upsert 해 prev_value 와
change_pct 가 서비스 시작 이래 NULL 이었다. 지표 정의를 카탈로그에서 읽고,
주 소스 실패 시 폴백을 타며, 실패한 지표명을 errors 로 돌려준다."
```

---

## Task 7: 코스피 일별 수급 수집

**Files:**
- Create: `.github/scripts/batch/step12-investor-daily.ts`

**Interfaces:**
- Consumes: 없음 (네이버 HTML 파싱 자체 구현)
- Produces: `runStep12InvestorDaily(opts: { days?: number }): Promise<{ errors: string[]; collected: number }>`

- [ ] **Step 1: 파싱 대상 응답 확인**

Run:
```bash
curl -s --max-time 20 -H "User-Agent: Mozilla/5.0" \
  "https://finance.naver.com/sise/investorDealTrendDay.naver?bizdate=20260814" \
  | iconv -f EUC-KR -t UTF-8 2>/dev/null | grep -A3 "tb_status2" | head -40
```
Expected: 날짜와 개인·외국인·기관계 숫자가 담긴 테이블 행. 응답 구조가 이 계획과 다르면 실제 구조에 맞춰 정규식을 조정하고 그 사실을 커밋 메시지에 남깁니다.

- [ ] **Step 2: 구현**

`.github/scripts/batch/step12-investor-daily.ts`:

```ts
// .github/scripts/batch/step12-investor-daily.ts
//
// 코스피 전체 일별 투자자 순매수 수집 (단위: 억원).
//
// 기존 step2-investor-data 는 종목별 최근 5영업일 스냅숏을 stock_cache 에
// 덮어써 일별 이력이 남지 않습니다. 시황 판정과 백테스트에는 지수 전체의
// 일별 시계열이 필요하므로 별도 테이블에 적재합니다.
//
// 네이버 investorDealTrendDay 는 bizdate 파라미터로 과거 소급을 허용하며
// 호출당 10영업일을 반환합니다.
import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';

export interface InvestorRow {
  date: string;
  individual_net: number;
  foreign_net: number;
  institution_net: number;
}

/** 숫자 문자열을 억원 단위 숫자로. 쉼표와 부호를 처리한다. */
function toNum(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, '').replace(/&minus;|−/g, '-');
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : null;
}

/** 네이버 응답 HTML 에서 일자별 순매수를 뽑는다. */
export function parseInvestorHtml(html: string): InvestorRow[] {
  const out: InvestorRow[] = [];
  // <td>2026.08.14</td> ... 개인 ... 외국인 ... 기관계
  const rowRe =
    /(\d{4})\.(\d{2})\.(\d{2})<\/td>[\s\S]*?<td[^>]*>([\-\d,]+)<\/td>[\s\S]*?<td[^>]*>([\-\d,]+)<\/td>[\s\S]*?<td[^>]*>([\-\d,]+)<\/td>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    const individual = toNum(m[4]);
    const foreign = toNum(m[5]);
    const institution = toNum(m[6]);
    if (individual === null || foreign === null || institution === null) continue;
    out.push({
      date,
      individual_net: individual,
      foreign_net: foreign,
      institution_net: institution,
    });
  }
  return out;
}

async function fetchPage(bizdate: string): Promise<InvestorRow[]> {
  const url = `https://finance.naver.com/sise/investorDealTrendDay.naver?bizdate=${bizdate}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://finance.naver.com/' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`네이버 수급 HTTP ${res.status} (bizdate=${bizdate})`);
  const buf = await res.arrayBuffer();
  const html = new TextDecoder('euc-kr').decode(buf);
  const rows = parseInvestorHtml(html);
  if (rows.length === 0) throw new Error(`네이버 수급 파싱 0건 (bizdate=${bizdate})`);
  return rows;
}

export async function runStep12InvestorDaily(
  opts: { days?: number } = {},
): Promise<{ errors: string[]; collected: number }> {
  const days = opts.days ?? 10;
  log('step12', `코스피 일별 수급 수집 시작 (최근 ${days}영업일)`);
  const errors: string[] = [];

  const bizdate = new Date(Date.now() + 9 * 3600 * 1000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '');

  let rows: InvestorRow[] = [];
  try {
    rows = await fetchPage(bizdate);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`step12: ${msg}`);
    log('step12', `수집 실패: ${msg}`);
    return { errors, collected: 0 };
  }

  const payload = rows.slice(0, days).map((r) => ({ ...r, collected_at: new Date().toISOString() }));
  const { error } = await supabase
    .from('market_investor_daily')
    .upsert(payload, { onConflict: 'date' });
  if (error) {
    errors.push(`step12 upsert: ${error.message}`);
    log('step12', `upsert 오류: ${error.message}`);
    return { errors, collected: 0 };
  }

  log('step12', `완료: ${payload.length}일치 수급 적재`);
  return { errors, collected: payload.length };
}
```

- [ ] **Step 3: 실행 검증**

Run:
```bash
cd .github/scripts && SUPABASE_URL="$SUPABASE_URL" SUPABASE_SERVICE_KEY="$SUPABASE_SERVICE_KEY" \
  npx tsx -e "import('./batch/step12-investor-daily.js').then(m => m.runStep12InvestorDaily()).then(r => console.log(JSON.stringify(r)))"
```
Expected: `{"errors":[],"collected":10}` 형태

파싱이 0건이면 Step 1 에서 확인한 실제 HTML 구조에 맞춰 `parseInvestorHtml` 의 정규식을 조정합니다.

- [ ] **Step 4: DB 확인**

```sql
SELECT * FROM market_investor_daily ORDER BY date DESC LIMIT 5;
```
Expected: 최근 영업일 5건, 억원 단위 숫자

- [ ] **Step 5: 커밋**

```bash
git add .github/scripts/batch/step12-investor-daily.ts
git commit -m "feat: 코스피 일별 투자자 순매수 수집 추가

기존 step2 는 종목별 최근 5영업일 스냅숏을 덮어써 일별 이력이 남지 않는다.
시황 판정과 백테스트에 필요한 지수 전체 시계열을 별도 테이블에 적재한다."
```

---

## Task 8: 롤링 통계 계산

**Files:**
- Create: `.github/scripts/batch/step13-indicator-stats.ts`

**Interfaces:**
- Consumes: `activeIndicators` (Task 1)
- Produces: `runStep13IndicatorStats(opts: { date: string }): Promise<{ errors: string[]; collected: number }>`

- [ ] **Step 1: 구현**

`.github/scripts/batch/step13-indicator-stats.ts`:

```ts
// .github/scripts/batch/step13-indicator-stats.ts
//
// 지표별 롤링 통계 선계산.
//
// 화면과 크론이 252일 분위수·52주 고점·200일 이평을 매 요청 원시 행으로
// 계산하는데, PostgREST 기본 max_rows(1000)에 잘려 실제로는 약 70~90 영업일
// 창으로 산출됩니다. 절단이 오류가 아니라 짧은 배열로 나타나 길이 가드를
// 통과하므로 조용히 틀린 값이 나옵니다.
//
// sample_days 를 함께 저장해 계산 창이 기대보다 짧으면 드러나게 합니다.
import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';
import { activeIndicators } from '../../../shared/market/catalog.js';

const PAGE = 1000;

/** 지표 하나의 최근 N일 값을 페이지네이션으로 전부 읽는다 */
async function loadSeries(key: string, since: string): Promise<{ date: string; value: number }[]> {
  const out: { date: string; value: number }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('market_indicators')
      .select('date, value')
      .eq('indicator_type', key)
      .gte('date', since)
      .order('date', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${key} 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const v = Number(row.value);
      if (Number.isFinite(v)) out.push({ date: row.date as string, value: v });
    }
    if (data.length < PAGE) break;
  }
  return out;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1));
}

/** values 안에서 current 의 백분위(0~1) */
function pctRank(current: number, values: number[]): number {
  if (values.length === 0) return 0;
  let count = 0;
  for (const v of values) if (v <= current) count++;
  return count / values.length;
}

export async function runStep13IndicatorStats(
  opts: { date: string },
): Promise<{ errors: string[]; collected: number }> {
  log('step13', '지표 롤링 통계 계산 시작');
  const errors: string[] = [];
  const since = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  const rows: Record<string, unknown>[] = [];

  for (const spec of activeIndicators()) {
    try {
      const series = await loadSeries(spec.key, since);
      if (series.length === 0) {
        errors.push(`step13 ${spec.key}: 관측치 없음`);
        continue;
      }
      // date 내림차순이므로 [0] 이 최신
      const values = series.map((s) => s.value);
      const current = values[0];
      const window252 = values.slice(0, 252);
      const window200 = values.slice(0, 200);
      const window20 = values.slice(0, 20);

      rows.push({
        indicator_key: spec.key,
        as_of: opts.date,
        high_52w: Math.max(...window252),
        low_52w: Math.min(...window252),
        ma_200d: window200.length >= 50 ? mean(window200) : null,
        ma_20d: window20.length >= 10 ? mean(window20) : null,
        pct_rank_252d: window252.length >= 30 ? pctRank(current, window252) : null,
        stddev_20d: window20.length >= 10 ? stddev(window20) : null,
        sample_days: series.length,
        updated_at: new Date().toISOString(),
      });

      if (series.length < 200) {
        log('step13', `${spec.key} 관측치 ${series.length}일 — 252일 창 미달`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`step13 ${spec.key}: ${msg}`);
    }
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from('market_indicator_stats')
      .upsert(rows, { onConflict: 'indicator_key,as_of' });
    if (error) {
      errors.push(`step13 upsert: ${error.message}`);
    }
  }

  log('step13', `완료: ${rows.length}개 지표 통계 갱신`);
  return { errors, collected: rows.length };
}
```

- [ ] **Step 2: 실행 검증**

Run:
```bash
cd .github/scripts && SUPABASE_URL="$SUPABASE_URL" SUPABASE_SERVICE_KEY="$SUPABASE_SERVICE_KEY" \
  npx tsx -e "import('./batch/step13-indicator-stats.js').then(m => m.runStep13IndicatorStats({date: new Date().toISOString().slice(0,10)})).then(r => console.log(JSON.stringify(r)))"
```
Expected: `{"errors":[],"collected":12}` 형태

- [ ] **Step 3: sample_days 확인**

```sql
SELECT indicator_key, sample_days, high_52w, pct_rank_252d
FROM market_indicator_stats
WHERE as_of = CURRENT_DATE ORDER BY sample_days;
```
Expected: `sample_days` 가 실제 적재 일수와 일치. 지표 적재 시작이 2026-04-06 이므로 초기에는 100 안팎이며, 이것이 정상입니다.

- [ ] **Step 4: 커밋**

```bash
git add .github/scripts/batch/step13-indicator-stats.ts
git commit -m "feat: 지표 롤링 통계를 배치에서 선계산

화면과 크론이 252일 창을 매 요청 계산하다 PostgREST 1000행 상한에 잘려
실제로는 약 70~90일 창으로 산출되던 문제를 해소한다. sample_days 를 함께
저장해 계산 창이 기대보다 짧으면 드러나게 한다."
```

---

## Task 9: 조회 절단 수정

**Files:**
- Modify: `web/src/app/market/page.tsx`
- Modify: `web/src/app/api/v1/cron/market-score/route.ts`
- Modify: `web/src/app/api/v1/market-indicators/etf-sentiment/route.ts`

**Interfaces:**
- Consumes: `market_indicator_stats` 테이블 (Task 8)
- Produces: 없음 (기존 인터페이스 유지)

- [ ] **Step 1: page.tsx 수정**

`web/src/app/market/page.tsx` 를 다음으로 교체합니다. 변경점은 KST 기준일, 지표 조회에 `.limit()` 명시, 롤링 통계 조회 추가입니다.

```tsx
import { createServiceClient } from "@/lib/supabase";
import { MarketClient } from "@/components/market/market-client";

export const dynamic = "force-dynamic";

/** KST 기준 오늘 날짜. UTC 를 쓰면 KST 00~09시에 하루 어긋납니다. */
function kstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export default async function MarketPage() {
  const supabase = createServiceClient();

  const today = kstToday();
  const thirtyDaysLater = new Date(Date.now() + 9 * 3600 * 1000 + 30 * 86400000)
    .toISOString()
    .slice(0, 10);

  // 지표 이력은 롤링 통계로 대체했으므로 최근 값만 읽습니다.
  // 이전 구현은 365일 원시 행을 limit 없이 읽어 PostgREST 1000행 상한에
  // 잘렸고, 절단이 짧은 배열로 나타나 길이 가드를 통과했습니다.
  const [
    { data: rawIndicators },
    { data: stats },
    { data: scoreHistory },
    { data: events },
  ] = await Promise.all([
    supabase
      .from("market_indicators")
      .select("indicator_type, value, prev_value, change_pct, date, source, collected_at")
      .gte("date", new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
      .order("date", { ascending: false })
      .limit(600),
    supabase
      .from("market_indicator_stats")
      .select("indicator_key, high_52w, low_52w, ma_200d, pct_rank_252d, sample_days, as_of")
      .order("as_of", { ascending: false })
      .limit(60),
    supabase
      .from("market_score_history")
      .select("date, total_score, breakdown, event_risk_score, combined_score, risk_index")
      .order("date", { ascending: false })
      .limit(90),
    supabase
      .from("market_events")
      .select("*")
      .gte("event_date", today)
      .lte("event_date", thirtyDaysLater)
      .order("event_date", { ascending: true }),
  ]);

  // 지표별 최신 1행만 남깁니다
  const seen = new Set<string>();
  const indicators = (rawIndicators || []).filter((row: { indicator_type: string }) => {
    if (seen.has(row.indicator_type)) return false;
    seen.add(row.indicator_type);
    return true;
  });

  // 지표별 최신 통계 1행만 남깁니다
  const statSeen = new Set<string>();
  const statsByKey: Record<string, {
    high_52w: number | null;
    low_52w: number | null;
    ma_200d: number | null;
    pct_rank_252d: number | null;
    sample_days: number;
  }> = {};
  for (const s of stats || []) {
    const key = s.indicator_key as string;
    if (statSeen.has(key)) continue;
    statSeen.add(key);
    statsByKey[key] = {
      high_52w: s.high_52w as number | null,
      low_52w: s.low_52w as number | null,
      ma_200d: s.ma_200d as number | null,
      pct_rank_252d: s.pct_rank_252d as number | null,
      sample_days: s.sample_days as number,
    };
  }

  return (
    <MarketClient
      indicators={indicators}
      statsByKey={statsByKey}
      scoreHistory={scoreHistory || []}
      events={events || []}
    />
  );
}
```

- [ ] **Step 2: cron/market-score 조회 절단 수정**

`web/src/app/api/v1/cron/market-score/route.ts` 의 90일 지표 조회에 페이지네이션을 붙입니다. 파일에서 `.from('market_indicators')` 로 시작하는 조회를 찾아 다음 헬퍼로 교체합니다.

```ts
/** PostgREST 1000행 상한을 넘겨 전부 읽는다 */
async function loadAllIndicators(
  supabase: ReturnType<typeof createServiceClient>,
  since: string,
) {
  const PAGE = 1000;
  const out: { indicator_type: string; value: number; date: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('market_indicators')
      .select('indicator_type, value, date')
      .gte('date', since)
      .order('date', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`market_indicators 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as typeof out));
    if (data.length < PAGE) break;
  }
  return out;
}
```

- [ ] **Step 3: etf-sentiment 오류 노출**

`web/src/app/api/v1/market-indicators/etf-sentiment/route.ts` 의 signals 조회를 수정합니다. 기존 코드는 `error` 를 받고도 `success: true` 와 빈 결과를 반환하며 로그도 남기지 않습니다.

```ts
  const { data: signals, error } = await supabase
    .from('signals')
    .select('symbol, signal_type, signal_date')
    .eq('source', 'lassi')
    .gte('signal_date', since)
    .order('signal_date', { ascending: false })
    .limit(1000);

  if (error) {
    console.error('[etf-sentiment] signals 조회 실패:', error.message);
    return Response.json(
      { success: false, error: 'signals 조회 실패', sectors: {}, rawEtfs: [] },
      { status: 500 },
    );
  }
```

- [ ] **Step 4: 빌드 검증**

Run: `cd web && npm run build`
Expected: 성공. `MarketClient` props 불일치 오류가 나오면 Task 10 에서 함께 맞춥니다 — 이 단계에서는 오류 메시지를 기록만 하고 진행합니다.

- [ ] **Step 5: 커밋**

```bash
git add web/src/app/market/page.tsx web/src/app/api/v1/cron/market-score/route.ts web/src/app/api/v1/market-indicators/etf-sentiment/route.ts
git commit -m "fix: 시황 조회가 1000행 상한에 잘리던 문제 수정

365일 원시 행을 limit 없이 읽어 실제로는 약 70~90일 창으로 계산되고 있었다.
장기 통계는 배치 선계산 테이블에서 읽고, 크론 조회는 페이지네이션을 붙인다.
기준일도 UTC 에서 KST 로 바꾼다."
```

---

## Task 10: 결손 표시

**Files:**
- Modify: `web/src/lib/market-thresholds.ts`
- Create: `web/src/lib/__tests__/market-thresholds.test.ts`
- Modify: `web/src/components/market/market-client.tsx`

**Interfaces:**
- Consumes: `CATALOG`, `activeIndicators` (Task 1)
- Produces: `RiskIndexResult` 에 `coverage: number`, `missing: string[]` 추가

- [ ] **Step 1: 테스트 작성**

`web/src/lib/__tests__/market-thresholds.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { calculateRiskIndex, getRiskLevel } from '@/lib/market-thresholds';

describe('위험 지수 커버리지', () => {
  it('지표가 하나도 없으면 커버리지 0 을 낸다', () => {
    const r = calculateRiskIndex({});
    expect(r.coverage).toBe(0);
    expect(r.validCount).toBe(0);
  });

  it('결손 지표가 missing 에 담긴다', () => {
    const r = calculateRiskIndex({ VIX: 15 });
    expect(r.missing).toContain('USD_KRW');
    expect(r.missing).not.toContain('VIX');
  });

  it('커버리지는 가중치 합 기준이다', () => {
    // VIX weight 3 만 있을 때, 전체 활성 가중치 합 대비 비율
    const r = calculateRiskIndex({ VIX: 15 });
    expect(r.coverage).toBeGreaterThan(0);
    expect(r.coverage).toBeLessThan(1);
  });

  it('비활성 지표는 커버리지 분모에 들어가지 않는다', () => {
    // VKOSPI 와 KR_3Y 는 소스 사망으로 비활성이므로 missing 에도 없어야 한다
    const r = calculateRiskIndex({ VIX: 15 });
    expect(r.missing).not.toContain('VKOSPI');
    expect(r.missing).not.toContain('KR_3Y');
  });
});

describe('단위 정합', () => {
  it('HY_SPREAD 는 percent 값으로 판정한다', () => {
    // FRED 실측 2.71 은 안전, 6.0 은 극위험이어야 한다.
    // bps 임계값(450)이 남아 있으면 6.0 도 레벨 0 이 된다.
    expect(getRiskLevel('HY_SPREAD', 2.71)).toBe(0);
    expect(getRiskLevel('HY_SPREAD', 6.0)).toBe(2);
    expect(getRiskLevel('HY_SPREAD', 7.5)).toBe(3);
  });

  it('YIELD_CURVE 는 percent point 값으로 판정한다', () => {
    // 정상 커브 +0.51 은 안전, 역전 -0.6 은 극위험
    expect(getRiskLevel('YIELD_CURVE', 0.51)).toBe(0);
    expect(getRiskLevel('YIELD_CURVE', -0.6)).toBe(3);
  });

  it('죽은 지표는 판정 대상이 아니다', () => {
    expect(getRiskLevel('CNN_FEAR_GREED', 20)).toBeNull();
    expect(getRiskLevel('FEAR_GREED', 20)).toBeNull();
    expect(getRiskLevel('KR_3Y', 3.5)).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd web && npx vitest run src/lib/__tests__/market-thresholds.test.ts`
Expected: FAIL — `coverage` 가 `undefined`, `getRiskLevel('HY_SPREAD', 6.0)` 이 `0`

- [ ] **Step 3: market-thresholds.ts 를 카탈로그 기반으로 전환**

파일 상단에 import 를 추가하고 `RISK_THRESHOLDS` 를 카탈로그에서 파생하도록 바꿉니다.

```ts
import { CATALOG, activeIndicators } from '@shared/market/catalog';

export type RiskLevel = 0 | 1 | 2 | 3;

export interface RiskThreshold {
  label: string;
  direction: 1 | -1;
  thresholds: [number, number, number];
  weight: number;
  derive?: 'drawdown_52w' | 'ma200_diff' | 'net_5d_sum';
}

/**
 * 임계값 테이블은 카탈로그에서 파생합니다.
 * 이전에는 이 파일이 독립 선언을 들고 있어 배치 티커표·DB 가중치와 어긋났습니다.
 */
export const RISK_THRESHOLDS: Record<string, RiskThreshold> = Object.fromEntries(
  activeIndicators().map((s) => [
    s.key,
    {
      label: s.label,
      direction: s.direction,
      thresholds: s.thresholds.levels,
      weight: s.weight,
      derive: s.derive,
    },
  ]),
);
```

`direction: 0` (양극단) 분기를 쓰던 코드를 제거합니다. 유일한 사용처였던 `CNN_FEAR_GREED` 가 카탈로그에 없으므로 `getRiskLevel`·`getRiskThresholdLabel`·`getRelativeRiskLevel` 의 `direction === 0` 블록과 `center` 필드를 삭제합니다.

- [ ] **Step 4: calculateRiskIndex 에 커버리지 추가**

```ts
export interface RiskIndexResult {
  riskIndex: number;
  breakdown: Record<string, { level: RiskLevel; value: number; absoluteLevel: RiskLevel; relativeLevel: RiskLevel | null }>;
  validCount: number;
  dangerCount: number;
  /** 판정에 반영된 가중치 합 / 활성 지표 가중치 합 (0~1) */
  coverage: number;
  /** 값이 없어 판정에서 빠진 활성 지표 키 */
  missing: string[];
}

export function calculateRiskIndex(
  values: Record<string, number | null | undefined>,
  history?: Record<string, number[] | undefined>
): RiskIndexResult {
  let weightedSum = 0;
  let maxPossible = 0;
  let validCount = 0;
  let dangerCount = 0;
  let coveredWeight = 0;
  let totalWeight = 0;
  const missing: string[] = [];
  const breakdown: RiskIndexResult['breakdown'] = {};

  for (const [type, threshold] of Object.entries(RISK_THRESHOLDS)) {
    totalWeight += threshold.weight;

    const value = values[type];
    const absoluteLevel = getRiskLevel(type, value, history?.[type]);
    if (absoluteLevel === null || value == null) {
      missing.push(type);
      continue;
    }

    const relativeLevel = history ? getRelativeRiskLevel(type, value, history[type]) : null;
    const level = (relativeLevel != null
      ? (Math.max(absoluteLevel, relativeLevel) as RiskLevel)
      : absoluteLevel);

    validCount++;
    coveredWeight += threshold.weight;
    weightedSum += LEVEL_WEIGHTS[level] * threshold.weight;
    maxPossible += LEVEL_WEIGHTS[3] * threshold.weight;
    breakdown[type] = { level, value, absoluteLevel, relativeLevel };
    if (level >= 2) dangerCount++;
  }

  const riskIndex = maxPossible > 0
    ? Math.round((weightedSum / maxPossible) * 10000) / 100
    : 0;

  return {
    riskIndex,
    breakdown,
    validCount,
    dangerCount,
    coverage: totalWeight > 0 ? coveredWeight / totalWeight : 0,
    missing,
  };
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd web && npx vitest run src/lib/__tests__/market-thresholds.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 6: 화면에 결손 표시**

`web/src/components/market/market-client.tsx` 의 `RiskAlertBanner` 를 수정합니다. 커버리지가 0.7 미만이면 점수 대신 산출 불가를 표시합니다.

```tsx
function RiskAlertBanner({
  riskIndex, dangerCount, validCount, coverage, missing,
}: {
  riskIndex: number;
  dangerCount: number;
  validCount: number;
  coverage: number;
  missing: string[];
}) {
  // 커버리지 미달이면 점수를 내지 않습니다.
  // 이전 구현은 지표 0건일 때 riskIndex 0 을 '안전 · 적극 매수 가능'으로
  // 표시해, 파이프라인이 죽은 상태와 가장 안전한 시장을 구분할 수 없었습니다.
  if (coverage < 0.7) {
    return (
      <div className="card p-3 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 border-[var(--border)]">
        <OctagonAlert className="w-8 h-8 sm:w-10 sm:h-10 shrink-0 text-[var(--muted)]" />
        <div className="flex-1 min-w-0">
          <div className="text-xl sm:text-2xl font-bold text-[var(--muted)]">산출 불가</div>
          <p className="text-xs sm:text-sm text-[var(--muted)] mt-1">
            지표 커버리지 {Math.round(coverage * 100)}% · 결측 {missing.length}종
            {missing.length > 0 && ` (${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ' 외' : ''})`}
          </p>
        </div>
      </div>
    );
  }

  const interp = getRiskInterpretation(riskIndex);
  const level = riskIndex >= 75 ? 3 : riskIndex >= 50 ? 2 : riskIndex >= 25 ? 1 : 0;
  const Icon = level >= 3 ? ShieldX : level >= 2 ? OctagonAlert : level >= 1 ? ShieldAlert : ShieldCheck;

  return (
    <div
      className="card p-3 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4"
      style={{ borderColor: interp.color + "60", background: interp.color + "08" }}
    >
      <Icon className="w-8 h-8 sm:w-10 sm:h-10 shrink-0" style={{ color: interp.color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <span className="text-xl sm:text-2xl font-bold" style={{ color: interp.color }}>
            {interp.label}
          </span>
          <span className="text-2xl sm:text-3xl font-black tabular-nums" style={{ color: interp.color }}>
            {riskIndex.toFixed(1)}
          </span>
          <span className="text-xs sm:text-sm text-[var(--muted)]">/ 100</span>
        </div>
        <p className="text-xs sm:text-sm text-[var(--muted)] mt-1">
          {validCount}개 지표 중 {dangerCount}개가 위험 구간 · {interp.action}
        </p>
      </div>
    </div>
  );
}
```

호출부도 함께 고칩니다.

```tsx
  const { riskIndex, breakdown, validCount, dangerCount, coverage, missing } = useMemo(
    () => calculateRiskIndex(valueMap, historyByType),
    [valueMap, historyByType]
  );
```

```tsx
      <RiskAlertBanner
        riskIndex={riskIndex}
        dangerCount={dangerCount}
        validCount={validCount}
        coverage={coverage}
        missing={missing}
      />
```

- [ ] **Step 7: 지표 행에 기준일 표시**

`IndicatorCard` 의 지표명 블록 아래에 날짜를 넣습니다.

```tsx
      <div className="flex-1 min-w-[5rem] sm:min-w-[6rem]">
        <span className="text-xs sm:text-sm font-medium">{t?.label ?? ind.indicator_type}</span>
        <span className="text-[11px] sm:text-xs text-[var(--muted)] ml-1 sm:ml-1.5">{ind.indicator_type}</span>
        <span className="block text-[10px] text-[var(--muted)] tabular-nums">{ind.date}</span>
      </div>
```

- [ ] **Step 8: props 정합 및 빌드**

`MarketClient` 의 `Props` 에서 `historyByType` 을 제거하고 `statsByKey` 를 받도록 고칩니다. `calculateRiskIndex` 의 두 번째 인자는 당분간 생략합니다 — 상대 분위수는 단계 2 에서 `pct_rank_252d` 로 대체합니다.

```tsx
interface Props {
  indicators: IndicatorRow[];
  statsByKey: Record<string, {
    high_52w: number | null;
    low_52w: number | null;
    ma_200d: number | null;
    pct_rank_252d: number | null;
    sample_days: number;
  }>;
  scoreHistory: Pick<MarketScoreHistory, "date" | "total_score" | "event_risk_score" | "combined_score" | "risk_index">[];
  events: MarketEvent[];
}
```

`IndicatorRow` 에 `source` 와 `collected_at` 을 추가합니다.

Run: `cd web && npm run build`
Expected: 성공

- [ ] **Step 9: 전체 테스트**

Run: `cd web && npm run test && npm run lint`
Expected: 전부 PASS

- [ ] **Step 10: 커밋**

```bash
git add web/src/lib/market-thresholds.ts web/src/lib/__tests__/market-thresholds.test.ts web/src/components/market/market-client.tsx
git commit -m "fix: 지표 결손을 안전 신호로 표시하던 문제 수정

지표가 하나도 없을 때 화면이 '안전 0.0 / 100 · 적극 매수 가능'을 초록으로
띄워, 파이프라인이 죽은 상태와 가장 안전한 시장이 구분되지 않았다.
커버리지 70% 미만이면 점수 대신 산출 불가와 결측 지표를 표시한다.
임계값 테이블은 카탈로그에서 파생해 단위 불일치를 없앤다."
```

---

## Task 11: 배치 오류 집계와 알림

**Files:**
- Create: `.github/scripts/shared/notify.ts`
- Modify: `.github/scripts/batch/step7-events.ts`
- Modify: `.github/scripts/batch/index.ts`

**Interfaces:**
- Consumes: `runStep6MarketData` (Task 6), `runStep12InvestorDaily` (Task 7), `runStep13IndicatorStats` (Task 8)
- Produces: `notifyBatchFailure(mode: string, errors: string[]): Promise<void>`

- [ ] **Step 1: 알림 모듈 작성**

`.github/scripts/shared/notify.ts`:

```ts
/**
 * 배치 실패 알림.
 *
 * 저장소에 알림 발신 코드가 전혀 없어, 파이프라인이 죽어도 GitHub Actions 는
 * 초록이고 batch_runs 는 done 이었습니다. keepalive.yml 주석이 알림 부재로
 * 배치 중단을 나흘 뒤에 발견한 이력을 기록해 두고 있습니다.
 *
 * TELEGRAM_BOT_TOKEN 과 TELEGRAM_CHAT_ID 가 없으면 조용히 건너뜁니다.
 * 알림 실패가 배치를 중단시켜서는 안 됩니다.
 */

export async function notifyBatchFailure(mode: string, errors: string[]): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log('[notify] TELEGRAM 설정 없음, 알림 생략');
    return;
  }

  const head = `배치 실패 (mode=${mode}) — 오류 ${errors.length}건`;
  const body = errors.slice(0, 15).join('\n');
  const more = errors.length > 15 ? `\n… 외 ${errors.length - 15}건` : '';
  const text = `${head}\n\n${body}${more}`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error(`[notify] 텔레그램 발신 실패 HTTP ${res.status}`);
    }
  } catch (err) {
    console.error(`[notify] 텔레그램 발신 오류: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

- [ ] **Step 2: step7 오류 반환**

`.github/scripts/batch/step7-events.ts` 를 교체합니다.

```ts
// .github/scripts/batch/step7-events.ts
//
// 시장 이벤트 적재 + 시황 점수 계산을 Vercel API 에 위임한다.
//
// 이전 구현은 res.status 를 검사하지 않고 본문 240자만 로그로 남겨,
// 401(CRON_SECRET 불일치)이나 500(타임아웃)으로 매일 실패해도 배치가
// 성공으로 마감됐습니다. market_score_history 와 market_events 는 이 경로가
// 유일한 writer 이므로 대체 복구 수단도 없습니다.
import { log } from '../shared/logger.js';

async function callCron(path: string): Promise<string | null> {
  const vercelUrl = process.env.VERCEL_URL;
  if (!vercelUrl) {
    return `step7 ${path}: VERCEL_URL 미설정으로 호출 생략`;
  }
  const secret = process.env.CRON_SECRET ?? '';
  try {
    const res = await fetch(`https://${vercelUrl}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(60000),
    });
    const body = await res.text();
    log('step7', `${path} → ${res.status} ${body.slice(0, 240)}`);
    if (!res.ok) {
      return `step7 ${path}: HTTP ${res.status} ${body.slice(0, 120)}`;
    }
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('step7', `${path} 호출 오류: ${msg}`);
    return `step7 ${path}: ${msg}`;
  }
}

export async function runStep7Events(): Promise<{ errors: string[] }> {
  log('step7', '이벤트 캘린더 + 시황 점수 갱신 시작');
  const errors: string[] = [];
  for (const path of ['/api/v1/cron/market-events', '/api/v1/cron/market-score']) {
    const err = await callCron(path);
    if (err) errors.push(err);
  }
  log('step7', `완료 (오류 ${errors.length}건)`);
  return { errors };
}
```

- [ ] **Step 3: index.ts 오류 집계**

`.github/scripts/batch/index.ts` 를 수정합니다. import 를 추가하고, step6·step7 호출을 반환값 기반으로 바꾸며, 마감 처리에 오류 검사를 넣습니다.

import 블록에 추가:

```ts
import { runStep12InvestorDaily } from './step12-investor-daily.js';
import { runStep13IndicatorStats } from './step13-indicator-stats.js';
import { notifyBatchFailure } from '../shared/notify.js';
```

`BatchMode` 를 확장합니다.

```ts
type BatchMode = 'full' | 'repair' | 'prices-only' | 'market-open' | 'market-intraday' | 'market-close';
```

full 모드의 step6·step7 호출을 교체합니다.

```ts
      const s6 = await runStep6MarketData();
      summary.errors.push(...s6.errors);

      const s12 = await runStep12InvestorDaily();
      summary.errors.push(...s12.errors);

      const s7 = await runStep7Events();
      summary.errors.push(...s7.errors);

      const s13 = await runStep13IndicatorStats({ date: targetDate });
      summary.errors.push(...s13.errors);
```

시황 전용 모드 분기를 `prices-only` 분기 앞에 추가합니다.

```ts
    if (mode === 'market-open' || mode === 'market-intraday' || mode === 'market-close') {
      log('main', `시황 갱신 모드 ${mode}`);

      const s6 = await runStep6MarketData();
      summary.collected = s6.collected;
      summary.errors.push(...s6.errors);

      const s12 = await runStep12InvestorDaily();
      summary.errors.push(...s12.errors);

      // 판정 갱신은 open 과 close 에서만. 장중 15분마다 이벤트 API 를 두드릴 이유가 없다.
      if (mode !== 'market-intraday') {
        const s7 = await runStep7Events();
        summary.errors.push(...s7.errors);
      }

      // 롤링 통계는 마감 후 한 번만 재계산한다.
      if (mode === 'market-close') {
        const s13 = await runStep13IndicatorStats({ date: targetDate });
        summary.errors.push(...s13.errors);
      }

    } else if (mode === 'prices-only') {
```

마감 처리를 교체합니다.

```ts
    const status = summary.errors.length > 0 ? 'failed' : 'done';
    await finishBatchRun(runId, status, summary);

    if (status === 'failed') {
      log('main', `오류 ${summary.errors.length}건으로 실패 처리`);
      await notifyBatchFailure(mode, summary.errors);
      process.exitCode = 1;
    }
```

- [ ] **Step 4: 타입 검사**

Run: `cd .github/scripts && npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 5: 실패 경로 검증**

일부러 실패시켜 종료 코드를 확인합니다.

```bash
cd .github/scripts && SUPABASE_URL="$SUPABASE_URL" SUPABASE_SERVICE_KEY="$SUPABASE_SERVICE_KEY" \
  BATCH_MODE=market-open VERCEL_URL="" npx tsx batch/index.ts; echo "exit=$?"
```
Expected: `VERCEL_URL 미설정` 오류가 summary 에 담기고 `exit=1`

- [ ] **Step 6: 커밋**

```bash
git add .github/scripts/shared/notify.ts .github/scripts/batch/step7-events.ts .github/scripts/batch/index.ts
git commit -m "fix: 배치 실패가 성공으로 기록되던 문제 수정

step6·step7 이 예외를 삼키고 반환형이 void 라 오류를 돌려줄 통로가 없었고,
index.ts 는 summary.errors 를 보지 않고 무조건 done 으로 마감했다. 이제
오류가 있으면 failed 로 기록하고 종료 코드 1 과 텔레그램 알림을 낸다."
```

---

## Task 12: 배치 3분할

**Files:**
- Modify: `.github/workflows/daily-batch.yml`

**Interfaces:**
- Consumes: `BatchMode` 확장 (Task 11)
- Produces: 없음

- [ ] **Step 1: 워크플로우 수정**

`.github/workflows/daily-batch.yml` 의 `schedule` 과 `Detect mode` 스텝을 교체합니다.

```yaml
on:
  schedule:
    - cron: '30 22 * * 0-4'     # 시황 확정 07:30 KST (UTC 일~목 22:30)
    - cron: '*/15 23 * * 0-4'   # 장중 현재가 08:00~08:45 KST
    - cron: '*/15 0-11 * * 1-5' # 장중 현재가 09:00~20:45 KST
    - cron: '5 1-6 * * 1-5'     # 장중 시황 보정 10:05~15:05 KST (매시)
    - cron: '10 7 * * 1-5'      # 메인 배치 16:10 KST
    - cron: '10 11 * * 1-5'     # 시황 마감 확정 20:10 KST
    - cron: '0 22 * * *'        # 보정 배치 07:00 KST
```

`Detect mode` 스텝의 분기를 교체합니다.

```yaml
      - name: Detect mode
        id: detect-mode
        run: |
          SCHEDULE="${{ github.event.schedule }}"
          INPUT_MODE="${{ inputs.mode }}"

          if [ -n "$INPUT_MODE" ]; then
            MODE="$INPUT_MODE"
          elif [ "$SCHEDULE" = "30 22 * * 0-4" ]; then
            MODE="market-open"
          elif [ "$SCHEDULE" = "5 1-6 * * 1-5" ]; then
            MODE="market-intraday"
          elif [ "$SCHEDULE" = "10 11 * * 1-5" ]; then
            MODE="market-close"
          elif [ "$SCHEDULE" = "10 7 * * 1-5" ]; then
            MODE="full"
          elif [ "$SCHEDULE" = "0 22 * * *" ]; then
            MODE="repair"
          else
            MODE="prices-only"
          fi

          echo "mode=$MODE" >> $GITHUB_OUTPUT
          echo "Detected mode: $MODE (schedule: $SCHEDULE)"
```

`workflow_dispatch` 의 mode 설명을 갱신합니다.

```yaml
      mode:
        description: 'full | repair | prices-only | market-open | market-intraday | market-close'
        required: false
        default: 'full'
```

`Run batch` 스텝의 `env` 에 알림 시크릿을 추가합니다.

```yaml
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
```

- [ ] **Step 2: YAML 문법 검증**

Run: `cd /Users/thlee/GoogleDrive/DashboardStock && python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/daily-batch.yml')); print('OK')"`
Expected: `OK`

- [ ] **Step 3: 수동 실행 검증**

Run: `gh workflow run daily-batch.yml -f mode=market-open`

이어서 실행 결과를 확인합니다.

Run: `gh run list --workflow=daily-batch.yml --limit 1`
Expected: 상태가 `completed success`. 실패하면 `gh run view --log-failed` 로 원인을 확인합니다.

- [ ] **Step 4: 커밋**

```bash
git add .github/workflows/daily-batch.yml
git commit -m "feat: 시황 배치를 개장 전·장중·마감 후로 3분할

기존에는 평일 16:10 배치 한 번이 유일한 시황 갱신 경로여서, 시간외 마감
20:00 전이라 당일 종가도 아니고 아침에는 전날 오후 값을 보여줬다.
07:30 에 간밤 미국장을 반영해 당일 판단을 확정하고, 장중 매시 보정하며,
20:10 에 종가를 확정한다."
```

---

## Task 13: 죽은 코드와 무인증 엔드포인트 정리

조사에서 참조처가 0건인 모듈과 라우트가 여럿 확인되었습니다. 이것들이 남아 있으면 다음 작업자가 시황 데이터의 공급원을 잘못 짚습니다. 실제로 문서가 존재하지 않는 크론 엔드포인트를 섹터 데이터 공급원으로 안내하고 있었습니다. 인증 없이 service role 쓰기를 허용하는 엔드포인트 두 개도 함께 막습니다.

**Files:**

| 처리 | 경로 |
|---|---|
| 삭제 | `web/src/hooks/use-market-indicators.ts` |
| 삭제 | `web/src/components/market/event-summary-card.tsx` |
| 삭제 | `web/scripts/fetch-market-indicators.ts` |
| 삭제 | `web/migrations/add_risk_index.sql` |
| 삭제 | `web/src/app/api/v1/cron/sector-stats/` |
| 수정 | `web/src/app/api/v1/market-events/route.ts` |
| 수정 | `web/src/app/api/v1/market-indicators/weights/route.ts` |
| 수정 | `web/src/types/market.ts` |

**Interfaces:**
- Consumes: 없음
- Produces: 없음

- [ ] **Step 1: 참조 0건 재확인**

Run:
```bash
cd /Users/thlee/GoogleDrive/DashboardStock/web
for f in use-market-indicators event-summary-card fetch-market-indicators; do
  echo "--- $f ---"
  grep -rn "$f" src ../.github/scripts --include="*.ts" --include="*.tsx" | grep -v "$f.ts" | grep -v node_modules
done
```
Expected: 각 항목의 결과가 비어 있음. 참조가 나오면 삭제하지 말고 그 사실을 기록한 뒤 다음 단계로 넘어갑니다.

- [ ] **Step 2: 삭제**

```bash
cd /Users/thlee/GoogleDrive/DashboardStock
git rm web/src/hooks/use-market-indicators.ts
git rm web/src/components/market/event-summary-card.tsx
git rm web/scripts/fetch-market-indicators.ts
git rm web/migrations/add_risk_index.sql
rmdir web/src/app/api/v1/cron/sector-stats 2>/dev/null || true
```

- [ ] **Step 3: 무인증 쓰기 차단**

`web/src/app/api/v1/market-events/route.ts` 의 `POST` 핸들러 첫 줄에 인증을 넣습니다.

```ts
import { verifyCollectorKey } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const auth = verifyCollectorKey(request);
  if (!auth.ok) {
    return Response.json({ success: false, error: '인증 실패' }, { status: 401 });
  }
  // 이하 기존 로직
```

`verifyCollectorKey` 의 실제 시그니처를 먼저 확인합니다.

Run: `grep -n "export function verifyCollectorKey\|export const verifyCollectorKey" web/src/lib/*.ts`

반환 형태가 다르면 그 형태에 맞춰 조건문을 조정합니다.

`web/src/app/api/v1/market-indicators/weights/route.ts` 의 `PUT` 핸들러에도 같은 가드를 넣습니다. 가중치는 카탈로그로 일원화되어 이 라우트가 더는 정본이 아니므로, 응답에 안내를 남깁니다.

```ts
export async function PUT() {
  return Response.json(
    { success: false, error: '가중치는 shared/market/catalog.ts 에서 관리합니다' },
    { status: 410 },
  );
}
```

- [ ] **Step 4: types/market.ts 정리**

`YAHOO_TICKERS` 에서 죽은 항목을 제거하고 카탈로그 참조를 안내하는 주석을 답니다.

```ts
/**
 * @deprecated 지표 정의는 shared/market/catalog.ts 가 단일 출처입니다.
 * 이 표는 realtime 라우트가 카탈로그로 옮겨 갈 때까지만 남깁니다.
 * KR_3Y(122630.KS = KODEX 레버리지)와 VKOSPI(^VKOSPI 404)는 제거했습니다.
 */
export const YAHOO_TICKERS: Record<string, string> = {
  VIX: '^VIX',
  USD_KRW: 'KRW=X',
  US_10Y: '^TNX',
  WTI: 'CL=F',
  KOSPI: '^KS11',
  KOSDAQ: '^KQ11',
  GOLD: 'GC=F',
  DXY: 'DX-Y.NYB',
  EWY: 'EWY',
};
```

`IndicatorType` 유니온에서 `KORU`, `FEAR_GREED`, `VKOSPI`, `CNN_FEAR_GREED`, `KR_3Y` 를 제거하고 `KR_VOL_20D`, `FOREIGN_NET`, `INSTITUTION_NET` 을 추가합니다.

`ABSOLUTE_RANGES` 에서 `KR_3Y`, `KORU`, `FEAR_GREED` 항목을 제거합니다.

- [ ] **Step 5: realtime 라우트 정리**

`web/src/app/api/v1/market-indicators/realtime/route.ts` 에서 CNN 공포탐욕 호출 블록과 `CNN_FEAR_GREED` 추가 로직을 제거합니다. CNN 엔드포인트가 HTTP 418 로 차단되어 항상 실패하며, 실패가 조용히 넘어가 진단을 방해합니다.

- [ ] **Step 6: 빌드와 테스트**

Run: `cd web && npm run build && npm run test && npm run lint`
Expected: 전부 성공

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "chore: 시황 죽은 코드와 무인증 쓰기 엔드포인트 정리

참조 0건인 훅·컴포넌트·스크립트·중복 마이그레이션과 route.ts 없는 빈
디렉터리를 제거한다. 인증 없이 service role 쓰기를 허용하던 market-events
POST 에 가드를 넣고, 카탈로그로 일원화된 weights PUT 은 410 을 반환한다.
차단된 CNN 공포탐욕 호출도 제거한다."
```

---

## Task 14: 통합 검증

**Files:**
- 없음 (검증 전용)

**Interfaces:**
- Consumes: Task 1~13 전부
- Produces: 없음

- [ ] **Step 1: 전체 테스트**

Run: `cd web && npm run test`
Expected: 신규 38건 포함 전부 PASS

- [ ] **Step 2: 빌드와 린트**

Run: `cd web && npm run build && npm run lint`
Expected: 성공, 경고 0건

- [ ] **Step 3: 배치 타입 검사**

Run: `cd .github/scripts && npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 4: 시황 배치 실행**

Run: `gh workflow run daily-batch.yml -f mode=market-close`

- [ ] **Step 5: DB 상태 확인**

```sql
-- 지표: 등락률이 채워졌는가
SELECT indicator_type, date, value, change_pct, source
FROM market_indicators
WHERE date >= CURRENT_DATE - 3
ORDER BY indicator_type, date DESC;

-- 통계: 계산 창이 충분한가
SELECT indicator_key, sample_days FROM market_indicator_stats
WHERE as_of = CURRENT_DATE ORDER BY sample_days;

-- 수급: 일별 이력이 쌓이는가
SELECT * FROM market_investor_daily ORDER BY date DESC LIMIT 5;

-- 배치: 실패가 실패로 기록되는가
SELECT mode, status, summary FROM batch_runs ORDER BY started_at DESC LIMIT 5;
```

Expected: `change_pct` 가 NULL 이 아닌 행 존재, `KR_3Y`·`FEAR_GREED`·`KORU` 부재, 수급 5일치 존재

- [ ] **Step 6: 화면 확인**

Run: `cd web && npm run dev`

브라우저에서 `http://localhost:3000/market` 을 엽니다.

확인 항목을 하나씩 봅니다. 지표 행마다 등락률이 `+0.00%` 가 아닌 실제 값인가. HY 스프레드가 `3 bps` 가 아니라 `2.71%` 로 표시되는가. KR_3Y 행이 사라졌는가. 새로고침해도 값이 튀지 않는가. 각 지표 행에 기준일이 붙는가.

- [ ] **Step 7: 결손 표시 확인**

DB 에서 오늘 지표를 임시로 감춰 산출 불가가 뜨는지 봅니다.

```sql
BEGIN;
UPDATE market_indicators SET date = date - 400 WHERE date >= CURRENT_DATE - 30;
-- 화면 새로고침 → '산출 불가' 배너 확인
ROLLBACK;
```

Expected: 초록 「안전 0.0 / 100」 대신 회색 「산출 불가」와 결측 지표 목록

- [ ] **Step 8: 완료 판정 기록**

설계 문서의 단계 1 완료 판정을 검토합니다. 모든 지표가 값·등락률·기준 시각을 갖는가. 배치 실패가 GitHub Actions 에서 빨갛게 드러나는가. 지표 결손 시 화면이 초록 「안전」을 표시하지 않는가.

미달 항목이 있으면 해당 태스크로 돌아갑니다.

- [ ] **Step 9: 커밋**

```bash
git commit --allow-empty -m "chore: 시황 파이프라인 단계1 통합 검증 완료

지표 등락률 복원, 단위 정합, 결손 표시, 배치 실패 감지를 확인했다."
```

---

## Self-Review

**스펙 커버리지**

| 스펙 항목 | 태스크 |
|---|---|
| 4.1 지표 카탈로그 단일 출처 | Task 1 |
| 4.2 값의 단일 출처 (부분) | Task 6 — 완전한 write-through 는 단계 2 |
| 4.3 점수 계약 (부분) | Task 10 — 커버리지까지. `action` 과 `contributions` 는 단계 2 |
| 4.4 롤링 통계 사전 계산 | Task 8, Task 9 |
| 5.1 글로벌 층 소스 | Task 1, Task 2, Task 3 |
| 5.2 국내 층 소스 | Task 1, Task 3, Task 7 |
| 5.3 제거 대상 | Task 5, Task 13 |
| 5.4 이벤트 (FOMC 소스 교체) | **단계 1 범위 밖** — 단계 2 로 이월 |
| 6 화면 설계 | **단계 3** — Task 10 이 결손 표시만 선반영 |
| 7 배치 재구성 | Task 12 |
| 9 실패 감지 | Task 11 |
| 10 마이그레이션 | Task 5 |
| 11 테스트 전략 | Task 1, 2, 3, 4, 10 |
| 12 정리 대상 | Task 13 |

**의도적 이월**

FOMC 소스 교체(스펙 5.4)는 이벤트 계열 작업이라 지표 파이프라인과 독립적이며, 단계 2 에서 백테스트 이벤트 정답지와 함께 다루는 편이 낫습니다. 판정 객체의 `action`·`contributions` 필드는 백테스트로 임계값을 확정한 뒤에야 의미가 있으므로 단계 2 로 미룹니다.

**타입 일관성 확인**

`IndicatorSpec` (Task 1) → `activeIndicators()` 반환 (Task 1) → `step6` 소비 (Task 6) → `RISK_THRESHOLDS` 파생 (Task 10) 경로에서 필드명이 일치합니다. `runStep6MarketData` 는 Task 6 에서 `{ errors, collected }` 를 반환하고 Task 11 의 `index.ts` 가 같은 형태로 받습니다. `RiskIndexResult` 에 추가한 `coverage`·`missing` 은 Task 10 의 테스트와 화면 호출부가 같은 이름을 씁니다.

**미해결 의존**

Task 5 의 마이그레이션 적용과 Task 6·7·8 의 실행 검증은 Supabase 접근이 필요합니다. `.env.local` 읽기가 거부된 상태이므로, 실행 검증 단계는 사용자가 환경변수를 제공하거나 직접 실행해야 합니다. 접근이 불가하면 해당 Step 을 건너뛰고 코드 작성과 타입 검사까지만 진행한 뒤, 실제 실행은 GitHub Actions 의 `workflow_dispatch` 로 확인합니다.
