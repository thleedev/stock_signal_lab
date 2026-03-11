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
  const { count: total } = await sb.from("stock_cache").select("*", { count: "exact", head: true });
  const { count: kospi } = await sb.from("stock_cache").select("*", { count: "exact", head: true }).eq("market", "KOSPI");
  const { count: kosdaq } = await sb.from("stock_cache").select("*", { count: "exact", head: true }).eq("market", "KOSDAQ");
  const { count: etf } = await sb.from("stock_cache").select("*", { count: "exact", head: true }).eq("market", "ETF");
  const { count: priced } = await sb.from("stock_cache").select("*", { count: "exact", head: true }).not("current_price", "is", null);
  console.log(`총: ${total} | KOSPI: ${kospi} | KOSDAQ: ${kosdaq} | ETF: ${etf} | 가격있음: ${priced}`);
}

main().catch(console.error);
