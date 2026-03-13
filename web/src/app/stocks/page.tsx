import { createServiceClient } from "@/lib/supabase";
import StockListClient from "@/components/stocks/stock-list-client";
import type { WatchlistGroup } from "@/types/stock";
import { extractSignalPrice } from "@/lib/signal-constants";

export const revalidate = 60;

export default async function StocksPage() {
  const supabase = createServiceClient();

  const [
    { data: rawFavorites },
    { data: rawStocks },
    { data: watchlistItems },
    { data: groupRows },
    { data: groupStockRows },
    { data: latestUpdate },
  ] = await Promise.all([
    supabase.from("stock_cache").select("*").eq("is_favorite", true).order("name"),
    supabase.from("stock_cache").select("*").order("name").limit(100),
    supabase.from("watchlist").select("symbol"),
    supabase.from("watchlist_groups").select("*").order("sort_order"),
    supabase.from("watchlist_group_stocks").select("group_id, symbol"),
    supabase.from("stock_cache").select("updated_at")
      .not("current_price", "is", null)
      .order("updated_at", { ascending: false }).limit(1).single(),
  ]);

  const watchlistSymbols = (watchlistItems ?? []).map((w) => w.symbol);
  const groups: WatchlistGroup[] = groupRows ?? [];

  // symbol → group_id[] 매핑 (다중 그룹 지원)
  const symbolGroups: Record<string, string[]> = {};
  for (const r of groupStockRows ?? []) {
    if (!symbolGroups[r.symbol]) symbolGroups[r.symbol] = [];
    symbolGroups[r.symbol].push(r.group_id);
  }

  const lastPriceUpdate = latestUpdate?.updated_at ?? null;
  const hasFavorites = (rawFavorites?.length ?? 0) > 0;

  // stock_info에서 이름 보완 (stock_cache에 코드값으로 잘못 저장된 종목 수정)
  const isCodeLike = (name: string, sym: string) => name === sym || /^\d{6}$/.test(name);
  let infoNameMap: Record<string, string> = {};

  const uniqueSymbols = [...new Set([
    ...(rawFavorites ?? []).map((f) => f.symbol as string),
    ...(rawStocks ?? []).map((s) => s.symbol as string),
  ])];

  if (uniqueSymbols.length > 0) {
    const { data: stockInfoNames } = await supabase
      .from("stock_info")
      .select("symbol, name")
      .in("symbol", uniqueSymbols);
    if (stockInfoNames) {
      infoNameMap = Object.fromEntries(
        stockInfoNames.map((s) => [s.symbol as string, s.name as string])
      );
    }
  }

  const fixName = <T extends { symbol: string; name: string }>(s: T): T =>
    isCodeLike(s.name, s.symbol) && infoNameMap[s.symbol]
      ? { ...s, name: infoNameMap[s.symbol] }
      : s;

  const favorites = (rawFavorites ?? []).map(fixName);
  const stocks = (rawStocks ?? []).map(fixName);

  // 신호 병합 (기존 로직 유지)
  const allSymbols = new Set<string>();
  favorites.forEach((f) => allSymbols.add(f.symbol));
  stocks.forEach((s) => allSymbols.add(s.symbol));

  let signalMap: Record<string, Record<string, { type: string; price: number | null }>> = {};

  if (allSymbols.size > 0) {
    const { data: signalRows } = await supabase
      .from("signals")
      .select("symbol, source, signal_type, raw_data, timestamp")
      .in("symbol", Array.from(allSymbols))
      .in("source", ["lassi", "stockbot", "quant"])
      .order("timestamp", { ascending: false })
      .limit(allSymbols.size * 9);

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
