/**
 * 네이버 증권 전종목 시세 API
 *
 * KIS API 대비 장점:
 * - 전종목 시세를 병렬 페이지 요청으로 2~5초 내 조회
 * - 인증 불필요, Rate limit 거의 없음
 * - 3000종목 × 1.1초 배치 → 2~5초로 단축
 *
 * 제공 데이터: 현재가, 전일대비, 등락률, 거래량, 시가총액
 * (PER/PBR/EPS/BPS/배당수익률/52주 최고최저는 개별 종목 API에서만 제공)
 */

const NAVER_STOCK_API = 'https://m.stock.naver.com/api';
const PAGE_SIZE = 100;

interface NaverStockItem {
  itemCode: string;
  stockName: string;
  closePrice: string;
  compareToPreviousClosePrice: string;
  compareToPreviousPrice: {
    code: string; // "2"=상승, "5"=하락, "3"=보합
    name: string;
  };
  fluctuationsRatio: string;
  accumulatedTradingVolume: string;
  marketValue: string;
  stockExchangeType: {
    nameEng: string; // "KOSPI" | "KOSDAQ"
  };
}

interface NaverListResponse {
  stocks: NaverStockItem[];
  totalCount: number;
}

export interface StockPriceData {
  symbol: string;
  name: string;
  market: string;
  current_price: number;
  price_change: number;
  price_change_pct: number;
  volume: number;
  market_cap: number;
}

function parseNumber(str: string): number {
  if (!str || str === '-') return 0;
  return parseInt(str.replace(/,/g, ''), 10) || 0;
}

function parseMarketCap(str: string): number {
  if (!str) return 0;
  // "1,124조 7,312억" → 억 단위로 변환
  // 또는 "11,247,312" (순수 숫자) → 그대로 사용
  return parseNumber(str);
}

