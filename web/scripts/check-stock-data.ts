/**
 * stock_cache 테이블 현황 조회 스크립트
 *
 * 실행: cd web && npx tsx scripts/check-stock-data.ts
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

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  console.log("=== stock_cache 테이블 현황 조회 ===\n");

  // 1. 전체 종목 수
  const { count: totalCount, error: e1 } = await supabase
    .from("stock_cache")
    .select("*", { count: "exact", head: true });
  if (e1) { console.error("전체 조회 오류:", e1.message); return; }
  console.log(`총 종목 수: ${totalCount}`);

  // 2. current_price가 있는 종목 수
  const { count: withPrice, error: e2 } = await supabase
    .from("stock_cache")
    .select("*", { count: "exact", head: true })
    .not("current_price", "is", null);
  if (e2) { console.error("current_price 조회 오류:", e2.message); return; }
  console.log(`current_price 있는 종목: ${withPrice}`);

  // 3. current_price가 null인 종목 수
  const { count: withoutPrice, error: e3 } = await supabase
    .from("stock_cache")
    .select("*", { count: "exact", head: true })
    .is("current_price", null);
  if (e3) { console.error("current_price null 조회 오류:", e3.message); return; }
  console.log(`current_price 없는 종목 (null): ${withoutPrice}`);

  // 4. ETF 종목 수
  const { count: etfCount, error: e4 } = await supabase
    .from("stock_cache")
    .select("*", { count: "exact", head: true })
    .eq("market", "ETF");
  if (e4) { console.error("ETF 조회 오류:", e4.message); return; }
  console.log(`ETF 종목 수: ${etfCount}`);

  // 5. signals가 있는 종목 수
  const { count: withSignals, error: e5 } = await supabase
    .from("stock_cache")
    .select("*", { count: "exact", head: true })
    .not("signals", "is", null);
  if (e5) {
    console.log(`signals 컬럼 조회 실패 (컬럼 없을 수 있음): ${e5.message}`);
  } else {
    console.log(`signals 있는 종목 (not null): ${withSignals}`);
  }

  // 5b. 샘플 1건 컬럼 확인
  const { data: sample } = await supabase.from("stock_cache").select("*").limit(1);
  if (sample && sample.length > 0) {
    console.log(`\n컬럼 목록: ${Object.keys(sample[0]).join(", ")}`);
  }

  // 6. 시장별 분포
  console.log("\n--- 시장별 분포 ---");
  for (const market of ["KOSPI", "KOSDAQ", "ETF"]) {
    const { count, error } = await supabase
      .from("stock_cache")
      .select("*", { count: "exact", head: true })
      .eq("market", market);
    if (!error) {
      console.log(`  ${market}: ${count}`);
    }
  }

  console.log("\n=== 완료 ===");
}

main().catch((e) => {
  console.error("오류 발생:", e);
  process.exit(1);
});
