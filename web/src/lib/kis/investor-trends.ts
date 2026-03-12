/**
 * KIS API 투자자별 매매동향 조회
 * API: /uapi/domestic-stock/v1/quotations/inquire-investor
 * tr_id: FHKST01010900
 */

import { createServiceClient } from '../supabase';

const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';

// 기존 kis-api.ts의 토큰 로직 재사용
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  try {
    const supabase = createServiceClient();
    const { data: row } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', 'kis_token')
      .single();

    if (row?.value) {
      const { token, expiresAt } = row.value as { token: string; expiresAt: number };
      if (token && Date.now() < expiresAt) {
        cachedToken = { token, expiresAt };
        return token;
      }
    }
  } catch {
    // fallthrough
  }

  const res = await fetch(`${KIS_BASE_URL}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
    }),
  });

  if (!res.ok) {
    throw new Error(`KIS token failed: ${res.status}`);
  }

  const data = await res.json();
  const expiresAt = Date.now() + (data.expires_in - 60) * 1000;
  cachedToken = { token: data.access_token, expiresAt };

  try {
    const supabase = createServiceClient();
    await supabase.from('app_config').upsert({
      key: 'kis_token',
      value: { token: data.access_token, expiresAt },
      updated_at: new Date().toISOString(),
    });
  } catch {
    // ignore
  }

  return cachedToken.token;
}

export interface InvestorTrend {
  date: string;           // YYYY-MM-DD
  foreign_buy: number;    // 외국인 매수
  foreign_sell: number;   // 외국인 매도
  foreign_net: number;    // 외국인 순매수
  institution_buy: number;
  institution_sell: number;
  institution_net: number;
  individual_buy: number;
  individual_sell: number;
  individual_net: number;
}

/**
 * KOSPI/KOSDAQ 투자자별 매매동향 조회
 * @param market 'KOSPI' | 'KOSDAQ'
 * @param date YYYYMMDD 형식
 */
export async function getInvestorTrends(
  market: 'KOSPI' | 'KOSDAQ' = 'KOSPI',
  date?: string
): Promise<InvestorTrend | null> {
  try {
    const token = await getAccessToken();
    const targetDate = date || new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const marketCode = market === 'KOSPI' ? '0001' : '1001';

    const url = new URL(`${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-investor`);
    url.searchParams.set('FID_COND_MRKT_DIV_CODE', market === 'KOSPI' ? 'J' : 'Q');
    url.searchParams.set('FID_INPUT_ISCD', marketCode);
    url.searchParams.set('FID_INPUT_DATE_1', targetDate);
    url.searchParams.set('FID_INPUT_DATE_2', targetDate);

    const res = await fetch(url.toString(), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        authorization: `Bearer ${token}`,
        appkey: process.env.KIS_APP_KEY!,
        appsecret: process.env.KIS_APP_SECRET!,
        tr_id: 'FHKST01010900',
      },
    });

    if (!res.ok) {
      console.error(`[KIS investor-trends] API error: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const output = data.output as Array<Record<string, string>>;

    if (!output || output.length === 0) return null;

    const row = output[0];
    const fmtDate = `${targetDate.slice(0, 4)}-${targetDate.slice(4, 6)}-${targetDate.slice(6, 8)}`;

    return {
      date: fmtDate,
      foreign_buy: parseInt(row.frgn_ntby_qty || '0'),
      foreign_sell: parseInt(row.frgn_ntsl_qty || '0'),
      foreign_net: parseInt(row.frgn_ntby_qty || '0') - parseInt(row.frgn_ntsl_qty || '0'),
      institution_buy: parseInt(row.orgn_ntby_qty || '0'),
      institution_sell: parseInt(row.orgn_ntsl_qty || '0'),
      institution_net: parseInt(row.orgn_ntby_qty || '0') - parseInt(row.orgn_ntsl_qty || '0'),
      individual_buy: parseInt(row.prsn_ntby_qty || '0'),
      individual_sell: parseInt(row.prsn_ntsl_qty || '0'),
      individual_net: parseInt(row.prsn_ntby_qty || '0') - parseInt(row.prsn_ntsl_qty || '0'),
    };
  } catch (e) {
    console.error('[KIS investor-trends] error:', e);
    return null;
  }
}

/**
 * 네이버 금융 스크래핑 폴백 (KIS API 실패 시)
 */
export async function getInvestorTrendsFallback(
  market: 'KOSPI' | 'KOSDAQ' = 'KOSPI'
): Promise<InvestorTrend | null> {
  try {
    const ticker = market === 'KOSPI' ? 'KOSPI' : 'KOSDAQ';
    const url = `https://finance.naver.com/sise/investorDealTrendDay.naver?bizdate=&sosok=${market === 'KOSPI' ? '01' : '02'}`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
    });

    if (!res.ok) return null;

    const html = await res.text();

    // 간단한 정규식 파싱으로 최신 일자 데이터 추출
    // 네이버 금융 HTML은 테이블 형태
    const today = new Date().toISOString().slice(0, 10);

    // 정규식으로 숫자 추출이 불안정하므로, 실패 시 null 반환
    console.log(`[investor-trends fallback] Fetched ${ticker} page (${html.length} chars)`);

    return null; // 네이버 파싱은 구조 변경이 잦아 우선 null 반환
  } catch (e) {
    console.error('[investor-trends fallback] error:', e);
    return null;
  }
}