async function fetchPage(market: 'KOSPI' | 'KOSDAQ', page: number): Promise<NaverStockItem[]> {
  try {
    const res = await fetch(
      `${NAVER_STOCK_API}/stocks/marketValue/${market}?page=${page}&pageSize=${PAGE_SIZE}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!res.ok) return [];
    const data: NaverListResponse = await res.json();
    return data.stocks || [];
  } catch {
    return [];
  }
}

/**
 * 네이버 증권 전종목 시세 조회 (KOSPI + KOSDAQ)
 * 병렬 페이지 요청으로 2~5초 내 전종목 데이터 반환
 */
export async function fetchAllStockPrices(): Promise<Map<string, StockPriceData>> {
  const result = new Map<string, StockPriceData>();

  // 1. 먼저 totalCount 확인
  const [kospiFirst, kosdaqFirst] = await Promise.all([
    fetch(`${NAVER_STOCK_API}/stocks/marketValue/KOSPI?page=1&pageSize=${PAGE_SIZE}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    }).then(r => r.json() as Promise<NaverListResponse>),
    fetch(`${NAVER_STOCK_API}/stocks/marketValue/KOSDAQ?page=1&pageSize=${PAGE_SIZE}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    }).then(r => r.json() as Promise<NaverListResponse>),
  ]);

  // 첫 페이지 데이터 처리
  const processItems = (items: NaverStockItem[], market: string) => {
    for (const item of items) {
      if (!item.itemCode || item.itemCode.length !== 6) continue;
      const price = parseNumber(item.closePrice);
      if (price <= 0) continue;

      // API가 이미 부호 포함 값을 반환함 (하락 시 음수)
      // compareToPreviousClosePrice: "-4,900", fluctuationsRatio: "-2.61"
      const priceChange = parseNumber(item.compareToPreviousClosePrice);

      result.set(item.itemCode, {
        symbol: item.itemCode,
        name: item.stockName,
        market,
        current_price: price,
        price_change: priceChange,
        price_change_pct: parseFloat(item.fluctuationsRatio) || 0,
        volume: parseNumber(item.accumulatedTradingVolume),
        market_cap: parseMarketCap(item.marketValue),
      });
    }
  };

  processItems(kospiFirst.stocks || [], 'KOSPI');
  processItems(kosdaqFirst.stocks || [], 'KOSDAQ');

  // 2. 나머지 페이지 병렬 요청
  const kospiPages = Math.ceil((kospiFirst.totalCount || 0) / PAGE_SIZE);
  const kosdaqPages = Math.ceil((kosdaqFirst.totalCount || 0) / PAGE_SIZE);

  const pagePromises: Promise<{ items: NaverStockItem[]; market: string }>[] = [];

  for (let p = 2; p <= kospiPages; p++) {
    pagePromises.push(
      fetchPage('KOSPI', p).then(items => ({ items, market: 'KOSPI' }))
    );
  }
  for (let p = 2; p <= kosdaqPages; p++) {
    pagePromises.push(
      fetchPage('KOSDAQ', p).then(items => ({ items, market: 'KOSDAQ' }))
    );
  }

  const pageResults = await Promise.all(pagePromises);
  for (const { items, market } of pageResults) {
    processItems(items, market);
  }

  return result;
}

export interface StockInvestorData {
  foreign_net: number;     // 외국인 순매수 수량 (가장 최근 1일)
  institution_net: number; // 기관 순매수 수량 (가장 최근 1일)
  individual_net: number;  // 개인 순매수 수량 (가장 최근 1일)
  // 5일 누적 데이터
  foreign_net_5d: number;      // 외국인 5일 누적 순매수
  institution_net_5d: number;  // 기관 5일 누적 순매수
  foreign_streak: number;      // 외국인 연속 순매수 일수 (음수면 연속 순매도)
  institution_streak: number;  // 기관 연속 순매수 일수
}

/**
 * 종목별 최근 5영업일 투자자별 매매동향
 * integration API의 dealTrendInfos (최근 5일) 사용
 */
export async function fetchStockInvestorData(symbol: string): Promise<StockInvestorData | null> {
  try {
    const res = await fetch(`${NAVER_STOCK_API}/stock/${symbol}/integration`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const trends = data.dealTrendInfos as Array<{
      bizdate: string;
      foreignerPureBuyQuant: string;
      organPureBuyQuant: string;
      individualPureBuyQuant: string;
    }> | undefined;
    if (!trends || trends.length === 0) return null;

    const parseNet = (str: string | undefined): number => {
      if (!str) return 0;
      return parseInt(str.replace(/,/g, ''), 10) || 0;
    };

    // 최근 5일 (또는 가용한 만큼)
    const days = trends.slice(0, 5);
    const latest = days[0];

    // 5일 누적
    let foreign5d = 0, inst5d = 0;
    for (const d of days) {
      foreign5d += parseNet(d.foreignerPureBuyQuant);
      inst5d += parseNet(d.organPureBuyQuant);
    }

    // 연속 매수/매도 일수 계산 (최근일부터)
    const calcStreak = (getter: (d: typeof days[0]) => number): number => {
      if (days.length === 0) return 0;
      const first = getter(days[0]);
      if (first === 0) return 0;
      const isPositive = first > 0;
      let streak = 0;
      for (const d of days) {
        const v = getter(d);
        if ((isPositive && v > 0) || (!isPositive && v < 0)) streak++;
        else break;
      }
      return isPositive ? streak : -streak;
    };

    return {
      foreign_net: parseNet(latest.foreignerPureBuyQuant),
      institution_net: parseNet(latest.organPureBuyQuant),
      individual_net: parseNet(latest.individualPureBuyQuant),
      foreign_net_5d: foreign5d,
      institution_net_5d: inst5d,
      foreign_streak: calcStreak(d => parseNet(d.foreignerPureBuyQuant)),
      institution_streak: calcStreak(d => parseNet(d.organPureBuyQuant)),
    };
  } catch {
    return null;
  }
}

/**
 * 여러 종목 투자자 데이터 배치 조회 (병렬)
 */
export async function fetchBulkInvestorData(
  symbols: string[],
  concurrency = 20
): Promise<Map<string, StockInvestorData>> {
  const result = new Map<string, StockInvestorData>();
  if (symbols.length === 0) return result;

  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency);
    await Promise.allSettled(
      batch.map(async (symbol) => {
        const data = await fetchStockInvestorData(symbol);
        if (data) result.set(symbol, data);
      })
    );
  }

  return result;
}

export interface NaverDailyPrice {
  date: string;  // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * 네이버 fchart API로 일봉 차트 데이터 조회
 * KIS API 없이 전 종목 차트 데이터 제공 가능
 *
 * @param symbol 종목 코드 (6자리)
 * @param days 조회 일수 (기본 90)
 */
export async function fetchNaverDailyPrices(
  symbol: string,
  days = 90
): Promise<NaverDailyPrice[]> {
  try {
    const res = await fetch(
      `https://fchart.stock.naver.com/sise.nhn?symbol=${symbol}&timeframe=day&count=${days}&requestType=0`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!res.ok) return [];
    const xml = await res.text();

    // <item data="20250313|73400|74100|72600|73200|1234567" /> 파싱
    const matches = xml.matchAll(/<item data="([^"]+)"/g);
    const result: NaverDailyPrice[] = [];

    for (const match of matches) {
      const parts = match[1].split('|');
      if (parts.length < 6) continue;
      const [rawDate, open, high, low, close, volume] = parts;
      if (!rawDate || rawDate.length !== 8) continue;
      const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
      const closeVal = parseInt(close, 10);
      if (!closeVal || closeVal <= 0) continue;
      result.push({
        date,
        open: parseInt(open, 10) || closeVal,
        high: parseInt(high, 10) || closeVal,
        low: parseInt(low, 10) || closeVal,
        close: closeVal,
        volume: parseInt(volume, 10) || 0,
      });
    }

    return result;
  } catch {
    return [];
  }
}

