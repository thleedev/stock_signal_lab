import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';

const NAVER_API = 'https://m.stock.naver.com/api';
const CONCURRENCY = 80; // 과도한 병렬 요청 방지

interface DayData {
  foreign_net: number;
  institution_net: number;
}

function parseQty(s: unknown): number {
  if (s == null || s === '-' || s === '') return 0;
  return parseFloat(String(s).replace(/[+,]/g, '')) || 0;
}

/**
 * streak 계산:
 * - 기존 streak과 오늘 방향이 같으면 |streak| + 1 방향 유지
 * - 방향이 바뀌면 ±1 로 리셋
 * - smallint 오버플로 방지: ±120 상한
 */
function calcStreak(days: DayData[], key: keyof DayData): number {
  if (days.length === 0) return 0;
  const firstDir = days[0][key] >= 0 ? 1 : -1;
  let count = 0;
  for (const day of days) {
    const dir = day[key] >= 0 ? 1 : -1;
    if (dir === firstDir) count++;
    else break;
  }
  return Math.max(-120, Math.min(120, firstDir * count));
}

/** 종목 하나의 최근 5일 수급 데이터를 가져온다 (most-recent-first) */
async function fetchDays(symbol: string): Promise<DayData[]> {
  try {
    const res = await fetch(`${NAVER_API}/stock/${symbol}/integration`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const text = await res.text();
    if (!text || text.length < 10) return [];
    const json = JSON.parse(text) as { dealTrendInfos?: Record<string, unknown>[] };
    return (json.dealTrendInfos ?? []).map(d => ({
      foreign_net: parseQty(d.foreignerPureBuyQuant),
      institution_net: parseQty(d.organPureBuyQuant),
    }));
  } catch {
    return [];
  }
}

/**
 * Step 2: 네이버 per-stock integration API로 수급 데이터 수집
 *
 * m.stock.naver.com/api/stocks/invest bulk API가 폐기(404)됨에 따라
 * 개별 종목 /api/stock/{symbol}/integration 의 dealTrendInfos (최근 5영업일) 사용.
 *
 * 갱신 필드:
 *   foreign_net_qty      — 가장 최근 1일 외국인 순매수
 *   institution_net_qty  — 가장 최근 1일 기관 순매수
 *   foreign_net_5d       — 최근 5일 누적 외국인 순매수
 *   institution_net_5d   — 최근 5일 누적 기관 순매수
 *   foreign_streak       — 외국인 연속 매수(+)/매도(-) 일수
 *   institution_streak   — 기관 연속 매수(+)/매도(-) 일수
 */
export async function runStep2InvestorData(_opts: { date: string }): Promise<{ errors: string[] }> {
  log('step2', '수급 데이터 수집 시작 (per-stock integration API)');
  const errors: string[] = [];

  try {
    // 1. stock_cache에서 전종목 심볼 조회
    const allSymbols: string[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await supabase
        .from('stock_cache')
        .select('symbol')
        .not('current_price', 'is', null)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`stock_cache 조회 실패: ${error.message}`);
      if (!data || data.length === 0) break;
      allSymbols.push(...data.map(r => r.symbol as string));
      if (data.length < PAGE) break;
      from += PAGE;
    }

    log('step2', `${allSymbols.length}종목 수급 수집 시작 (concurrency=${CONCURRENCY})`);

    // 2. 병렬 fetch (CONCURRENCY 단위 배치)
    const now = new Date().toISOString();
    const rows: {
      symbol: string;
      foreign_net_qty: number | null;
      institution_net_qty: number | null;
      foreign_net_5d: number | null;
      institution_net_5d: number | null;
      foreign_streak: number | null;
      institution_streak: number | null;
      investor_updated_at: string;
    }[] = [];

    let fetched = 0;
    for (let i = 0; i < allSymbols.length; i += CONCURRENCY) {
      const batch = allSymbols.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(symbol => fetchDays(symbol).then(days => ({ symbol, days })))
      );

      for (const r of settled) {
        if (r.status !== 'fulfilled' || r.value.days.length === 0) continue;
        const { symbol, days } = r.value;

        rows.push({
          symbol,
          foreign_net_qty: days[0]?.foreign_net ?? null,
          institution_net_qty: days[0]?.institution_net ?? null,
          foreign_net_5d: days.reduce((s, d) => s + d.foreign_net, 0),
          institution_net_5d: days.reduce((s, d) => s + d.institution_net, 0),
          foreign_streak: calcStreak(days, 'foreign_net'),
          institution_streak: calcStreak(days, 'institution_net'),
          investor_updated_at: now,
        });
        fetched++;
      }

      if ((i / CONCURRENCY) % 10 === 0 && i > 0) {
        log('step2', `진행 ${i + batch.length}/${allSymbols.length} 수집=${fetched}`);
      }
    }

    log('step2', `수집 완료: ${fetched}종목, upsert 시작`);

    // 3. stock_cache upsert
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
