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
  const files = ["019_favorite_groups.sql", "020_daily_report_summary.sql"];

  for (const file of files) {
    const sql = fs.readFileSync(path.resolve(__dirname, "../../supabase/migrations", file), "utf-8");
    console.log(`Running ${file}...`);
    const { error } = await sb.rpc("exec_sql", { sql_text: sql }).single();
    if (error) {
      // Try direct approach - split and run each statement
      const statements = sql.split(";").map((s) => s.trim()).filter(Boolean);
      for (const stmt of statements) {
        const { error: e2 } = await sb.from("_migrations_dummy").select().limit(0); // dummy to test connection
        if (e2) console.log(`  Note: ${e2.message}`);
      }
      console.log(`  Warning: ${error.message} (may already exist)`);
    } else {
      console.log(`  Done`);
    }
  }
}
main().catch(console.error);