// ─── 전종목 통합 벌크 조회 (integration API) ─────────────────

export interface NaverIntegrationData {
  // 시세
  name: string;
  market: string;
  current_price: number;
  price_change: number;
  price_change_pct: number;
  volume: number;
  market_cap: number;
  // 지표
  per: number | null;
  pbr: number | null;
  eps: number | null;
  bps: number | null;
  roe: number | null;           // 최신 실적 기준
  roe_estimated: number | null;  // 컨센서스 예상
  high_52w: number | null;
  low_52w: number | null;
  dividend_yield: number | null;
  // 컨센서스 (forward)
  forward_per: number | null;
  forward_eps: number | null;
  target_price: number | null;
  invest_opinion: number | null;
  // 수급 (최근 1일)
  foreign_net: number | null;
  institution_net: number | null;
  individual_net: number | null;
  // 수급 (5일 누적)
  foreign_net_5d: number | null;
  institution_net_5d: number | null;
  // 연속일수
  foreign_streak: number | null;
  institution_streak: number | null;
}

function parseIndicatorNum(str: string | undefined): number | null {
  if (!str || str === '-' || str === 'N/A') return null;
  const v = parseFloat(str.replace(/[,배원%조억백만주]/g, ''));
  return Number.isNaN(v) ? null : v;
}

function parseNetInt(str: string | undefined): number {
  if (!str) return 0;
  return parseInt(str.replace(/,/g, ''), 10) || 0;
}

function calcStreak(
  days: Array<{ foreignerPureBuyQuant: string; organPureBuyQuant: string }>,
  getter: (d: typeof days[0]) => number,
): number {
  if (days.length === 0) return 0;
  const first = getter(days[0]);
  if (first === 0) return 0;
  const isPositive = first > 0;
  let streak = 0;
  for (const d of days) {
    const v = getter(d);
    if ((isPositive && v > 0) || (!isPositive && v < 0)) streak++;
    else break;
  }
  return isPositive ? streak : -streak;
}

interface FinanceResult {
  roe: number | null;
  roe_estimated: number | null;
}

