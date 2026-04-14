import { SupabaseClient } from '@supabase/supabase-js';

interface KrxSectorRow {
  sector_code: string;
  sector_name: string;
  symbol: string;
}

/**
 * KRX 업종별 종목 매핑 크롤러
 * KRX REST API (data.krx.co.kr) 사용
 */
export async function crawlSectors(supabase: SupabaseClient): Promise<void> {
  console.log('[step9] KRX 섹터 크롤 시작');

  const today = new Date().toISOString().slice(0, 10);
  const rows: KrxSectorRow[] = [];

  const url = 'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd';
  const body = new URLSearchParams({
    bld: 'dbms/MDC/STAT/standard/MDCSTAT03501',
    locale: 'ko_KR',
    mktId: 'STK',
    share: '1',
    money: '1',
    csvxls_isNo: 'false',
  });

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Referer': 'https://data.krx.co.kr/',
      'User-Agent': 'Mozilla/5.0',
    },
    body: body.toString(),
  });

  if (!resp.ok) {
    console.error(`[step9] KRX API 오류: ${resp.status}`);
    return;
  }

  const json = await resp.json() as { output?: Array<Record<string, string>> };
  const output = json.output ?? [];

  if (output.length > 0) {
    console.log('[step9] KRX 응답 첫 번째 항목 키:', Object.keys(output[0]).join(', '));
  }

  for (const item of output) {
    const sectorCode = item['IDX_IND_NM'] ?? item['업종코드'] ?? '';
    const sectorName = item['IDX_IND_NM'] ?? item['업종명'] ?? '';
    const symbol = (item['ISU_SRT_CD'] ?? item['단축코드'] ?? '').replace(/^A/, '');
    if (!symbol || !sectorCode) continue;
    rows.push({ sector_code: sectorCode, sector_name: sectorName, symbol });
  }

  if (rows.length === 0) {
    console.warn('[step9] KRX 응답 데이터 없음 — 필드명 확인 필요');
    return;
  }

  const { error } = await supabase
    .from('stock_sectors')
    .upsert(
      rows.map((r) => ({ ...r, updated_at: today })),
      { onConflict: 'sector_code,symbol' }
    );

  if (error) {
    console.error('[step9] stock_sectors upsert 오류:', error.message);
  } else {
    console.log(`[step9] stock_sectors ${rows.length}건 저장 완료`);
  }
}
