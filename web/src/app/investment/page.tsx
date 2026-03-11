import { createServiceClient } from "@/lib/supabase";
import InvestmentClient from "@/components/investment/investment-client";
import type { StockCache } from "@/types/stock";

export const dynamic = "force-dynamic";

export default async function InvestmentPage() {
  const supabase = createServiceClient();

  const { data: watchlist } = await supabase
    .from("watchlist")
    .select("*")
    .order("sort_order");

  // 워치리스트 종목들의 캐시 데이터 조회
  const symbols = (watchlist ?? []).map((w) => w.symbol);
  let stockData: Record<string, StockCache> = {};

  if (symbols.length > 0) {
    const { data: stocks } = await supabase
      .from("stock_cache")
      .select("*")
      .in("symbol", symbols);

    if (stocks) {
      stockData = Object.fromEntries(stocks.map((s) => [s.symbol, s]));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">포트 종목</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          관심 종목 모니터링 및 관리
        </p>
      </div>
      <InvestmentClient
        initialWatchlist={watchlist ?? []}
        stockData={stockData}
      />
    </div>
  );
}