async function fetchFinanceData(symbol: string): Promise<FinanceResult> {
  const empty: FinanceResult = { roe: null, roe_estimated: null };
  try {
    const res = await fetch(`${NAVER_STOCK_API}/stock/${symbol}/finance/annual`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return empty;
    const data = await res.json();
    const fi = data?.financeInfo;
    if (!fi) return empty;

    // 연도별 실적/예상 구분 (isConsensus: "N"=실적, "Y"=예상)
    const headers = (fi.trTitleList ?? []) as Array<{ key: string; isConsensus: string }>;
    const actualYears = headers.filter((h) => h.isConsensus === 'N').map((h) => h.key).sort().reverse();
    const estimatedYears = headers.filter((h) => h.isConsensus === 'Y').map((h) => h.key).sort().reverse();

    const rows = (fi.rowList ?? []) as Array<{ title: string; columns: Record<string, { value: string }> }>;
    const roeRow = rows.find((r) => r.title === 'ROE');
    if (!roeRow?.columns) return empty;

    const pickFirst = (years: string[]): number | null => {
      for (const y of years) {
        const v = parseFloat(roeRow.columns[y]?.value);
        if (!Number.isNaN(v)) return v;
      }
      return null;
    };

    return {
      roe: pickFirst(actualYears),
      roe_estimated: pickFirst(estimatedYears),
    };
  } catch {
    return empty;
  }
}

async function fetchIntegration(symbol: string): Promise<{
  per: number | null; pbr: number | null; eps: number | null; bps: number | null;
  roe: number | null; high_52w: number | null; low_52w: number | null;
  dividend_yield: number | null; forward_per: number | null; forward_eps: number | null;
  target_price: number | null; invest_opinion: number | null;
  foreign_net: number | null; institution_net: number | null; individual_net: number | null;
  foreign_net_5d: number | null; institution_net_5d: number | null;
  foreign_streak: number | null; institution_streak: number | null;
} | null> {
  try {
    const res = await fetch(`${NAVER_STOCK_API}/stock/${symbol}/integration`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();

    // totalInfos → 지표
    const infos = (data.totalInfos ?? []) as Array<{ code: string; value: string }>;
    const getVal = (code: string) => {
      const info = infos.find((i) => i.code === code);
      return parseIndicatorNum(info?.value);
    };

    // consensusInfo → 컨센서스
    const consensus = data.consensusInfo as { priceTargetMean?: string; recommMean?: string } | undefined;
    const targetPrice = consensus?.priceTargetMean
      ? parseInt(consensus.priceTargetMean.replace(/,/g, ''), 10) || null
      : null;
    const investOpinion = consensus?.recommMean
      ? parseFloat(consensus.recommMean) || null
      : null;

    // dealTrendInfos → 수급
    const trends = (data.dealTrendInfos ?? []) as Array<{
      foreignerPureBuyQuant: string; organPureBuyQuant: string; individualPureBuyQuant: string;
    }>;
    const days = trends.slice(0, 5);
    const latest = days[0];

    let foreign5d = 0, inst5d = 0;
    for (const d of days) {
      foreign5d += parseNetInt(d.foreignerPureBuyQuant);
      inst5d += parseNetInt(d.organPureBuyQuant);
    }

    return {
      per: getVal('per'), pbr: getVal('pbr'), eps: getVal('eps'), bps: getVal('bps'),
      roe: null, // integration API 미제공 — 별도 API 필요
      high_52w: getVal('highPriceOf52Weeks'), low_52w: getVal('lowPriceOf52Weeks'),
      dividend_yield: getVal('dividendYieldRatio'),
      forward_per: getVal('cnsPer'), forward_eps: getVal('cnsEps'),
      target_price: targetPrice, invest_opinion: investOpinion,
      foreign_net: latest ? parseNetInt(latest.foreignerPureBuyQuant) : null,
      institution_net: latest ? parseNetInt(latest.organPureBuyQuant) : null,
      individual_net: latest ? parseNetInt(latest.individualPureBuyQuant) : null,
      foreign_net_5d: days.length > 0 ? foreign5d : null,
      institution_net_5d: days.length > 0 ? inst5d : null,
      foreign_streak: days.length > 0 ? calcStreak(days, (d) => parseNetInt(d.foreignerPureBuyQuant)) : null,
      institution_streak: days.length > 0 ? calcStreak(days, (d) => parseNetInt(d.organPureBuyQuant)) : null,
    };
  } catch {
    return null;
  }
}

/**
 * 네이버 전종목 통합 벌크 조회
 *
 * 1단계: 페이지 리스트 API로 전종목 시세 (현재가/거래량/시총)
 * 2단계: integration API로 전종목 지표 + 수급 + 컨센서스 (100 병렬)
 *
 * ~4,200종목 기준 약 10~15초 소요
 */
export async function fetchNaverBulkIntegration(concurrency = 100): Promise<Map<string, NaverIntegrationData>> {
  const startTime = Date.now();
  const lap = (label: string) => console.log(`[naver-bulk] ${label} (${((Date.now() - startTime) / 1000).toFixed(1)}초)`);

  // 1단계: 전종목 시세 조회 (기존 fetchAllStockPrices 로직 재사용)
  const priceMap = await fetchAllStockPrices();
  lap(`시세 ${priceMap.size}종목 조회`);

  // 2단계: 전종목 integration + ROE 병렬 호출
  const symbols = [...priceMap.keys()];
  const result = new Map<string, NaverIntegrationData>();
  let failCount = 0;

  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async (symbol) => {
        const [integration, finance] = await Promise.all([
          fetchIntegration(symbol),
          fetchFinanceData(symbol),
        ]);
        return { symbol, integration, finance };
      }),
    );

    for (const r of settled) {
      if (r.status !== 'fulfilled') { failCount++; continue; }
      const { symbol, integration, finance } = r.value;
      const price = priceMap.get(symbol)!;

      result.set(symbol, {
        // 시세
        name: price.name,
        market: price.market,
        current_price: price.current_price,
        price_change: price.price_change,
        price_change_pct: price.price_change_pct,
        volume: price.volume,
        market_cap: price.market_cap,
        // 지표 + 수급 (integration 실패 시 null)
        per: integration?.per ?? null,
        pbr: integration?.pbr ?? null,
        eps: integration?.eps ?? null,
        bps: integration?.bps ?? null,
        roe: finance.roe,
        roe_estimated: finance.roe_estimated,
        high_52w: integration?.high_52w ?? null,
        low_52w: integration?.low_52w ?? null,
        dividend_yield: integration?.dividend_yield ?? null,
        forward_per: integration?.forward_per ?? null,
        forward_eps: integration?.forward_eps ?? null,
        target_price: integration?.target_price ?? null,
        invest_opinion: integration?.invest_opinion ?? null,
        foreign_net: integration?.foreign_net ?? null,
        institution_net: integration?.institution_net ?? null,
        individual_net: integration?.individual_net ?? null,
        foreign_net_5d: integration?.foreign_net_5d ?? null,
        institution_net_5d: integration?.institution_net_5d ?? null,
        foreign_streak: integration?.foreign_streak ?? null,
        institution_streak: integration?.institution_streak ?? null,
      });
    }
  }

  if (failCount > 0) console.warn(`[naver-bulk] integration 실패: ${failCount}종목`);
  lap(`지표+수급 ${result.size}종목 조회 완료`);

  return result;
}

