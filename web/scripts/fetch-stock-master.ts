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

interface KrxStock {
  ISU_SRT_CD: string;   // 단축코드 (6자리)
  ISU_ABBRV: string;    // 종목 약칭
  MKT_NM: string;       // 시장 (KOSPI/KOSDAQ)
  SECT_TP_NM?: string;  // 섹터
}

async function fetchKrxStocks(): Promise<KrxStock[]> {
  // KRX data.krx.co.kr - 종목 finder API
  const url = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";

  const allStocks: KrxStock[] = [];

  // STK=KOSPI, KSQ=KOSDAQ
  for (const mktsel of ["STK", "KSQ"]) {
    const marketName = mktsel === "STK" ? "KOSPI" : "KOSDAQ";

    const formData = new URLSearchParams();
    formData.append("bld", "dbms/comm/finder/finder_stkisu");
    formData.append("locale", "ko_KR");
    formData.append("mktsel", mktsel);
    formData.append("typeNo", "0");
    formData.append("searchText", "");

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "Referer": "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd",
      },
      body: formData.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`KRX API 실패 (${mktsel}): ${res.status} - ${text.slice(0, 200)}`);
      continue;
    }

    const json = await res.json();
    // finder API: block1 배열
    const block = json.block1 || json.OutBlock_1 || [];
    const items: KrxStock[] = block.map((item: Record<string, string>) => ({
      ISU_SRT_CD: item.short_code || item.ISU_SRT_CD || "",
      ISU_ABBRV: item.codeName || item.ISU_ABBRV || "",
      MKT_NM: marketName,
      SECT_TP_NM: item.SECT_TP_NM || null,
    }));

    allStocks.push(...items);
    console.log(`${marketName}: ${items.length}개 종목`);
  }

  // 숫자 코드만 (ETF/ETN 등 영문 코드 제외), 6자리
  const filtered = allStocks.filter((s) => /^\d{6}$/.test(s.ISU_SRT_CD) && s.ISU_ABBRV);

  // ETF 추가 (네이버 금융 API - KRX finder는 ETF를 미제공)
  try {
    const existingCodes = new Set(filtered.map((s) => s.ISU_SRT_CD));
    const etfUrl = "https://finance.naver.com/api/sise/etfItemList.nhn?etfType=0&targetColumn=market_sum&sortOrder=desc&page=1&pageSize=2000";
    const etfRes = await fetch(etfUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Referer: "https://finance.naver.com/sise/etf.naver",
      },
    });

    if (etfRes.ok) {
      // 네이버 API는 EUC-KR 인코딩
      const etfBuf = await etfRes.arrayBuffer();
      const etfText = new TextDecoder("euc-kr").decode(etfBuf);
      const etfJson = JSON.parse(etfText);
      const etfList = etfJson.result?.etfItemList || [];
      const etfItems: KrxStock[] = etfList
        .map((item: Record<string, string>) => ({
          ISU_SRT_CD: String(item.itemcode || "").trim(),
          ISU_ABBRV: String(item.itemname || "").trim(),
          MKT_NM: "ETF",
          SECT_TP_NM: null,
        }))
        .filter((s: KrxStock) => /^\d{6}$/.test(s.ISU_SRT_CD) && s.ISU_ABBRV && !existingCodes.has(s.ISU_SRT_CD));

      filtered.push(...etfItems);
      console.log(`ETF: ${etfItems.length}개 종목 (네이버)`);
    } else {
      console.log("네이버 ETF API 실패, 건너뜁니다");
    }
  } catch {
    console.log("ETF 조회 실패, 건너뜁니다");
  }

  return filtered;
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
