/**
 * KRX 전종목 마스터 데이터 수집 → stock_info + stock_cache 초기화
 *
 * 실행: npx tsx scripts/fetch-stock-master.ts
 *
 * KRX data.krx.co.kr 에서 KOSPI/KOSDAQ 종목 목록을 가져와
 * Supabase stock_info 및 stock_cache 테이블에 upsert합니다.
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// .env.local 수동 파싱
const envPath = path.resolve(__dirname, "../web/.env.local");
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

interface KrxStock {
  ISU_SRT_CD: string;   // 단축코드 (6자리)
  ISU_ABBRV: string;    // 종목 약칭
  MKT_NM: string;       // 시장 (KOSPI/KOSDAQ)
  SECT_TP_NM?: string;  // 섹터
}

async function fetchKrxStocks(): Promise<KrxStock[]> {
  // KRX data.krx.co.kr POST API - 전종목 기본정보
  const url = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";

  const allStocks: KrxStock[] = [];

  for (const mktId of ["STK", "KSQ"]) {
    // STK = KOSPI, KSQ = KOSDAQ
    const formData = new URLSearchParams();
    formData.append("bld", "dbms/MDC/STAT/standard/MDCSTAT01901");
    formData.append("locale", "ko_KR");
    formData.append("mktId", mktId);
    formData.append("share", "1");
    formData.append("csvxls_is498No", "");

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020201",
      },
      body: formData.toString(),
    });

    if (!res.ok) {
      console.error(`KRX API 실패 (${mktId}): ${res.status}`);
      continue;
    }

    const json = await res.json();
    const items: KrxStock[] = (json.OutBlock_1 || []).map((item: Record<string, string>) => ({
      ISU_SRT_CD: item.ISU_SRT_CD,
      ISU_ABBRV: item.ISU_ABBRV,
      MKT_NM: mktId === "STK" ? "KOSPI" : "KOSDAQ",
      SECT_TP_NM: item.SECT_TP_NM || null,
    }));

    allStocks.push(...items);
    console.log(`${mktId === "STK" ? "KOSPI" : "KOSDAQ"}: ${items.length}개 종목`);
  }

  // 숫자 코드만 (ETF/ETN 등 영문 코드 제외)
  return allStocks.filter((s) => /^\d{6}$/.test(s.ISU_SRT_CD));
}

async function upsertToSupabase(stocks: KrxStock[]) {
  const BATCH_SIZE = 500;

  // 1. stock_info upsert
  console.log("\n=== stock_info 테이블 업데이트 ===");
  let infoCount = 0;
  for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
    const batch = stocks.slice(i, i + BATCH_SIZE).map((s) => ({
      symbol: s.ISU_SRT_CD,
      name: s.ISU_ABBRV,
      market: s.MKT_NM,
      sector: s.SECT_TP_NM || null,
    }));

    const { error } = await supabase
      .from("stock_info")
      .upsert(batch, { onConflict: "symbol" });

    if (error) {
      console.error(`stock_info batch ${i} 오류:`, error.message);
    } else {
      infoCount += batch.length;
    }
  }
  console.log(`stock_info: ${infoCount}건 upsert 완료`);

  // 2. stock_cache upsert
  console.log("\n=== stock_cache 테이블 업데이트 ===");
  let cacheCount = 0;
  for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
    const batch = stocks.slice(i, i + BATCH_SIZE).map((s) => ({
      symbol: s.ISU_SRT_CD,
      name: s.ISU_ABBRV,
      market: s.MKT_NM,
    }));

    const { error } = await supabase
      .from("stock_cache")
      .upsert(batch, { onConflict: "symbol", ignoreDuplicates: true });

    if (error) {
      console.error(`stock_cache batch ${i} 오류:`, error.message);
    } else {
      cacheCount += batch.length;
    }
  }
  console.log(`stock_cache: ${cacheCount}건 upsert 완료`);
}

async function main() {
  console.log("=== KRX 전종목 마스터 데이터 수집 시작 ===\n");

  const stocks = await fetchKrxStocks();
  console.log(`\n총 ${stocks.length}개 종목 수집 완료`);

  if (stocks.length === 0) {
    console.error("종목 데이터가 없습니다. KRX API를 확인해주세요.");
    process.exit(1);
  }

  await upsertToSupabase(stocks);

  console.log("\n=== 완료 ===");
}

main().catch((e) => {
  console.error("오류 발생:", e);
  process.exit(1);
});
