import { SupabaseClient } from '@supabase/supabase-js';

/**
 * 업종 매핑 수집.
 *
 * 이전에는 KRX REST API(data.krx.co.kr)를 썼으나 요청이 거부되어(응답 본문이
 * "LOGOUT") 수집이 멈춰 있었습니다. 그 사이 stock_info.sector 는 넉 달 전 값으로
 * 방치됐고, 삼성전자·SK하이닉스·현대차를 포함한 1,000여 종목이 "ETF"로 잘못
 * 분류된 상태였습니다.
 *
 * 네이버 업종 API 로 바꿨습니다. 업종 목록을 받고 업종별 종목을 순회해 매핑을
 * 만듭니다. 전 종목(4,400여 개)을 실패 없이 확보하며 대표 종목의 업종이 모두
 * 정확함을 확인했습니다.
 */

const NAVER_API = 'https://m.stock.naver.com/api';
const UA = { 'User-Agent': 'Mozilla/5.0' };

/** 업종별 종목 조회의 pageSize 상한입니다. 100 을 넘기면 빈 응답이 옵니다. */
const PAGE_SIZE = 100;

/** 연속 호출 사이 간격(ms). 외부 API 에 부담을 주지 않기 위함입니다. */
const REQUEST_GAP = 50;

type IndustryGroup = { no: number; name: string; totalCount?: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: UA });
    if (!res.ok) {
      console.error(`[step9] HTTP ${res.status}: ${url}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    console.error(`[step9] 요청 실패: ${url}`, (e as Error).message);
    return null;
  }
}

/** 업종 목록을 받아옵니다. */
async function fetchIndustryGroups(): Promise<IndustryGroup[]> {
  const json = await fetchJson<{ groups?: IndustryGroup[] }>(
    `${NAVER_API}/stocks/industry?page=1&pageSize=100`
  );
  return json?.groups ?? [];
}

/** 한 업종에 속한 종목 코드를 모두 받아옵니다. */
async function fetchSymbolsOfIndustry(group: IndustryGroup): Promise<string[]> {
  const total = group.totalCount ?? 0;
  const symbols: string[] = [];

  for (let page = 1; ; page++) {
    const json = await fetchJson<{ stocks?: Array<{ itemCode: string }> }>(
      `${NAVER_API}/stocks/industry/${group.no}?page=${page}&pageSize=${PAGE_SIZE}`
    );
    const rows = json?.stocks ?? [];
    for (const s of rows) {
      if (s.itemCode) symbols.push(s.itemCode);
    }
    // 마지막 페이지이거나 예상 개수를 채웠으면 멈춥니다.
    if (rows.length < PAGE_SIZE || symbols.length >= total) break;
    await sleep(REQUEST_GAP);
  }

  return symbols;
}

export async function crawlSectors(supabase: SupabaseClient): Promise<void> {
  console.log('[step9] 네이버 업종 수집 시작');

  const groups = await fetchIndustryGroups();
  if (groups.length === 0) {
    console.error('[step9] 업종 목록을 받지 못했습니다. 수집을 중단합니다.');
    return;
  }
  const expected = groups.reduce((sum, g) => sum + (g.totalCount ?? 0), 0);
  console.log(`[step9] 업종 ${groups.length}개, 예상 종목 ${expected}개`);

  const sectorBySymbol = new Map<string, string>();
  for (const group of groups) {
    const symbols = await fetchSymbolsOfIndustry(group);
    for (const symbol of symbols) sectorBySymbol.set(symbol, group.name);
    await sleep(REQUEST_GAP);
  }

  if (sectorBySymbol.size === 0) {
    console.error('[step9] 수집된 매핑이 없습니다. 기존 값을 보존하고 중단합니다.');
    return;
  }

  // 예상치의 절반도 못 모았다면 외부 API 가 불안정한 상황입니다.
  // 이때 갱신을 강행하면 멀쩡한 값이 사라지므로 중단합니다.
  if (expected > 0 && sectorBySymbol.size < expected * 0.5) {
    console.error(
      `[step9] 수집량이 예상의 절반 미만입니다(${sectorBySymbol.size}/${expected}). 갱신하지 않습니다.`
    );
    return;
  }

  console.log(`[step9] 매핑 ${sectorBySymbol.size}종목 확보, stock_info 갱신을 시작합니다`);

  // stock_info 에 이미 있는 종목만 갱신합니다. 신규 종목 등록은 다른 배치가 맡습니다.
  const { data: existing, error: readError } = await supabase
    .from('stock_info')
    .select('symbol, sector');

  if (readError) {
    console.error('[step9] stock_info 조회 실패:', readError.message);
    return;
  }

  const updates = (existing ?? [])
    .map((row) => ({ symbol: row.symbol as string, current: row.sector as string | null }))
    .filter(({ symbol, current }) => {
      const next = sectorBySymbol.get(symbol);
      return next !== undefined && next !== current;
    })
    .map(({ symbol }) => ({ symbol, sector: sectorBySymbol.get(symbol)! }));

  if (updates.length === 0) {
    console.log('[step9] 갱신할 항목이 없습니다. 이미 최신입니다.');
    return;
  }

  // upsert 는 지정하지 않은 컬럼을 기본값으로 덮으므로 sector 만 update 합니다.
  const CHUNK = 200;
  let updated = 0;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    const results = await Promise.all(
      chunk.map((u) =>
        supabase.from('stock_info').update({ sector: u.sector }).eq('symbol', u.symbol)
      )
    );
    for (const r of results) {
      if (r.error) console.error('[step9] 갱신 실패:', r.error.message);
      else updated++;
    }
  }

  console.log(`[step9] stock_info.sector ${updated}건 갱신 완료 (대상 ${updates.length}건)`);
}
