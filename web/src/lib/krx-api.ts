/**
 * 투자지표 벌크 조회
 *
 * 1. KRX 벌크 API: 전종목 PER/PBR/EPS/BPS/배당수익률 (2회 호출, KOSPI+KOSDAQ)
 * 2. KRX 벌크 API: 전종목 투자자별 순매수 (2회 호출, KOSPI+KOSDAQ)
 * 3. 네이버 개별 API: 컨센서스(forward PER/목표가) + 52주 고저가 (우선순위 종목만)
 */

const NAVER_API = 'https://m.stock.naver.com/api';
const KRX_API = 'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd';

// ─── KRX 공통 유틸 ───────────────────────────────────────────

function getTodayKrxFormat(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10).replace(/-/g, '');
}

function parseKrxNumber(str: string | undefined): number | null {
  if (!str || str === '-' || str === '' || str === 'N/A') return null;
  const v = parseFloat(str.replace(/,/g, ''));
  return Number.isNaN(v) ? null : v;
}

async function fetchKrxData(bld: string, params: Record<string, string>): Promise<Record<string, string>[]> {
  const body = new URLSearchParams({
    bld,
    locale: 'ko_KR',
    csvxls_isNo: 'false',
    ...params,
  });
  const res = await fetch(KRX_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://data.krx.co.kr/',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    console.error(`[KRX] HTTP ${res.status} for ${bld}`);
    return [];
  }
  const text = await res.text();
  if (!text.startsWith('{') && !text.startsWith('[')) {
    console.error(`[KRX] Non-JSON response for ${bld}: ${text.slice(0, 50)}`);
    return [];
  }
  const data = JSON.parse(text);
  return (data.output ?? data.OutBlock_1 ?? []) as Record<string, string>[];
}

// ─── KRX 전종목 PER/PBR/EPS/BPS/배당 ───────────────────────

export interface KrxIndicatorData {
  per: number | null;
  pbr: number | null;
  eps: number | null;
  bps: number | null;
  dividend_yield: number | null;
}

/**
 * KRX 벌크 PER/PBR 조회 — 전종목 2회 호출 (KOSPI + KOSDAQ)
 */
export async function fetchKrxIndicators(): Promise<Map<string, KrxIndicatorData>> {
  const result = new Map<string, KrxIndicatorData>();
  const today = getTodayKrxFormat();

  for (const mktId of ['STK', 'KSQ']) {
    try {
      const rows = await fetchKrxData('dbms/MDC/STAT/standard/MDCSTAT03501', {
        trdDd: today,
        mktId,
      });
      if (rows.length > 0 && result.size === 0) {
        console.log(`[KRX indicators] ${mktId} fields:`, Object.keys(rows[0]).join(', '));
        console.log(`[KRX indicators] ${mktId} sample:`, JSON.stringify(rows[0]).slice(0, 300));
      }
      for (const row of rows) {
        const symbol = row['ISU_SRT_CD']?.trim();
        if (!symbol || symbol.length !== 6) continue;
        result.set(symbol, {
          per: parseKrxNumber(row['PER']),
          pbr: parseKrxNumber(row['PBR']),
          eps: parseKrxNumber(row['EPS']),
          bps: parseKrxNumber(row['BPS']),
          dividend_yield: parseKrxNumber(row['DVD_YLD']),
        });
      }
    } catch (e) {
      console.error(`[KRX indicators] ${mktId} error:`, e);
    }
  }

  console.log(`[KRX indicators] Fetched ${result.size} symbols`);
  return result;
}

// ─── KRX 전종목 투자자별 순매수 ──────────────────────────────

export interface KrxInvestorData {
  foreign_net: number;      // 외국인 순매수 (주)
  institution_net: number;  // 기관 순매수 (주)
  individual_net: number;   // 개인 순매수 (주)
}

/**
 * KRX 전종목 투자자별 순매매 — 2회 호출 (KOSPI + KOSDAQ)
 * bld: MDCSTAT02303 (투자자별 거래실적 - 개별종목)
 */
