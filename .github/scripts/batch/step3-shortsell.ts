import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';

const KRX_URL = 'http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd';

/** KRX에서 특정 날짜의 공매도 비중 데이터를 가져온다 */
async function fetchKrxShortSell(date: string): Promise<{ symbol: string; shortSellRatio: number }[]> {
  const dateCompact = date.replace(/-/g, '');
  const body = new URLSearchParams({
    bld: 'dbms/MDC/STAT/standard/MDCSTAT30101',
    mktId: 'ALL',
    trdDd: dateCompact,
    share: '1',
    money: '1',
    csvxls_isNo: 'false',
  });

  const res = await fetch(KRX_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0',
      Referer: 'http://data.krx.co.kr/',
    },
    body: body.toString(),
  });

  if (!res.ok) return [];
  const json = await res.json() as { OutBlock_1?: Record<string, string>[] };
  return (json.OutBlock_1 ?? [])
    .map(row => ({
      symbol: row['ISU_SRT_CD'] ?? '',
      shortSellRatio: parseFloat(row['CVSRTSELL_WGHT'] ?? '0') || 0,
    }))
    .filter(r => r.symbol.length === 6);
}

/**
 * Step 3: KRX 공매도 비중 수집
 * 특정 날짜의 전 종목 공매도 비중을 stock_cache 에 upsert 한다.
 * 휴장일이거나 KRX 오류 시 데이터 없음으로 처리한다.
 */
export async function runStep3Shortsell(opts: { date: string }): Promise<{ errors: string[] }> {
  log('step3', `공매도 수집 시작 date=${opts.date}`);
  const errors: string[] = [];

  try {
    const rows = await fetchKrxShortSell(opts.date);
    if (rows.length === 0) {
      log('step3', '데이터 없음 (휴장일 또는 KRX 오류)');
      return { errors };
    }

    const now = new Date().toISOString();
    // 500건 단위 청크로 upsert
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK).map(r => ({
        symbol: r.symbol,
        short_sell_ratio: r.shortSellRatio,
        short_sell_updated_at: now,
      }));
      const { error } = await supabase
        .from('stock_cache')
        .upsert(chunk, { onConflict: 'symbol', ignoreDuplicates: false });
      if (error) errors.push(`step3 upsert: ${error.message}`);
    }

    log('step3', `완료: ${rows.length}종목 공매도 갱신`);
  } catch (e) {
    errors.push(`step3 오류: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { errors };
}
