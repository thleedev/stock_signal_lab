import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';

const NAVER_API = 'https://m.stock.naver.com/api';

interface DayStock {
  foreign_net: number | null;
  institution_net: number | null;
}

interface InvestorRow {
  symbol: string;
  foreign_net_qty: number | null;
  institution_net_qty: number | null;
  foreign_net_5d: number | null;
  institution_net_5d: number | null;
  foreign_streak: number | null;
  institution_streak: number | null;
  investor_updated_at: string;
}

function parseQty(s: unknown): number | null {
  if (s == null || s === '-' || s === '') return null;
  const n = parseFloat(String(s).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

/** 네이버 수급 API를 안전하게 fetch (JSON 파싱 실패 시 null 반환) */
async function safeFetch(url: string): Promise<{ totalCount: number; stocks: Record<string, DayStock> }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { totalCount: 0, stocks: {} };

    const text = await res.text();
    if (!text || text.trim().length < 2) return { totalCount: 0, stocks: {} };

    const json = JSON.parse(text) as { totalCount?: number; stocks?: Record<string, unknown>[] };
    const stocks: Record<string, DayStock> = {};

    for (const item of json.stocks ?? []) {
      const sym = item.itemCode as string;
      if (typeof sym !== 'string' || sym.length !== 6) continue;
      stocks[sym] = {
        foreign_net: parseQty(item.foreignPurchaseQuantity),
        institution_net: parseQty(item.institutionPurchaseQuantity),
      };
    }

    return { totalCount: json.totalCount ?? 0, stocks };
  } catch {
    return { totalCount: 0, stocks: {} };
  }
}

/** 시장 전체 수급 데이터 수집 (전체 페이지 병렬 fetch) */
async function fetchMarketData(
  market: 'KOSPI' | 'KOSDAQ',
  period: 1 | 5,
): Promise<Record<string, DayStock>> {
  const baseUrl = `${NAVER_API}/stocks/invest/${market}?pageSize=100&sosok=&period=${period}`;
  const first = await safeFetch(`${baseUrl}&page=1`);

  if (first.totalCount === 0) return first.stocks;

  const totalPages = Math.ceil(first.totalCount / 100);
  const pagePromises: Promise<{ totalCount: number; stocks: Record<string, DayStock> }>[] = [];
  for (let p = 2; p <= totalPages; p++) {
    pagePromises.push(safeFetch(`${baseUrl}&page=${p}`));
  }

  const pages = await Promise.all(pagePromises);
  const result = { ...first.stocks };
  for (const page of pages) Object.assign(result, page.stocks);
  return result;
}

/**
 * streak 계산:
 * - 기존 streak과 오늘 방향이 같으면 |streak| + 1 방향 유지
 * - 방향이 바뀌면 ±1 로 리셋
 * - 기존 streak 가 0이거나 없으면 오늘 방향으로 ±1
 * - smallint 오버플로 방지: ±120 상한
 */
function nextStreak(prevStreak: number | null, todayNet: number | null): number | null {
  if (todayNet == null) return prevStreak ?? null;
  const todayDir = todayNet >= 0 ? 1 : -1;
  const prev = prevStreak ?? 0;
  const prevDir = prev >= 0 ? 1 : -1;

  if (prev === 0) return todayDir;
  if (todayDir === prevDir) {
    const next = prev + todayDir;
    return Math.max(-120, Math.min(120, next));
  }
  return todayDir;
}

/**
 * Step 2: 네이버 수급 데이터 수집
 * - period=1: 당일 외국인/기관 순매수량 (foreign_net_qty, institution_net_qty)
 * - period=5: 5일 누적 순매수량 (foreign_net_5d, institution_net_5d)
 * - streak: DB 기존값 + 당일 방향 비교로 증분/리셋 계산
 */
export async function runStep2InvestorData(_opts: { date: string }): Promise<{ errors: string[] }> {
  log('step2', '수급 데이터 수집 시작 (당일·5일 누적·연속일수)');
  const errors: string[] = [];

  try {
    // 당일(period=1) + 5일 누적(period=5) 병렬 수집
    const [kospi1, kosdaq1, kospi5, kosdaq5] = await Promise.all([
      fetchMarketData('KOSPI', 1),
      fetchMarketData('KOSDAQ', 1),
      fetchMarketData('KOSPI', 5),
      fetchMarketData('KOSDAQ', 5),
    ]);

    const today = new Map(Object.entries({ ...kospi1, ...kosdaq1 }));
    const fiveDay = new Map(Object.entries({ ...kospi5, ...kosdaq5 }));
    const allSymbols = new Set([...today.keys(), ...fiveDay.keys()]);

    if (allSymbols.size === 0) {
      errors.push('step2: 수급 데이터 수집 결과 없음 (네이버 API 응답 이상)');
      return { errors };
    }

    log('step2', `수집 완료: 당일 ${today.size}종목, 5일 ${fiveDay.size}종목`);

    // 기존 streak 값 조회 (방향 연속성 계산에 필요)
    const symbolList = [...allSymbols];
    const existingStreakMap = new Map<string, { foreign_streak: number | null; institution_streak: number | null }>();

    const PAGE = 1000;
    for (let i = 0; i < symbolList.length; i += PAGE) {
      const chunk = symbolList.slice(i, i + PAGE);
      const { data } = await supabase
        .from('stock_cache')
        .select('symbol, foreign_streak, institution_streak')
        .in('symbol', chunk);
      for (const row of data ?? []) {
        existingStreakMap.set(row.symbol as string, {
          foreign_streak: row.foreign_streak as number | null,
          institution_streak: row.institution_streak as number | null,
        });
      }
    }

    // 종목별 집계
    const now = new Date().toISOString();
    const rows: InvestorRow[] = [];

    for (const symbol of allSymbols) {
      const t = today.get(symbol);
      const f = fiveDay.get(symbol);
      const prev = existingStreakMap.get(symbol);

      const foreign_net_qty = t?.foreign_net ?? null;
      const institution_net_qty = t?.institution_net ?? null;
      const foreign_net_5d = f?.foreign_net ?? null;
      const institution_net_5d = f?.institution_net ?? null;

      rows.push({
        symbol,
        foreign_net_qty,
        institution_net_qty,
        foreign_net_5d,
        institution_net_5d,
        foreign_streak: nextStreak(prev?.foreign_streak ?? null, foreign_net_qty),
        institution_streak: nextStreak(prev?.institution_streak ?? null, institution_net_qty),
        investor_updated_at: now,
      });
    }

    log('step2', `${rows.length}종목 집계 완료, upsert 시작`);

    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await supabase
        .from('stock_cache')
        .upsert(rows.slice(i, i + CHUNK), { onConflict: 'symbol', ignoreDuplicates: false });
      if (error) errors.push(`step2 upsert ${i}: ${error.message}`);
    }

    log('step2', `완료: ${rows.length}종목 수급 갱신`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`step2 오류: ${msg}`);
  }

  return { errors };
}
