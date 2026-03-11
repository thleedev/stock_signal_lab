/**
 * 투자시황 지표 수동 수집
 * 실행: cd web && npx tsx scripts/fetch-market-indicators.ts
 */
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

const YAHOO_TICKERS: Record<string, string> = {
  VIX: "^VIX",
  USD_KRW: "KRW=X",
  US_10Y: "^TNX",
  WTI: "CL=F",
  KOSPI: "^KS11",
  KOSDAQ: "^KQ11",
  GOLD: "GC=F",
  DXY: "DX-Y.NYB",
};

async function getYahooQuote(ticker: string): Promise<{ price: number; name: string; previousClose: number } | null> {
  try {
    // Yahoo Finance v8 API
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      },
    });

    if (!res.ok) {
      console.log(`  ${ticker}: HTTP ${res.status}`);
      return null;
    }

    const json = await res.json();
    const meta = json.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;

    return {
      price: meta.regularMarketPrice,
      previousClose: meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPrice,
      name: meta.shortName ?? meta.symbol ?? ticker,
    };
  } catch (e) {
    console.log(`  ${ticker}: 오류 - ${(e as Error).message}`);
    return null;
  }
}

async function main() {
  console.log("=== 투자시황 지표 수집 ===\n");

  const today = new Date().toISOString().slice(0, 10);
  const results: Record<string, number> = {};
  let collected = 0;

  for (const [type, ticker] of Object.entries(YAHOO_TICKERS)) {
    const quote = await getYahooQuote(ticker);
    if (!quote) {
      console.log(`  ${type} (${ticker}): 실패`);
      continue;
    }

    console.log(`  ${type}: ${quote.price} (${quote.name})`);

    // 전일 값 조회
    const { data: prev } = await sb
      .from("market_indicators")
      .select("value")
      .eq("indicator_type", type)
      .lt("date", today)
      .order("date", { ascending: false })
      .limit(1)
      .single();

    const prevValue = prev ? Number(prev.value) : quote.previousClose;
    const changePct = prevValue ? ((quote.price - prevValue) / prevValue) * 100 : 0;

    const { error } = await sb.from("market_indicators").upsert(
      {
        date: today,
        indicator_type: type,
        value: quote.price,
        prev_value: prevValue,
        change_pct: changePct,
        raw_data: { name: quote.name, previousClose: quote.previousClose },
      },
      { onConflict: "date,indicator_type" }
    );

    if (error) {
      console.log(`  ${type} DB 오류:`, error.message);
    } else {
      results[type] = quote.price;
      collected++;
    }
  }

  console.log(`\n지표 ${collected}개 수집 완료`);

  // 종합 점수 계산
  if (collected > 0) {
    const { data: weights } = await sb.from("indicator_weights").select("*");

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const sinceDate = ninetyDaysAgo.toISOString().slice(0, 10);

    const breakdown: Record<string, { normalized: number; weight: number }> = {};
    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const type of Object.keys(results)) {
      const { data: history } = await sb
        .from("market_indicators")
        .select("value")
        .eq("indicator_type", type)
        .gte("date", sinceDate);

      const w = (weights || []).find((x: Record<string, unknown>) => x.indicator_type === type);
      const weight = w?.weight ?? 1;
      const direction = w?.direction ?? 1;

      if (history && history.length > 0) {
        const values = history.map((h: { value: number }) => Number(h.value));
        const min = Math.min(...values);
        const max = Math.max(...values);
        let normalized = max !== min
          ? ((results[type] - min) / (max - min)) * 100
          : 50;

        // direction이 -1이면 반전 (VIX 등)
        if (direction === -1) normalized = 100 - normalized;

        breakdown[type] = { normalized, weight };
        totalWeightedScore += normalized * weight;
        totalWeight += weight;
      }
    }

    const totalScore = totalWeight > 0 ? totalWeightedScore / totalWeight : 50;
    console.log(`\n종합 점수: ${totalScore.toFixed(1)}`);

    // 점수 히스토리 저장
    const weightsSnapshot: Record<string, number> = {};
    for (const w of (weights || []) as Array<{ indicator_type: string; weight: number }>) {
      weightsSnapshot[w.indicator_type] = w.weight;
    }

    const { error } = await sb.from("market_score_history").upsert(
      {
        date: today,
        total_score: Math.round(totalScore * 100) / 100,
        breakdown,
        weights_snapshot: weightsSnapshot,
      },
      { onConflict: "date" }
    );

    if (error) console.log("점수 저장 오류:", error.message);
    else console.log("점수 히스토리 저장 완료");

    // 공포탐욕 지수 저장
    if (breakdown["VIX"]) {
      const fearGreed = breakdown["VIX"].normalized;
      await sb.from("market_indicators").upsert(
        {
          date: today,
          indicator_type: "FEAR_GREED",
          value: fearGreed,
          raw_data: { method: "vix_based" },
        },
        { onConflict: "date,indicator_type" }
      );
      console.log(`공포탐욕 지수: ${fearGreed.toFixed(1)}`);
    }
  }
}

main().catch(console.error);
