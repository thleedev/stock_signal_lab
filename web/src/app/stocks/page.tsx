import { createServiceClient } from "@/lib/supabase";
import StockListClient from "@/components/stocks/stock-list-client";
import type { WatchlistGroup } from "@/types/stock";

export const revalidate = 60;

export default async function StocksPage() {
  const supabase = createServiceClient();

  const [
    { data: favorites },
    { data: stocks },
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
  const hasFavorites = (favorites?.length ?? 0) > 0;

  // 신호 병합 (기존 로직 유지)
  const allSymbols = new Set<string>();
  favorites?.forEach((f) => allSymbols.add(f.symbol));
  stocks?.forEach((s) => allSymbols.add(s.symbol));

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
          const raw = row.raw_data as Record<string, unknown> | null;
          let price: number | null = null;
          if (raw) {
            const sp = raw.signal_price as number | undefined;
            if (sp && sp > 0) price = sp;
            else {
              const rp = raw.recommend_price as number | undefined;
              if (rp && rp > 0) price = rp;
              else {
                const bp = raw.buy_price as number | undefined;
                if (bp && bp > 0) price = bp;
                else {
                  const slp = raw.sell_price as number | undefined;
                  if (slp && slp > 0) price = slp;
                }
              }
            }
          }
          signalMap[sym][src] = { type: row.signal_type, price };
        }
      }
    }
  }

  const emptySignal = { type: null, price: null };
  const mergeSignals = (list: typeof stocks) =>
    (list ?? []).map((s) => ({
      ...s,
      signals: {
        lassi: signalMap[s.symbol]?.lassi ?? emptySignal,
        stockbot: signalMap[s.symbol]?.stockbot ?? emptySignal,
        quant: signalMap[s.symbol]?.quant ?? emptySignal,
      },
    }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">종목</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          관심종목 그룹 관리 및 전체 종목 조회
        </p>
      </div>
      <StockListClient
        initialStocks={mergeSignals(stocks)}
        favorites={mergeSignals(favorites)}
        watchlistSymbols={watchlistSymbols}
        lastPriceUpdate={lastPriceUpdate}
        groups={groups}
        symbolGroups={symbolGroups}
        hasFavorites={hasFavorites}
      />
    </div>
  );
}
