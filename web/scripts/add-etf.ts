import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const envPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const url = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";
  const form = new URLSearchParams();
  form.append("bld", "dbms/comm/finder/finder_stkisu");
  form.append("locale", "ko_KR");
  form.append("mktsel", "ALL");
  form.append("typeNo", "3");
  form.append("searchText", "");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": "Mozilla/5.0",
      Referer: "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd",
    },
    body: form.toString(),
  });

  if (!res.ok) {
    console.error("KRX ETF API failed:", res.status);
    return;
  }

  const json = await res.json();
  const block = json.block1 || [];
  const etfs = block
    .map((item: Record<string, string>) => ({
      symbol: item.short_code || "",
      name: item.codeName || "",
    }))
    .filter((s: { symbol: string }) => /^\d{6}$/.test(s.symbol));

  console.log(`ETF ${etfs.length}개 수집`);

  // batch upsert (without ignoreDuplicates)
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < etfs.length; i += BATCH) {
    const batch = etfs.slice(i, i + BATCH).map((e: { symbol: string; name: string }) => ({
      symbol: e.symbol,
      name: e.name,
      market: "ETF",
    }));

    const { error } = await sb.from("stock_cache").upsert(batch, { onConflict: "symbol" });
    if (error) {
      console.error(`batch ${i} error:`, error.message);
    } else {
      inserted += batch.length;
    }
  }
  console.log(`stock_cache ETF ${inserted}건 upsert 완료`);

  // stock_info에도 추가
  let infoInserted = 0;
  for (let i = 0; i < etfs.length; i += BATCH) {
    const batch = etfs.slice(i, i + BATCH).map((e: { symbol: string; name: string }) => ({
      symbol: e.symbol,
      name: e.name,
      market: "ETF",
      sector: null,
    }));
    const { error } = await sb.from("stock_info").upsert(batch, { onConflict: "symbol" });
    if (error) {
      console.error(`stock_info batch ${i} error:`, error.message);
    } else {
      infoInserted += batch.length;
    }
  }
  console.log(`stock_info ETF ${infoInserted}건 upsert 완료`);

  // 확인
  const { count } = await sb.from("stock_cache").select("*", { count: "exact", head: true }).eq("market", "ETF");
  console.log(`\nETF 종목 수 (stock_cache): ${count}`);
}

main().catch(console.error);