/**
 * 개별 종목 투자지표 조회 (PER, PBR, EPS, BPS, 52주 최고/최저, 배당수익률)
 * 전종목 조회에는 부적합 - 우선순위 종목에만 사용
 */
export async function fetchStockIndicators(symbol: string): Promise<{
  per: number;
  pbr: number;
  eps: number;
  bps: number;
  high_52w: number;
  low_52w: number;
  dividend_yield: number;
} | null> {
  try {
    const res = await fetch(`${NAVER_STOCK_API}/stock/${symbol}/integration`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const infos = data.totalInfos as Array<{ code: string; value: string }>;
    if (!infos) return null;

    const getValue = (code: string): number => {
      const info = infos.find((i: { code: string }) => i.code === code);
      if (!info?.value) return 0;
      // "28.95배" → 28.95, "6,564원" → 6564
      return parseFloat(info.value.replace(/[,배원%조억백만]/g, '')) || 0;
    };

    return {
      per: getValue('per'),
      pbr: getValue('pbr'),
      eps: getValue('eps'),
      bps: getValue('bps'),
      high_52w: getValue('highPriceOf52Weeks'),
      low_52w: getValue('lowPriceOf52Weeks'),
      dividend_yield: getValue('dividendYield'),
    };
  } catch {
    return null;
  }
}
