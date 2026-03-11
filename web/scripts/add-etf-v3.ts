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

interface EtfItem {
  symbol: string;
  name: string;
}

async function fetchNaverEtfList(): Promise<EtfItem[]> {
  const etfs: EtfItem[] = [];
  const seen = new Set<string>();

  // 네이버 금융 ETF 목록 (국내 ETF)
  // 페이지별로 조회
  for (let page = 1; page <= 20; page++) {
    const url = `https://finance.naver.com/api/sise/etfItemList.nhn?etfType=0&targetColumn=market_sum&sortOrder=desc&page=${page}&pageSize=100`;

    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          Referer: "https://finance.naver.com/sise/etf.naver",
        },
      });

      if (!res.ok) {
        console.log(`네이버 ETF page ${page}: HTTP ${res.status}`);
        break;
      }

      // 네이버 API는 EUC-KR 인코딩 → ArrayBuffer로 받아서 디코딩
      const buf = await res.arrayBuffer();
      const text = new TextDecoder("euc-kr").decode(buf);
      const json = JSON.parse(text);
      const items = json.result?.etfItemList || [];

      if (items.length === 0) break;

      for (const item of items) {
        const code = String(item.itemcode || "").trim();
        const name = String(item.itemname || "").trim();
        if (/^\d{6}$/.test(code) && name && !seen.has(code)) {
          seen.add(code);
          etfs.push({ symbol: code, name });
        }
      }

      console.log(`  page ${page}: ${items.length}개 (누적: ${etfs.length})`);

      if (items.length < 100) break;
    } catch (e) {
      console.log(`네이버 page ${page} 오류:`, (e as Error).message);
      break;
    }
  }

  return etfs;
}

async function fetchNaverEtfListHtml(): Promise<EtfItem[]> {
  // HTML 파싱 방식 (API 실패 시 대안)
  const etfs: EtfItem[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= 20; page++) {
    const url = `https://finance.naver.com/sise/etf.naver?&page=${page}`;
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
      });
      const html = await res.text();

      // 정규식으로 ETF 코드와 이름 추출
      const regex = /\/item\/main\.naver\?code=(\d{6})[^>]*>([^<]+)</g;
      let match;
      let count = 0;
      while ((match = regex.exec(html)) !== null) {
        const code = match[1];
        const name = match[2].trim();
        if (!seen.has(code) && name) {
          seen.add(code);
          etfs.push({ symbol: code, name });
          count++;
        }
      }

      if (count === 0) break;
      console.log(`  HTML page ${page}: ${count}개 (누적: ${etfs.length})`);
    } catch (e) {
      console.log(`HTML page ${page} 오류:`, (e as Error).message);
      break;
    }
  }

  return etfs;
}

async function main() {
  console.log("=== 네이버 금융 ETF 데이터 수집 ===\n");

  // 방법 1: API
  console.log("방법 1: 네이버 API...");
  let etfList = await fetchNaverEtfList();

  // 방법 2: HTML 파싱 (API 실패 시)
  if (etfList.length === 0) {
    console.log("\n방법 2: 네이버 HTML 파싱...");
    etfList = await fetchNaverEtfListHtml();
  }

  if (etfList.length === 0) {
    console.log("ETF 데이터를 가져올 수 없습니다.");
    return;
  }

  console.log(`\nETF 총 ${etfList.length}개 수집`);
  console.log("샘플:", etfList.slice(0, 5).map(e => `${e.symbol} ${e.name}`).join(", "));

  // 기존 KOSPI/KOSDAQ 심볼 조회 (충돌 방지)
  const { data: existing } = await sb
    .from("stock_cache")
    .select("symbol")
    .in("market", ["KOSPI", "KOSDAQ"]);
  const existingSet = new Set((existing ?? []).map((s) => s.symbol));

  const etfs = etfList.filter((s) => !existingSet.has(s.symbol));
  const conflictCount = etfList.length - etfs.length;
  if (conflictCount > 0) {
    console.log(`KOSPI/KOSDAQ 충돌: ${conflictCount}개 제외`);
  }
  console.log(`최종 추가 대상: ${etfs.length}개`);

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
  const { count: kospi } = await sb.from("stock_cache").select("*", { count: "exact", head: true }).eq("market", "KOSPI");
  const { count: kosdaq } = await sb.from("stock_cache").select("*", { count: "exact", head: true }).eq("market", "KOSDAQ");
  console.log(`\n최종: 총 ${total} | KOSPI: ${kospi} | KOSDAQ: ${kosdaq} | ETF: ${count}`);
}

main().catch(console.error);
