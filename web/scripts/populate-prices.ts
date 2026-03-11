/**
 * stock_cache에 현재가 데이터 채우기
 * 우선순위: 신호있는 종목 > 즐겨찾기 > 워치리스트 > 나머지
 *
 * 실행: cd web && npx tsx scripts/populate-prices.ts [--all] [--limit N]
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// .env.local 수동 파싱
const envPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const KIS_BASE_URL = "https://openapi.koreainvestment.com:9443";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const res = await fetch(`${KIS_BASE_URL}/oauth2/tokenP`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
    }),
  });

  if (!res.ok) throw new Error(`KIS token failed: ${res.status}`);
  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.token;
}

async function getStockPrice(symbol: string): Promise<Record<string, number | null> | null> {
  try {
    const token = await getAccessToken();
    const url = new URL(`${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price`);
    url.searchParams.set("FID_COND_MRKT_DIV_CODE", "J");
    url.searchParams.set("FID_INPUT_ISCD", symbol);

    const res = await fetch(url.toString(), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        authorization: `Bearer ${token}`,
        appkey: process.env.KIS_APP_KEY!,
        appsecret: process.env.KIS_APP_SECRET!,
        tr_id: "FHKST01010100",
      },
    });

    if (!res.ok) return null;
    const data = await res.json();
    const o = data.output;
    if (!o?.stck_prpr) return null;

    return {
      current_price: parseInt(o.stck_prpr) || null,
      price_change: parseInt(o.prdy_vrss) || null,
      price_change_pct: parseFloat(o.prdy_ctrt) || null,
      volume: parseInt(o.acml_vol) || null,
      market_cap: parseInt(o.hts_avls) || null,
      per: parseFloat(o.per) || null,
      pbr: parseFloat(o.pbr) || null,
      eps: parseInt(o.eps) || null,
      bps: parseInt(o.bps) || null,
      high_52w: parseInt(o.stck_dryy_hgpr) || null,
      low_52w: parseInt(o.stck_dryy_lwpr) || null,
      dividend_yield: parseFloat(o.div_yield) || null,
    };
  } catch {
    return null;
  }
}

async function getETFPrice(symbol: string): Promise<Record<string, number | null> | null> {
  try {
    const token = await getAccessToken();
    const url = new URL(`${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price`);
    url.searchParams.set("FID_COND_MRKT_DIV_CODE", "J");
    url.searchParams.set("FID_INPUT_ISCD", symbol);

    const res = await fetch(url.toString(), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        authorization: `Bearer ${token}`,
        appkey: process.env.KIS_APP_KEY!,
        appsecret: process.env.KIS_APP_SECRET!,
        tr_id: "FHKST01010100",
      },
    });

    if (!res.ok) return null;
    const data = await res.json();
    const o = data.output;
    if (!o?.stck_prpr || parseInt(o.stck_prpr) === 0) return null;

    return {
      current_price: parseInt(o.stck_prpr) || null,
      price_change: parseInt(o.prdy_vrss) || null,
      price_change_pct: parseFloat(o.prdy_ctrt) || null,
      volume: parseInt(o.acml_vol) || null,
      market_cap: null,
      per: null,
      pbr: null,
      eps: null,
      bps: null,
      high_52w: parseInt(o.stck_dryy_hgpr) || null,
      low_52w: parseInt(o.stck_dryy_lwpr) || null,
      dividend_yield: null,
    };
  } catch {
    return null;
  }
}

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const doAll = args.includes("--all");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : (doAll ? 9999 : 200);

  console.log("=== stock_cache 데이터 채우기 ===\n");

  // 1. 신호 있는 종목 심볼 조회
  const { data: signalSymbols } = await supabase
    .from("signals")
    .select("symbol")
    .not("symbol", "is", null);

  const sigSet = new Set((signalSymbols ?? []).map((s) => s.symbol));
  console.log(`신호 있는 종목: ${sigSet.size}개`);

  // 2. 즐겨찾기 심볼
  const { data: favs } = await supabase.from("favorite_stocks").select("symbol");
  const favSet = new Set((favs ?? []).map((f) => f.symbol));
  console.log(`즐겨찾기 종목: ${favSet.size}개`);

  // 3. 워치리스트 심볼
  const { data: watch } = await supabase.from("watchlist").select("symbol");
  const watchSet = new Set((watch ?? []).map((w) => w.symbol));
  console.log(`포트 종목: ${watchSet.size}개`);

  // 4. 우선순위 정렬: 신호 > 즐겨찾기 > 워치리스트 > 나머지
  const { data: allStocks } = await supabase
    .from("stock_cache")
    .select("symbol, market")
    .is("current_price", null)
    .order("symbol");

  if (!allStocks || allStocks.length === 0) {
    console.log("업데이트할 종목이 없습니다.");
    return;
  }

  const priority = (s: { symbol: string }) => {
    if (sigSet.has(s.symbol)) return 0;
    if (favSet.has(s.symbol)) return 1;
    if (watchSet.has(s.symbol)) return 2;
    return 3;
  };

  allStocks.sort((a, b) => priority(a) - priority(b));
  const targets = allStocks.slice(0, limit);
  console.log(`\n업데이트 대상: ${targets.length}개 (총 ${allStocks.length}개 중)\n`);

  let updated = 0;
  let failed = 0;
  const BATCH = 5;

  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH);

    const results = await Promise.allSettled(
      batch.map(async (s) => {
        const isETF = s.market === "ETF";
        const data = isETF ? await getETFPrice(s.symbol) : await getStockPrice(s.symbol);
        if (!data || !data.current_price) throw new Error(`No data: ${s.symbol}`);

        const { error } = await supabase
          .from("stock_cache")
          .update({ ...data, updated_at: new Date().toISOString() })
          .eq("symbol", s.symbol);

        if (error) throw error;
        return s.symbol;
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        updated++;
      } else {
        failed++;
      }
    }

    const progress = Math.min(i + BATCH, targets.length);
    process.stdout.write(`\r진행: ${progress}/${targets.length} (성공: ${updated}, 실패: ${failed})`);

    if (i + BATCH < targets.length) {
      await delay(1100); // KIS rate limit
    }
  }

  console.log(`\n\n=== 완료 ===`);
  console.log(`성공: ${updated}건, 실패: ${failed}건`);
}

main().catch((e) => {
  console.error("오류:", e);
  process.exit(1);
});
