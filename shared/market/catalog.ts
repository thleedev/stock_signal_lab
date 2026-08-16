/**
 * 시황 지표 카탈로그 — 단일 출처
 *
 * 배치(.github/scripts)와 웹(web/src)이 함께 읽습니다.
 * 양쪽 모듈 해석 규칙이 달라 이 파일은 다른 파일을 import 하지 않습니다.
 *
 * unit 은 "저장 단위"입니다. 수집 시점 변환을 하지 않고 소스가 주는 값을
 * 그대로 저장하며, DB 와 화면 원값 표시는 이 단위를 따릅니다.
 *
 * thresholds.unit 은 "판정 단위"입니다. derive 가 없으면 unit 과 같습니다.
 * derive 가 있으면 판정은 원값이 아니라 파생값으로 하므로 percent 입니다 —
 * web/src/lib/market-thresholds.ts 의 deriveValue() 가 drawdown_52w·ma200_diff
 * 모두 ((value-기준)/기준)*100 으로 항상 percent 를 반환하기 때문입니다.
 * 이 둘을 같은 값으로 오인하면 FRED 가 주는 percent 값에 bps 임계값을
 * 적용하거나, GOLD 처럼 원자산 단위 임계값이 파생값(percent)과 어긋나
 * 지표가 상시 최고 위험 레벨에 고정되는 사고로 이어집니다.
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
  /** 저장 단위. DB 에 들어가는 원값과 화면 원값 표시 단위 */
  unit: Unit;
  /** 값이 클수록 위험이면 1, 작을수록 위험이면 -1 */
  direction: 1 | -1;
  /**
   * [주의, 위험, 극위험] 경계.
   * thresholds.unit 은 "판정 단위"로, derive 가 없으면 unit 과 같다.
   * derive 가 있으면 판정은 파생값(percent)으로 하므로 'percent' 다.
   */
  thresholds: { unit: Unit; levels: [number, number, number] };
  display: { suffix: string; digits: number };
  weight: number;
  /** 원값 대신 파생값으로 판정하는 지표 */
  derive?: 'drawdown_52w' | 'ma200_diff';
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
    // 판정은 ma200_diff 파생값(percent) 기준. 저장은 금 시세(usd) 그대로.
    thresholds: { unit: 'percent', levels: [10, 20, 30] },
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
    // 판정은 drawdown_52w 파생값(percent) 기준. 저장은 종가(usd) 그대로.
    thresholds: { unit: 'percent', levels: [-7, -15, -25] },
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
    // 판정은 drawdown_52w 파생값(percent) 기준. 저장은 지수값(index) 그대로.
    thresholds: { unit: 'percent', levels: [-7, -15, -25] },
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
    // 판정은 drawdown_52w 파생값(percent) 기준. 저장은 지수값(index) 그대로.
    thresholds: { unit: 'percent', levels: [-10, -20, -30] },
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
