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
  console.log("=== ETF 이름 수정 (네이버 개별 페이지 크롤링) ===\n");

  // DB에서 ETF 심볼 목록
  const { data: etfStocks } = await sb.from("stock_cache")
    .select("symbol, name")
    .eq("market", "ETF");

  if (!etfStocks || etfStocks.length === 0) {
    console.log("DB에 ETF 없음");
    return;
  }

  console.log(`ETF 총: ${etfStocks.length}개`);

  // 네이버 개별 종목 페이지에서 이름 크롤링
  let fixed = 0;
  let failed = 0;
  const BATCH = 10;

  for (let i = 0; i < etfStocks.length; i += BATCH) {
    const batch = etfStocks.slice(i, i + BATCH);

    const results = await Promise.allSettled(
      batch.map(async (etf) => {
        const pageUrl = `https://finance.naver.com/item/main.naver?code=${etf.symbol}`;
        const pageRes = await fetch(pageUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
        });

        // 네이버 금융 개별 종목 페이지는 UTF-8
        const html = await pageRes.text();

        // <title>에서 이름 추출: "종목명 : 네이버 금융"
        const titleMatch = html.match(/<title>\s*([^:<\n]+)/);
        if (titleMatch) {
          const name = titleMatch[1].trim();
          if (name && name.length > 1 && name !== etf.symbol) {
            return { symbol: etf.symbol, name };
          }
        }
        return null;
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        const { error } = await sb.from("stock_cache")
          .update({ name: r.value.name })
          .eq("symbol", r.value.symbol);
        if (!error) {
          fixed++;
          await sb.from("stock_info")
            .update({ name: r.value.name })
            .eq("symbol", r.value.symbol);
        }
      } else {
        failed++;
      }
    }

    process.stdout.write(`\r진행: ${Math.min(i + BATCH, etfStocks.length)}/${etfStocks.length} (수정: ${fixed}, 실패: ${failed})`);

    if (i + BATCH < etfStocks.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`\n\n완료: ${fixed}건 수정, ${failed}건 실패`);

  // 확인
  const { data: check } = await sb.from("stock_cache")
    .select("symbol, name")
    .eq("market", "ETF")
    .limit(15);
  console.log("\n=== 수정 후 ETF 샘플 ===");
  for (const e of check || []) console.log(`  ${e.symbol} ${e.name}`);
}

main().catch(console.error);
