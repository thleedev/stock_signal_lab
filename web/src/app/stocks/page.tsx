import { createServiceClient } from "@/lib/supabase";
import StockListClient from "@/components/stocks/stock-list-client";
import type { WatchlistGroup } from "@/types/stock";
import { extractSignalPrice } from "@/lib/signal-constants";

export const dynamic = 'force-dynamic';

/**
 * StockCache 타입이 실제로 쓰는 컬럼만 명시합니다.
 * stock_cache 는 47개 컬럼이라 select("*") 는 100행에 102KB 를 씁니다.
 *
 * 배열을 join()한 값은 런타임엔 동일한 문자열이어도 타입 레벨에서는
 * 리터럴이 아닌 `string`으로 넓혀져, postgrest-js의 select() 컬럼 파서가
 * 이를 파싱 불가로 보고 `GenericStringError`를 반환합니다.
 * 그래서 배열이 아닌 리터럴 문자열로 직접 선언합니다.
 */
const STOCK_COLUMNS = "symbol, name, market, current_price, price_change, price_change_pct, volume, market_cap, per, pbr, roe, eps, bps, dividend_yield, high_52w, low_52w, latest_signal_type, latest_signal_date, signal_count_30d, ai_score, is_holding, high_90d_pct, is_favorite, updated_at";

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
    supabase.from("stock_cache").select(STOCK_COLUMNS).eq("is_favorite", true).order("name"),
    supabase.from("stock_cache").select(STOCK_COLUMNS).order("name").limit(100),
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

  const favorites = (rawFavorites ?? []).map(fixName);
  const stocks = (rawStocks ?? []).map(fixName);

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
