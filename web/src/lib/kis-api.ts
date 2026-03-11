/**
 * 한국투자증권 KIS REST API 클라이언트
 *
 * 사용 API:
 * - 주식현재가 시세: /uapi/domestic-stock/v1/quotations/inquire-price
 * - 주식현재가 일자별: /uapi/domestic-stock/v1/quotations/inquire-daily-price
 * - OAuth 토큰 발급: /oauth2/tokenP
 *
 * 환경변수:
 * - KIS_APP_KEY, KIS_APP_SECRET, KIS_ACCOUNT_NO
 */

import { createServiceClient } from './supabase';

const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';

interface KisTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface KisDailyPrice {
  stck_bsop_date: string;  // 영업일자 YYYYMMDD
  stck_oprc: string;       // 시가
  stck_hgpr: string;       // 고가
  stck_lwpr: string;       // 저가
  stck_clpr: string;       // 종가
  acml_vol: string;        // 누적거래량
}

interface KisCurrentPrice {
  stck_prpr: string;       // 현재가
  stck_oprc: string;       // 시가
  stck_hgpr: string;       // 고가
  stck_lwpr: string;       // 저가
  acml_vol: string;        // 누적거래량
}

// 1차: 인메모리 캐시 (warm 상태에서 즉시 재사용)
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  // 1차: 인메모리 캐시 확인
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  // 2차: Supabase에서 저장된 토큰 확인 (cold start 대응)
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
        console.log('[KIS] 토큰 재사용 (Supabase 캐시)');
        return token;
      }
    }
  } catch {
    // Supabase 조회 실패 시 새 토큰 발급으로 진행
  }

  // 3차: 새 토큰 발급
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
    throw new Error(`KIS token failed: ${res.status} ${await res.text()}`);
  }

  const data: KisTokenResponse = await res.json();
  const expiresAt = Date.now() + (data.expires_in - 60) * 1000; // 1분 여유

  cachedToken = { token: data.access_token, expiresAt };
  console.log('[KIS] 새 토큰 발급');

  // Supabase에 토큰 저장 (비동기, 실패해도 무시)
  try {
    const supabase = createServiceClient();
    await supabase
      .from('app_config')
      .upsert({
        key: 'kis_token',
        value: { token: data.access_token, expiresAt },
        updated_at: new Date().toISOString(),
      });
  } catch {
    // 저장 실패해도 인메모리 캐시로 동작
  }

  return cachedToken.token;
}

async function kisRequest(
  path: string,
  trId: string,
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  const token = await getAccessToken();
  const url = new URL(`${KIS_BASE_URL}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      authorization: `Bearer ${token}`,
      appkey: process.env.KIS_APP_KEY!,
      appsecret: process.env.KIS_APP_SECRET!,
      tr_id: trId,
    },
  });

  if (!res.ok) {
    throw new Error(`KIS API failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

/**
 * 종목 현재가 조회
 */
export async function getCurrentPrice(symbol: string): Promise<{
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
} | null> {
  try {
    const data = await kisRequest(
      '/uapi/domestic-stock/v1/quotations/inquire-price',
      'FHKST01010100',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: symbol,
      }
    );

    const output = data.output as KisCurrentPrice;
    if (!output?.stck_prpr) return null;

    return {
      price: parseInt(output.stck_prpr),
      open: parseInt(output.stck_oprc),
      high: parseInt(output.stck_hgpr),
      low: parseInt(output.stck_lwpr),
      volume: parseInt(output.acml_vol),
    };
  } catch (e) {
    console.error(`getCurrentPrice(${symbol}) failed:`, e);
    return null;
  }
}

/**
 * 일봉 데이터 조회 (최근 N일)
 */
export async function getDailyPrices(
  symbol: string,
  startDate: string, // YYYYMMDD
  endDate: string    // YYYYMMDD
): Promise<Array<{
  date: string;      // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}>> {
  try {
    const data = await kisRequest(
      '/uapi/domestic-stock/v1/quotations/inquire-daily-price',
      'FHKST01010400',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: symbol,
        FID_INPUT_DATE_1: startDate,
        FID_INPUT_DATE_2: endDate,
        FID_PERIOD_DIV_CODE: 'D',
        FID_ORG_ADJ_PRC: '0', // 수정주가
      }
    );

    const output = data.output as KisDailyPrice[] | undefined;
    if (!output || !Array.isArray(output)) return [];

    return output
      .filter((d) => d.stck_clpr && parseInt(d.stck_clpr) > 0)
      .map((d) => ({
        date: `${d.stck_bsop_date.slice(0, 4)}-${d.stck_bsop_date.slice(4, 6)}-${d.stck_bsop_date.slice(6, 8)}`,
        open: parseInt(d.stck_oprc),
        high: parseInt(d.stck_hgpr),
        low: parseInt(d.stck_lwpr),
        close: parseInt(d.stck_clpr),
        volume: parseInt(d.acml_vol),
      }));
  } catch (e) {
    console.error(`getDailyPrices(${symbol}) failed:`, e);
    return [];
  }
}

/**
 * 종목 투자지표 조회 (PER, PBR, EPS, BPS 등)
 */
export async function getStockIndicators(symbol: string): Promise<{
  price: number;
  price_change: number;
  price_change_pct: number;
  volume: number;
  market_cap: number;
  per: number;
  pbr: number;
  eps: number;
  bps: number;
  high_52w: number;
  low_52w: number;
  dividend_yield: number;
} | null> {
  try {
    const data = await kisRequest(
      '/uapi/domestic-stock/v1/quotations/inquire-price',
      'FHKST01010100',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: symbol,
      }
    );

    const o = data.output as Record<string, string>;
    if (!o?.stck_prpr) return null;

    return {
      price: parseInt(o.stck_prpr) || 0,
      price_change: parseInt(o.prdy_vrss) || 0,
      price_change_pct: parseFloat(o.prdy_ctrt) || 0,
      volume: parseInt(o.acml_vol) || 0,
      market_cap: parseInt(o.hts_avls) || 0,
      per: parseFloat(o.per) || 0,
      pbr: parseFloat(o.pbr) || 0,
      eps: parseInt(o.eps) || 0,
      bps: parseInt(o.bps) || 0,
      high_52w: parseInt(o.stck_dryy_hgpr) || 0,
      low_52w: parseInt(o.stck_dryy_lwpr) || 0,
      dividend_yield: parseFloat(o.div_yield) || 0,
    };
  } catch (e) {
    console.error(`getStockIndicators(${symbol}) failed:`, e);
    return null;
  }
}

/**
 * Rate limit 대응: 호출 간 딜레이
 */
export async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
