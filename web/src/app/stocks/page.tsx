import { createServiceClient } from "@/lib/supabase";
import StockListClient from "@/components/stocks/stock-list-client";

export const dynamic = "force-dynamic";

export default async function StocksPage() {
  const supabase = createServiceClient();

  const { data: favorites } = await supabase
    .from("stock_cache")
    .select("*")
    .eq("is_favorite", true)
    .order("name");

  const { data: stocks } = await supabase
    .from("stock_cache")
    .select("*")
    .order("name")
    .limit(100);

  // 초기 로딩용: 즐겨찾기 + 첫 페이지 종목의 소스별 최신 신호 조회
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

  // 포트 종목 심볼 조회 (팝업 메뉴용)
  const { data: watchlistItems } = await supabase
    .from("watchlist")
    .select("symbol");
  const watchlistSymbols = (watchlistItems ?? []).map((w) => w.symbol);

  // 가격 업데이트 시간 (가장 최근 updated_at)
  const { data: latestUpdate } = await supabase
    .from("stock_cache")
    .select("updated_at")
    .not("current_price", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();
  const lastPriceUpdate = latestUpdate?.updated_at ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">전 종목</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          전체 종목 리스트 및 관심종목 관리
        </p>
      </div>
      <StockListClient
        initialStocks={mergeSignals(stocks)}
        favorites={mergeSignals(favorites)}
        watchlistSymbols={watchlistSymbols}
        lastPriceUpdate={lastPriceUpdate}
      />
    </div>
  );
}
