import Link from "next/link";
import { createServiceClient } from "@/lib/supabase";
import { EventSummaryCard } from "@/components/market/event-summary-card";

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

  // 포트 종목 수익률 계산
  let totalInvested = 0;
  let totalCurrent = 0;
  for (const w of watchlist ?? []) {
    const stock = watchlistStockData[w.symbol];
    if (w.buy_price && stock?.current_price) {
      totalInvested += w.buy_price;
      totalCurrent += stock.current_price;
    }
  }
  const portfolioReturn = totalInvested > 0
    ? ((totalCurrent - totalInvested) / totalInvested) * 100
    : null;

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

      {/* 관심종목 */}
      {favorites && favorites.length > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-sm">관심종목</h2>
            <Link href="/stocks" className="text-xs text-[var(--accent-light)] hover:underline">전체 →</Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {favorites.map((f) => (
              <Link
                key={f.symbol}
                href={`/stock/${f.symbol}`}
                className="p-2 rounded-lg bg-[var(--background)] hover:bg-[var(--card-hover)] transition-colors"
              >
                <div className="text-sm font-medium truncate">{f.name}</div>
                <div className="text-lg font-bold mt-0.5">
                  {f.current_price?.toLocaleString() ?? "-"}
                </div>
                <div className={`text-xs font-medium ${
                  (f.price_change_pct ?? 0) > 0 ? "price-up" : (f.price_change_pct ?? 0) < 0 ? "price-down" : "price-flat"
                }`}>
                  {(f.price_change_pct ?? 0) > 0 ? "+" : ""}{f.price_change_pct ?? 0}%
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* 오늘 총 신호 + 포트 종목 요약 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link href="/signals" className="card p-4 hover:border-[var(--accent)] transition-colors">
          <div className="text-sm text-[var(--muted)]">오늘 총 신호</div>
          <div className="text-4xl font-bold mt-1">{totalSignals}건</div>
          <div className="text-xs text-[var(--muted)] mt-1">전체 보기 →</div>
        </Link>

        <Link href="/investment" className="card p-4 hover:border-[var(--accent)] transition-colors">
          <div className="text-sm text-[var(--muted)]">포트 종목</div>
          <div className="text-4xl font-bold mt-1">{(watchlist ?? []).length}종목</div>
          {portfolioReturn !== null && (
            <div className={`text-sm font-medium mt-1 ${portfolioReturn >= 0 ? "price-up" : "price-down"}`}>
              평균 수익률 {portfolioReturn >= 0 ? "+" : ""}{portfolioReturn.toFixed(2)}%
            </div>
          )}
          {portfolioReturn === null && (
            <div className="text-xs text-[var(--muted)] mt-1">관리 →</div>
          )}
        </Link>
      </div>

      {/* 포트 종목 리스트 */}
      {watchlist && watchlist.length > 0 && (
        <div className="card">
          <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
            <h2 className="font-semibold">포트 종목</h2>
            <Link href="/investment" className="text-xs text-[var(--accent-light)] hover:underline">관리 →</Link>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {watchlist.map((w) => {
              const stock = watchlistStockData[w.symbol];
              const currentPrice = stock?.current_price;
              const changePct = stock?.price_change_pct;
              const profitPct = w.buy_price && currentPrice
                ? ((currentPrice - w.buy_price) / w.buy_price) * 100
                : null;

              return (
                <Link
                  key={w.symbol}
                  href={`/stock/${w.symbol}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-[var(--card-hover)] transition-colors"
                >
                  <div>
                    <div className="text-sm font-medium">{w.name}</div>
                    <div className="text-xs text-[var(--muted)]">
                      {w.symbol}
                      {w.buy_price ? ` · 매수 ${w.buy_price.toLocaleString()}원` : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-bold ${
                      (changePct ?? 0) > 0 ? "text-red-400" : (changePct ?? 0) < 0 ? "text-blue-400" : ""
                    }`}>
                      {currentPrice?.toLocaleString() ?? "-"}원
                    </div>
                    {profitPct !== null && (
                      <div className={`text-xs font-medium ${profitPct >= 0 ? "text-red-400" : "text-blue-400"}`}>
                        {profitPct >= 0 ? "+" : ""}{profitPct.toFixed(2)}%
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
