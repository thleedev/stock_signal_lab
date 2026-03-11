/**
 * 네이버 금융에서 업종 정보 수집 → stock_info.sector 업데이트
 * 실행: cd web && npx tsx scripts/fetch-sectors.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const envPath = path.resolve(__dirname, "../.env.local");
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

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const DELAY = 200; // ms between requests
const BATCH_SIZE = 50;

async function getSector(symbol: string): Promise<string | null> {
  try {
    const res = await fetch(`https://finance.naver.com/item/main.naver?code=${symbol}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null;
    const html = await res.text();

    // 패턴: 업종명 : <a href="...">업종이름</a>
    const match = html.match(/업종명\s*:\s*<a[^>]*>([^<]+)<\/a>/);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

async function main() {
  console.log("=== 업종 정보 수집 ===\n");

  // sector가 없는 종목 조회 (ETF 제외)
  const { data: stocks } = await sb
    .from("stock_info")
    .select("symbol, name, market")
    .is("sector", null)
    .neq("market", "ETF")
    .order("symbol")
    .limit(3000);

  if (!stocks || stocks.length === 0) {
    console.log("수집 대상이 없습니다.");
    return;
  }

  console.log(`대상: ${stocks.length}개 종목\n`);

  let success = 0;
  let failed = 0;
  const updates: { symbol: string; sector: string }[] = [];

  for (let i = 0; i < stocks.length; i++) {
    const stock = stocks[i];
    const sector = await getSector(stock.symbol);

    if (sector) {
      updates.push({ symbol: stock.symbol, sector });
      success++;
      if (i < 10 || i % 100 === 0) {
        console.log(`  [${i + 1}/${stocks.length}] ${stock.name} (${stock.symbol}) → ${sector}`);
      }
    } else {
      failed++;
      if (i < 10) {
        console.log(`  [${i + 1}/${stocks.length}] ${stock.name} (${stock.symbol}) → 실패`);
      }
    }

    // Batch update
    if (updates.length >= BATCH_SIZE) {
      for (const u of updates) {
        await sb
          .from("stock_info")
          .update({ sector: u.sector, updated_at: new Date().toISOString() })
          .eq("symbol", u.symbol);
      }
      updates.length = 0;
    }

    await new Promise((r) => setTimeout(r, DELAY));
  }

  // Remaining
  if (updates.length > 0) {
    for (const u of updates) {
      await sb
        .from("stock_info")
        .update({ sector: u.sector, updated_at: new Date().toISOString() })
        .eq("symbol", u.symbol);
    }
  }

  // ETF는 일괄 "ETF"로 설정
  const { error: etfErr } = await sb
    .from("stock_info")
    .update({ sector: "ETF", updated_at: new Date().toISOString() })
    .eq("market", "ETF")
    .is("sector", null);
  if (etfErr) console.log("  ETF 업데이트 오류:", etfErr.message);

  console.log(`\n완료: 성공 ${success}, 실패 ${failed}`);
}

main().catch(console.error);