export async function fetchKrxInvestorData(): Promise<Map<string, KrxInvestorData>> {
  const result = new Map<string, KrxInvestorData>();
  const today = getTodayKrxFormat();

  for (const mktId of ['STK', 'KSQ']) {
    try {
      const rows = await fetchKrxData('dbms/MDC/STAT/standard/MDCSTAT02303', {
        trdDd: today,
        mktId,
        inqTpCd: '2',  // 순매수
        trdVolVal: '2', // 수량 기준
        askBid: '3',    // 순매수
      });
      // 첫 실행 시 필드명 확인용 로깅
      if (rows.length > 0 && result.size === 0) {
        console.log(`[KRX investor] ${mktId} fields:`, Object.keys(rows[0]).join(', '));
        console.log(`[KRX investor] ${mktId} sample:`, JSON.stringify(rows[0]).slice(0, 300));
      }
      for (const row of rows) {
        const symbol = row['ISU_SRT_CD']?.trim();
        if (!symbol || symbol.length !== 6) continue;
        // TRDVAL1~7: 기관 (금융투자+보험+투신+사모+은행+기타금융+연기금)
        const inst =
          (parseKrxNumber(row['TRDVAL1']) ?? 0) +
          (parseKrxNumber(row['TRDVAL2']) ?? 0) +
          (parseKrxNumber(row['TRDVAL3']) ?? 0) +
          (parseKrxNumber(row['TRDVAL4']) ?? 0) +
          (parseKrxNumber(row['TRDVAL5']) ?? 0) +
          (parseKrxNumber(row['TRDVAL6']) ?? 0) +
          (parseKrxNumber(row['TRDVAL7']) ?? 0);
        const individual = parseKrxNumber(row['TRDVAL8']) ?? 0;
        // 외국인 = TRDVAL9 + TRDVAL10 (외국인 + 기타외국인)
        const foreign =
          (parseKrxNumber(row['TRDVAL9']) ?? 0) +
          (parseKrxNumber(row['TRDVAL10']) ?? 0);
        result.set(symbol, { foreign_net: foreign, institution_net: inst, individual_net: individual });
      }
    } catch (e) {
      console.error(`[KRX investor] ${mktId} error:`, e);
    }
  }

  console.log(`[KRX investor] Fetched ${result.size} symbols`);
  return result;
}

export interface BulkIndicatorData {
  per: number | null;
  pbr: number | null;
  eps: number | null;
  bps: number | null;
  roe: number | null;
  high_52w: number | null;
  low_52w: number | null;
  dividend_yield: number | null;
  // Forward valuation (컨센서스)
  forward_per: number | null;
  forward_eps: number | null;
  target_price: number | null;
  invest_opinion: number | null;  // 1~5 (5=강력매수)
}

interface NaverIntegrationInfo {
  code: string;
  value: string;
}

function parseIndicatorValue(str: string | undefined): number | null {
  if (!str || str === '-' || str === 'N/A') return null;
  const v = parseFloat(str.replace(/[,배원%조억백만]/g, ''));
  return Number.isNaN(v) ? null : v;
}

async function fetchSingleIndicator(symbol: string): Promise<BulkIndicatorData | null> {
  try {
    const res = await fetch(`${NAVER_API}/stock/${symbol}/integration`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const infos = data.totalInfos as NaverIntegrationInfo[] | undefined;
    if (!infos) return null;

    const getValue = (code: string): number | null => {
      const info = infos.find((i) => i.code === code);
      return parseIndicatorValue(info?.value);
    };
    const getValueOrNull = (code: string): number | null => {
      const info = infos.find((i) => i.code === code);
      if (!info?.value) return null;
      return parseIndicatorValue(info.value);
    };

    // 컨센서스 데이터 (없을 수 있음)
    const consensus = data.consensusInfo as { priceTargetMean?: string; recommMean?: string } | undefined;
    const targetPrice = consensus?.priceTargetMean
      ? parseInt(consensus.priceTargetMean.replace(/,/g, ''), 10) || null
      : null;
    const investOpinion = consensus?.recommMean
      ? parseFloat(consensus.recommMean) || null
      : null;

    return {
      per: getValue('per'),
      pbr: getValue('pbr'),
      eps: getValue('eps'),
      bps: getValue('bps'),
      roe: getValue('roe'),
      high_52w: getValue('highPriceOf52Weeks'),
      low_52w: getValue('lowPriceOf52Weeks'),
      dividend_yield: getValue('dividendYield'),
      forward_per: getValueOrNull('cnsPer'),
      forward_eps: getValueOrNull('cnsEps'),
      target_price: targetPrice,
      invest_opinion: investOpinion,
    };
  } catch {
    return null;
  }
}

/**
 * 네이버 투자지표 벌크 조회 (고병렬)
 *
 * @param symbols 조회할 종목 코드 배열
 * @param concurrency 동시 요청 수 (기본 30)
 * @returns Map<symbol, BulkIndicatorData>
 */
export async function fetchBulkIndicators(
  symbols: string[],
  concurrency = 30
): Promise<Map<string, BulkIndicatorData>> {
  const result = new Map<string, BulkIndicatorData>();
  if (symbols.length === 0) return result;

  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (symbol) => {
        const data = await fetchSingleIndicator(symbol);
        if (data) result.set(symbol, data);
      })
    );

    // 실패율이 높으면 잠시 대기 (rate limit 방어)
    const failures = results.filter((r) => r.status === 'rejected').length;
    if (failures > batch.length * 0.5) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return result;
}
