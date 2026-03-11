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

async function fetchEtfList(): Promise<Array<{ symbol: string; name: string }>> {
  const url = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";

  // 방법 1: ETF 전종목 시세 (최근 영업일 여러 개 시도)
  const today = new Date();
  for (let offset = 0; offset < 7; offset++) {
    const d = new Date(today);
    d.setDate(d.getDate() - offset);
    const trdDd = d.toISOString().slice(0, 10).replace(/-/g, "");

    const form = new URLSearchParams();
    form.append("bld", "dbms/MDC/STAT/standard/MDCSTAT04301");
    form.append("locale", "ko_KR");
    form.append("trdDd", trdDd);
    form.append("share", "1");
    form.append("money", "1");
    form.append("csvxls_is498No", "");

    console.log(`시도: ${trdDd}`);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Referer: "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020101",
          Accept: "application/json, text/javascript, */*; q=0.01",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: form.toString(),
      });

      if (!res.ok) {
        console.log(`  ${trdDd} → HTTP ${res.status}`);
        continue;
      }

      const json = await res.json();
      const block = (json.output || json.OutBlock_1 || []) as Array<Record<string, string>>;

      if (block.length > 0) {
        console.log(`✓ ${trdDd}: ETF ${block.length}개`);
        console.log("  샘플 키:", Object.keys(block[0]).join(", "));
        console.log("  샘플:", JSON.stringify(block[0]).slice(0, 200));

        return block.map((item) => {
          const symbol = (item.ISU_SRT_CD || item.ISU_CD || "").replace(/[^0-9]/g, "");
          const name = item.ISU_ABBRV || item.ISU_NM || "";
          return { symbol, name };
        }).filter((s) => /^\d{6}$/.test(s.symbol) && s.name);
      }

      // 데이터가 비었지만 다른 키에 있을 수 있음
      for (const key of Object.keys(json)) {
        const val = json[key];
        if (Array.isArray(val) && val.length > 0) {
          console.log(`  키 '${key}': ${val.length}개`);
          console.log("  샘플:", JSON.stringify(val[0]).slice(0, 200));
          return val.map((item: Record<string, string>) => {
            const symbol = (item.ISU_SRT_CD || item.ISU_CD || item.short_code || "").replace(/[^0-9]/g, "");
            const name = item.ISU_ABBRV || item.ISU_NM || item.codeName || "";
            return { symbol, name };
          }).filter((s: { symbol: string; name: string }) => /^\d{6}$/.test(s.symbol) && s.name);
        }
      }
      console.log(`  ${trdDd} → 데이터 없음 (키: ${Object.keys(json).join(", ")})`);
    } catch (e) {
      console.log(`  ${trdDd} → 오류:`, (e as Error).message);
    }
  }

  // 방법 2: ETF 종목찾기 (finder_etfisu)
  console.log("\n방법 2: ETF 종목찾기...");
  const finderForm = new URLSearchParams();
  finderForm.append("bld", "dbms/comm/finder/finder_etfisu");
  finderForm.append("locale", "ko_KR");
  finderForm.append("mktsel", "ALL");
  finderForm.append("searchText", "");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Referer: "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd",
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: finderForm.toString(),
    });

    if (res.ok) {
      const json = await res.json();
      console.log("ETF finder 응답 키:", Object.keys(json));
      for (const key of Object.keys(json)) {
        const val = json[key];
        if (Array.isArray(val) && val.length > 0) {
          console.log(`  ${key}: ${val.length}개`);
          console.log("  샘플 키:", Object.keys(val[0]).join(", "));
          console.log("  샘플:", JSON.stringify(val[0]).slice(0, 200));
          return val.map((item: Record<string, string>) => {
            const symbol = (item.short_code || item.ISU_SRT_CD || "").replace(/[^0-9]/g, "");
            const name = item.codeName || item.ISU_ABBRV || "";
            return { symbol, name };
          }).filter((s: { symbol: string; name: string }) => /^\d{6}$/.test(s.symbol) && s.name);
        }
      }
    } else {
      console.log("ETF finder → HTTP", res.status);
    }
  } catch (e) {
    console.log("ETF finder 오류:", (e as Error).message);
  }

  // 방법 3: 종목찾기에서 ETF 타입 (typeNo=4)
  console.log("\n방법 3: finder_stkisu typeNo 테스트...");
  for (const typeNo of ["4", "5", "6", "3"]) {
    const f = new URLSearchParams();
    f.append("bld", "dbms/comm/finder/finder_stkisu");
    f.append("locale", "ko_KR");
    f.append("mktsel", "ALL");
    f.append("typeNo", typeNo);
    f.append("searchText", "");

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "User-Agent": "Mozilla/5.0",
          Referer: "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd",
        },
        body: f.toString(),
      });
      if (res.ok) {
        const json = await res.json();
        const block = json.block1 || [];
        if (block.length > 0) {
          console.log(`  typeNo=${typeNo}: ${block.length}개, 샘플: ${block[0].codeName || block[0].short_code}`);
        } else {
          console.log(`  typeNo=${typeNo}: 빈 응답`);
        }
      }
    } catch (e) {
      console.log(`  typeNo=${typeNo}: 오류`);
    }
  }

  return [];
}

async function main() {
  console.log("=== KRX ETF 데이터 수집 ===\n");

  const etfList = await fetchEtfList();

  if (etfList.length === 0) {
    console.log("\nETF 데이터를 가져올 수 없습니다.");
    return;
  }

  console.log(`\nETF 총 ${etfList.length}개 수집`);

  // 기존 KOSPI/KOSDAQ 심볼 조회 (충돌 방지)
  const { data: existing } = await sb
    .from("stock_cache")
    .select("symbol")
    .in("market", ["KOSPI", "KOSDAQ"]);
  const existingSet = new Set((existing ?? []).map((s) => s.symbol));

  const etfs = etfList.filter((s) => !existingSet.has(s.symbol));
  console.log(`KOSPI/KOSDAQ 충돌 제외: ${etfList.length - etfs.length}개 → 최종 ${etfs.length}개`);

  if (etfs.length === 0) {
    console.log("추가할 ETF 없음");
    return;
  }

  // stock_cache 삽입
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < etfs.length; i += BATCH) {
    const batch = etfs.slice(i, i + BATCH).map((e) => ({
      symbol: e.symbol,
      name: e.name,
      market: "ETF",
    }));
    const { error } = await sb.from("stock_cache").upsert(batch, { onConflict: "symbol" });
    if (error) console.error(`batch ${i}:`, error.message);
    else inserted += batch.length;
  }
  console.log(`stock_cache ETF ${inserted}건 추가`);

  // stock_info에도 추가
  let infoInserted = 0;
  for (let i = 0; i < etfs.length; i += BATCH) {
    const batch = etfs.slice(i, i + BATCH).map((e) => ({
      symbol: e.symbol,
      name: e.name,
      market: "ETF",
      sector: null,
    }));
    const { error } = await sb.from("stock_info").upsert(batch, { onConflict: "symbol" });
    if (error) console.error(`stock_info batch ${i}:`, error.message);
    else infoInserted += batch.length;
  }
  console.log(`stock_info ETF ${infoInserted}건 추가`);

  // 확인
  const { count } = await sb.from("stock_cache").select("*", { count: "exact", head: true }).eq("market", "ETF");
  const { count: total } = await sb.from("stock_cache").select("*", { count: "exact", head: true });
  console.log(`\n최종: 총 ${total} | ETF: ${count}`);
}

main().catch(console.error);
