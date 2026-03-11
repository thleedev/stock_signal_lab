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

async function main() {
  // 1. favorite_stocks에 group_name 추가 (이미 있으면 무시)
  try {
    const { error } = await sb.from("favorite_stocks").select("group_name").limit(1);
    if (error) {
      console.log("group_name 컬럼 추가 필요 - Supabase 대시보드에서 SQL 실행:");
      console.log("ALTER TABLE favorite_stocks ADD COLUMN group_name TEXT DEFAULT '기본';");
    } else {
      console.log("favorite_stocks.group_name: 이미 존재");
    }
  } catch (e) {
    console.log("check failed:", e);
  }

  // 2. daily_report_summary 테이블 확인
  const { error: e2 } = await sb.from("daily_report_summary").select("date").limit(1);
  if (e2) {
    console.log("daily_report_summary 테이블 필요 - Supabase 대시보드에서 SQL 실행:");
    console.log(`CREATE TABLE daily_report_summary (
  date DATE PRIMARY KEY,
  total_signals INTEGER DEFAULT 0,
  buy_signals INTEGER DEFAULT 0,
  sell_signals INTEGER DEFAULT 0,
  source_breakdown JSONB DEFAULT '{}',
  top_buy_stocks JSONB DEFAULT '[]',
  top_sell_stocks JSONB DEFAULT '[]',
  market_score NUMERIC(5,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);`);
  } else {
    console.log("daily_report_summary: 이미 존재");
  }
}
main().catch(console.error);
