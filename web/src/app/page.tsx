import Link from "next/link";
import { createServiceClient } from "@/lib/supabase";
import { EventSummaryCard } from "@/components/market/event-summary-card";
import DashboardPrices from "@/components/dashboard/dashboard-prices";

const SOURCE_COLORS: Record<string, string> = {
  lassi: "bg-red-900/30 text-red-400 border-red-800/50",
  stockbot: "bg-green-900/30 text-green-400 border-green-800/50",
  quant: "bg-blue-900/30 text-blue-400 border-blue-800/50",
};

const SOURCE_LABELS: Record<string, string> = {
  lassi: "라씨매매",
  stockbot: "스톡봇",
  quant: "퀀트",
};

export const revalidate = 60;

export default async function DashboardPage() {
  const supabase = createServiceClient();

  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = kst.toISOString().slice(0, 10);
  const sevenDaysLater = new Date(kst.getTime() + 7 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);

  // 1단계: 독립 쿼리 병렬 실행
  const [
    { data: signals },
    { data: latestScore },
    { data: favorites },
    { data: watchlist },
    { data: events },
  ] = await Promise.all([
    supabase.from("signals").select("*")
      .gte("timestamp", `${today}T00:00:00+09:00`)
      .lt("timestamp", `${today}T23:59:59+09:00`)
      .order("timestamp", { ascending: false }),
    supabase.from("market_score_history")
      .select("total_score, event_risk_score, combined_score")
      .order("date", { ascending: false }).limit(1).single(),
    supabase.from("stock_cache")
      .select("symbol, name, current_price, price_change_pct")
      .eq("is_favorite", true).limit(5),
    supabase.from("watchlist").select("*").order("sort_order"),
    supabase.from("market_events").select("*")
      .gte("event_date", today).lte("event_date", sevenDaysLater)
      .order("event_date", { ascending: true })
      .order("impact_level", { ascending: false }).limit(10),
  ]);

  const counts: Record<string, { total: number; buy: number; sell: number }> = {
    lassi: { total: 0, buy: 0, sell: 0 },
    stockbot: { total: 0, buy: 0, sell: 0 },
    quant: { total: 0, buy: 0, sell: 0 },
  };

  for (const s of signals || []) {
    const src = s.source as string;
    if (!counts[src]) continue;
    counts[src].total++;
    if (["BUY", "BUY_FORECAST"].includes(s.signal_type)) counts[src].buy++;
    else if (["SELL", "SELL_COMPLETE"].includes(s.signal_type)) counts[src].sell++;
  }

  const totalSignals = (signals || []).length;

  const score = latestScore?.total_score ?? null;
  const eventRiskScore = latestScore?.event_risk_score ?? 100;
  const combinedScore = latestScore?.combined_score ?? score ?? 50;

  // 2단계: watchlist 결과에 의존하는 쿼리
  const watchlistSymbols = (watchlist ?? []).map((w) => w.symbol);
  let watchlistStockData: Record<string, { current_price: number | null; price_change_pct: number | null }> = {};
  if (watchlistSymbols.length > 0) {
    const { data: wStocks } = await supabase
      .from("stock_cache")
      .select("symbol, current_price, price_change_pct")
      .in("symbol", watchlistSymbols);
    if (wStocks) {
      watchlistStockData = Object.fromEntries(wStocks.map((s) => [s.symbol, s]));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">대시보드</h1>
        <p className="text-sm text-[var(--muted)] mt-1">{today} 기준</p>
      </div>

      {/* 시장 요약 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(["lassi", "stockbot", "quant"] as const).map((src) => (
          <div key={src} className={`card p-4 ${SOURCE_COLORS[src]} border`}>
            <div className="text-sm font-medium mb-2 opacity-80">{SOURCE_LABELS[src]}</div>
            <div className="text-3xl font-bold">{counts[src].total}</div>
            <div className="text-sm mt-1 opacity-70">
              매수 {counts[src].buy} / 매도 {counts[src].sell}
            </div>
          </div>
        ))}
      </div>

      {/* 투자 시황 + 이벤트 */}
      <EventSummaryCard
        events={events || []}
        eventRiskScore={eventRiskScore}
        combinedScore={combinedScore}
        marketScore={score ?? 50}
      />

      {/* 관심종목 + 포트 종목 (실시간 가격 갱신) */}
      <DashboardPrices
        favorites={favorites ?? []}
        watchlist={watchlist ?? []}
        watchlistStockData={watchlistStockData}
        totalSignals={totalSignals}
      />
    </div>
  );
}
