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
  // 1. KRX에서 ETF 목록 (실제 ETF 코드 확인)
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

  const json = await res.json();
  const block = json.block1 || [];

  // 원본 데이터 구조 확인
  console.log("=== ETF 데이터 샘플 ===");
  console.log("첫 5개 항목 키:", Object.keys(block[0] || {}));
  for (let i = 0; i < 5; i++) {
    const item = block[i];
    if (!item) break;
    console.log(`  ${i}: short_code=${item.short_code}, full_code=${item.full_code}, codeName=${item.codeName}`);
  }

  // 2. KRX에서 KOSPI 목록으로 복원
  console.log("\n=== KOSPI 복원 ===");
  const kospiForm = new URLSearchParams();
  kospiForm.append("bld", "dbms/comm/finder/finder_stkisu");
  kospiForm.append("locale", "ko_KR");
  kospiForm.append("mktsel", "STK");
  kospiForm.append("typeNo", "0");
  kospiForm.append("searchText", "");

  const kospiRes = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": "Mozilla/5.0",
      Referer: "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd",
    },
    body: kospiForm.toString(),
  });

  const kospiJson = await kospiRes.json();
  const kospiBlock = kospiJson.block1 || [];
  const kospiStocks = kospiBlock
    .map((item: Record<string, string>) => ({
      symbol: item.short_code || "",
      name: item.codeName || "",
    }))
    .filter((s: { symbol: string }) => /^\d{6}$/.test(s.symbol));

  console.log(`KOSPI 종목: ${kospiStocks.length}개`);
  console.log("KOSPI 샘플:", kospiStocks.slice(0, 3));

  // ETF 코드 세트
  const etfCodes = new Set(
    block
      .map((item: Record<string, string>) => item.short_code || "")
      .filter((c: string) => /^\d{6}$/.test(c))
  );

  // KOSPI 코드 세트
  const kospiCodes = new Set(kospiStocks.map((s: { symbol: string }) => s.symbol));

  // 겹치는 코드 확인
  const overlap = [...kospiCodes].filter((c) => etfCodes.has(c));
  console.log(`\n겹치는 코드 수: ${overlap.length}`);
  if (overlap.length > 0) {
    console.log("겹치는 코드 샘플:", overlap.slice(0, 10));
  }

  // ETF만 있는 코드 (KOSPI에는 없는)
  const etfOnly = [...etfCodes].filter((c) => !kospiCodes.has(c));
  console.log(`ETF 전용 코드: ${etfOnly.length}개`);

  // 3. KOSPI 종목 복원 (market을 다시 KOSPI로)
  const BATCH = 500;
  let restored = 0;
  for (let i = 0; i < kospiStocks.length; i += BATCH) {
    const batch = kospiStocks.slice(i, i + BATCH).map((s: { symbol: string; name: string }) => ({
      symbol: s.symbol,
      name: s.name,
      market: "KOSPI",
    }));
    const { error } = await sb.from("stock_cache").upsert(batch, { onConflict: "symbol" });
    if (error) console.error(`복원 오류:`, error.message);
    else restored += batch.length;
  }
  console.log(`\nKOSPI ${restored}건 복원 완료`);

  // 4. ETF 전용 코드만 추가
  const etfOnlyItems = block
    .filter((item: Record<string, string>) => {
      const code = item.short_code || "";
      return /^\d{6}$/.test(code) && !kospiCodes.has(code);
    })
    .map((item: Record<string, string>) => ({
      symbol: item.short_code,
      name: item.codeName || "",
      market: "ETF",
    }));

  let etfInserted = 0;
  for (let i = 0; i < etfOnlyItems.length; i += BATCH) {
    const batch = etfOnlyItems.slice(i, i + BATCH);
    const { error } = await sb.from("stock_cache").upsert(batch, { onConflict: "symbol" });
    if (error) console.error(`ETF 오류:`, error.message);
    else etfInserted += batch.length;
  }
  console.log(`ETF 전용 ${etfInserted}건 추가 완료`);

  // 5. 최종 확인
  const { count: total } = await sb.from("stock_cache").select("*", { count: "exact", head: true });
  const { count: ki } = await sb.from("stock_cache").select("*", { count: "exact", head: true }).eq("market", "KOSPI");
  const { count: kd } = await sb.from("stock_cache").select("*", { count: "exact", head: true }).eq("market", "KOSDAQ");
  const { count: etfCount } = await sb.from("stock_cache").select("*", { count: "exact", head: true }).eq("market", "ETF");
  console.log(`\n최종: 총 ${total} | KOSPI: ${ki} | KOSDAQ: ${kd} | ETF: ${etfCount}`);
}

main().catch(console.error);
