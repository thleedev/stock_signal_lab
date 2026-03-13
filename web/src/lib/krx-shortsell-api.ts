/**
 * KRX 공매도 종합현황 조회
 * POST https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd
 * bld: dbms/MDC/STAT/standard/MDCSTAT02401
 *
 * 응답: 전종목 당일 공매도거래량 / 총거래량 / 공매도비율
 */

function getTodayKrxFormat(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * 전종목 공매도 비율 조회 (당일)
 * @returns Map<symbol(6자리), short_sell_ratio(%)>
 */
export async function fetchKrxShortSell(): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const today = getTodayKrxFormat();

  try {
    const body = new URLSearchParams({
      bld: 'dbms/MDC/STAT/standard/MDCSTAT02401',
      locale: 'ko_KR',
      trdDd: today,
      mktId: 'ALL',
      share: '1',
      money: '1',
      csvxls_isNo: 'false',
    });

    const res = await fetch(
      'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': 'Mozilla/5.0',
          Referer: 'https://data.krx.co.kr/',
        },
        body: body.toString(),
      }
    );

    if (!res.ok) {
      console.error(`[KRX short-sell] HTTP ${res.status}`);
      return result;
    }

    const data = await res.json();
    const output = data.output as Array<Record<string, string>> | undefined;
    if (!output || output.length === 0) {
      console.warn('[KRX short-sell] No data returned (holiday or market closed)');
      return result;
    }

    for (const row of output) {
      // ISU_SRT_CD: 단축코드(6자리), CVSRTSRT: 공매도비율(%)
      const symbol = row['ISU_SRT_CD']?.trim();
      const ratioStr = row['CVSRTSRT']?.replace(/,/g, '');
      if (!symbol || symbol.length !== 6) continue;
      const ratio = parseFloat(ratioStr || '0') || 0;
      result.set(symbol, ratio);
    }

    console.log(`[KRX short-sell] Fetched ${result.size} symbols`);
  } catch (e) {
    console.error('[KRX short-sell] Error:', e);
  }

  return result;
}
