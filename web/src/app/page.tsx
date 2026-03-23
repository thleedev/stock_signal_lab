import { createServiceClient } from "@/lib/supabase";
import { PageLayout, PageHeader } from "@/components/ui";
import { DashboardRiskBanner } from "@/components/dashboard/dashboard-risk-banner";
import { SignalSummaryCard } from "@/components/dashboard/signal-summary-card";
import { MarketSummaryCard } from "@/components/dashboard/market-summary-card";
import { WatchlistWidget } from "@/components/dashboard/watchlist-widget";
import { InvestmentSummaryCard } from "@/components/dashboard/investment-summary-card";
import { VirtualPortfolioSection } from "@/components/dashboard/virtual-portfolio-section";
import { SourcePortfolioCard } from "@/components/dashboard/source-portfolio-card";

export const revalidate = 60;

export default async function DashboardPage() {
  const supabase = createServiceClient();

  const kst = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
  const today = kst.toISOString().slice(0, 10);
  const tomorrow = new Date(kst.getTime() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [
    { data: signals },
    { data: latestScore },
    { data: favorites },
    { count: watchlistCount },
    { data: nextEvent },
    { data: lassiSnap },
    { data: stockbotSnap },
    { data: quantSnap },
  ] = await Promise.all([
    supabase
      .from("signals")
      .select("source, signal_type")
      .gte("timestamp", `${today}T00:00:00+09:00`)
      .lt("timestamp", `${tomorrow}T00:00:00+09:00`),
    supabase
      .from("market_score_history")
      .select("total_score, event_risk_score, risk_index")
      .order("date", { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from("stock_cache")
      .select("symbol, name, current_price, price_change_pct")
      .eq("is_favorite", true)
      .limit(5),
    supabase
      .from("watchlist")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("market_events")
      .select("id, title, event_date")
      .gte("event_date", today)
      .order("event_date", { ascending: true })
      .limit(1)
      .single(),
    supabase
      .from("portfolio_snapshots")
      .select("total_value, holdings, cash")
      .eq("source", "lassi")
      .eq("execution_type", "lump")
      .order("date", { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from("portfolio_snapshots")
      .select("total_value, holdings, cash")
      .eq("source", "stockbot")
      .eq("execution_type", "lump")
      .order("date", { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from("portfolio_snapshots")
      .select("total_value, holdings, cash")
      .eq("source", "quant")
      .eq("execution_type", "lump")
      .order("date", { ascending: false })
      .limit(1)
      .single(),
  ]);

  // 신호 집계
  const counts: Record<string, { buy: number; sell: number; total: number }> = {
    lassi: { buy: 0, sell: 0, total: 0 },
    stockbot: { buy: 0, sell: 0, total: 0 },
    quant: { buy: 0, sell: 0, total: 0 },
  };
  for (const s of signals ?? []) {
    const src = s.source as string;
    if (!counts[src]) continue;
    counts[src].total++;
    if (["BUY", "BUY_FORECAST"].includes(s.signal_type)) counts[src].buy++;
    else if (["SELL", "SELL_COMPLETE"].includes(s.signal_type)) counts[src].sell++;
  }

  // 소스별 포트폴리오 수익률 계산 (스냅샷 기준)
  // PORTFOLIO_CONFIG.CASH_PER_STRATEGY = 5_000_000 (전략별 500만원, strategy-engine/index.ts:18)
  const BASE_CAPITAL = 5_000_000;
  function calcReturn(snap: { total_value: number; cash: number; holdings: unknown[] } | null) {
    if (!snap) return { returnPct: null, holdingCount: 0, totalValue: null };
    const returnPct = ((snap.total_value - BASE_CAPITAL) / BASE_CAPITAL) * 100;
    const holdingCount = Array.isArray(snap.holdings) ? snap.holdings.length : 0;
    return { returnPct, holdingCount, totalValue: snap.total_value };
  }

  const lassiData = calcReturn(lassiSnap as { total_value: number; cash: number; holdings: unknown[] } | null);
  const stockbotData = calcReturn(stockbotSnap as { total_value: number; cash: number; holdings: unknown[] } | null);
  const quantData = calcReturn(quantSnap as { total_value: number; cash: number; holdings: unknown[] } | null);

  const riskIndex = latestScore?.risk_index ?? 0;
  const marketScore = latestScore?.total_score ?? 50;
  const eventRiskScore = latestScore?.event_risk_score ?? 100;

  return (
    <PageLayout>
      <PageHeader title="대시보드" subtitle="AI 매매신호 현황" />

      {/* 위험 경보 배너 */}
      <DashboardRiskBanner riskIndex={riskIndex} />

      {/* 신호 3카드 + 시황 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SignalSummaryCard source="lassi" {...counts.lassi} />
        <SignalSummaryCard source="stockbot" {...counts.stockbot} />
        <SignalSummaryCard source="quant" {...counts.quant} />
        <MarketSummaryCard
          marketScore={marketScore}
          eventRiskScore={eventRiskScore}
          nextEvent={nextEvent ?? null}
        />
      </div>

      {/* 관심종목 + 투자현황 + 가상PF */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-2">
          <WatchlistWidget favorites={favorites ?? []} />
        </div>
        <InvestmentSummaryCard count={watchlistCount ?? 0} />
        <VirtualPortfolioSection />
      </div>

      {/* 소스별 포트폴리오 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SourcePortfolioCard
          source="lassi"
          totalValue={lassiData.totalValue}
          holdingCount={lassiData.holdingCount}
          returnPct={lassiData.returnPct}
        />
        <SourcePortfolioCard
          source="stockbot"
          totalValue={stockbotData.totalValue}
          holdingCount={stockbotData.holdingCount}
          returnPct={stockbotData.returnPct}
        />
        <SourcePortfolioCard
          source="quant"
          totalValue={quantData.totalValue}
          holdingCount={quantData.holdingCount}
          returnPct={quantData.returnPct}
        />
      </div>
    </PageLayout>
  );
}
