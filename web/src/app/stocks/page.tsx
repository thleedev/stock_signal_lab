import { createServiceClient } from "@/lib/supabase";
import StockListClient from "@/components/stocks/stock-list-client";
import type { WatchlistGroup } from "@/types/stock";
import { extractSignalPrice } from "@/lib/signal-constants";
import { fetchAllStockPrices, type StockPriceData } from "@/lib/naver-stock-api";

export const dynamic = 'force-dynamic';

/** 장중(KST 08~20시, 평일) 여부 */
function isMarketHours() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const h = kst.getUTCHours();
  const d = kst.getUTCDay();
  return d >= 1 && d <= 5 && h >= 8 && h < 20;
}

/** 타임아웃 래퍼 — 지정 시간 내 실패 시 빈 Map 반환 */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export default async function StocksPage() {
  const supabase = createServiceClient();

  // 네이버 실시간 가격 요청을 DB 쿼리와 병렬로 시작 (장중에만, 4초 타임아웃)
  const livePricePromise = isMarketHours()
    ? withTimeout(fetchAllStockPrices(), 4000, new Map<string, StockPriceData>())
    : Promise.resolve(new Map<string, StockPriceData>());

  const [
    { data: rawFavorites },
    { data: rawStocks },
    { data: watchlistItems },
    { data: groupRows },
    { data: groupStockRows },
    { data: latestUpdate },
    livePrices,
  ] = await Promise.all([
    supabase.from("stock_cache").select("*").eq("is_favorite", true).order("name"),
    supabase.from("stock_cache").select("*").order("name").limit(100),
    supabase.from("watchlist").select("symbol"),
    supabase.from("watchlist_groups").select("*").order("sort_order"),
    supabase.from("watchlist_group_stocks").select("group_id, symbol"),
    supabase.from("stock_cache").select("updated_at")
      .not("current_price", "is", null)
      .order("updated_at", { ascending: false }).limit(1).single(),
    livePricePromise,
  ]);

  const watchlistSymbols = (watchlistItems ?? []).map((w) => w.symbol);
  const groups: WatchlistGroup[] = groupRows ?? [];

  // symbol → group_id[] 매핑 (다중 그룹 지원)
  const symbolGroups: Record<string, string[]> = {};
  for (const r of groupStockRows ?? []) {
    if (!symbolGroups[r.symbol]) symbolGroups[r.symbol] = [];
    symbolGroups[r.symbol].push(r.group_id);
  }

  // 실시간 가격이 있으면 stock_cache 데이터에 머지
  const hasLive = livePrices.size > 0;
  const applyLive = <T extends Record<string, unknown>>(row: T): T => {
    if (!hasLive) return row;
    const live = livePrices.get(row.symbol as string);
    if (!live) return row;
    return {
      ...row,
      current_price: live.current_price,
      price_change: live.price_change,
      price_change_pct: live.price_change_pct,
      volume: live.volume > 0 ? live.volume : row.volume,
      market_cap: live.market_cap || row.market_cap,
    };
  };

  const lastPriceUpdate = latestUpdate?.updated_at ?? null;
  const hasFavorites = (rawFavorites?.length ?? 0) > 0;

  // stock_info에서 이름 보완 (stock_cache에 코드값으로 잘못 저장된 종목 수정)
  const isCodeLike = (name: string, sym: string) => name === sym || /^\d{6}$/.test(name);
  let infoNameMap: Record<string, string> = {};

  const uniqueSymbols = [...new Set([
    ...(rawFavorites ?? []).map((f) => f.symbol as string),
    ...(rawStocks ?? []).map((s) => s.symbol as string),
  ])];

  // 이름 보완 + 신호 조회를 병렬 처리
  const signalMap: Record<string, Record<string, { type: string; price: number | null }>> = {};

  if (uniqueSymbols.length > 0) {
    const [{ data: stockInfoNames }, { data: signalRows }] = await Promise.all([
      supabase.from("stock_info").select("symbol, name").in("symbol", uniqueSymbols),
      supabase
        .from("signals")
        .select("symbol, source, signal_type, raw_data, timestamp")
        .in("symbol", uniqueSymbols)
        .in("source", ["lassi", "stockbot", "quant"])
        .order("timestamp", { ascending: false })
        .limit(uniqueSymbols.length * 9),
    ]);

    if (stockInfoNames) {
      infoNameMap = Object.fromEntries(
        stockInfoNames.map((s) => [s.symbol as string, s.name as string])
      );
    }

    if (signalRows) {
      for (const row of signalRows) {
        const sym = row.symbol as string;
        const src = row.source as string;
        if (!sym) continue;
        if (!signalMap[sym]) signalMap[sym] = {};
        if (!signalMap[sym][src]) {
          signalMap[sym][src] = {
            type: row.signal_type,
            price: extractSignalPrice(row.raw_data as Record<string, unknown> | null),
          };
        }
      }
    }
  }

  const fixName = <T extends { symbol: string; name: string }>(s: T): T =>
    isCodeLike(s.name, s.symbol) && infoNameMap[s.symbol]
      ? { ...s, name: infoNameMap[s.symbol] }
      : s;

  const favorites = (rawFavorites ?? []).map(fixName).map(applyLive);
  const stocks = (rawStocks ?? []).map(fixName).map(applyLive);

  const emptySignal = { type: null, price: null };
  const mergeSignals = (list: typeof stocks) =>
    list.map((s) => ({
      ...s,
      signals: {
        lassi: signalMap[s.symbol]?.lassi ?? emptySignal,
        stockbot: signalMap[s.symbol]?.stockbot ?? emptySignal,
        quant: signalMap[s.symbol]?.quant ?? emptySignal,
      },
    }));

  return (
    <StockListClient
      initialStocks={mergeSignals(stocks)}
      favorites={mergeSignals(favorites)}
      watchlistSymbols={watchlistSymbols}
      lastPriceUpdate={lastPriceUpdate}
      groups={groups}
      symbolGroups={symbolGroups}
      hasFavorites={hasFavorites}
    />
  );
}
