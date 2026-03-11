import { createServiceClient } from "@/lib/supabase";
import { MarketClient } from "@/components/market/market-client";

export const dynamic = "force-dynamic";

export default async function MarketPage() {
  const supabase = createServiceClient();

  // 가중치
  const { data: weights } = await supabase
    .from("indicator_weights")
    .select("*")
    .order("indicator_type");

  // 지표별 최신 데이터
  const { data: rawIndicators } = await supabase
    .from("market_indicators")
    .select("*")
    .order("date", { ascending: false });

  const seen = new Set<string>();
  const indicators = (rawIndicators || []).filter((row: { indicator_type: string }) => {
    if (seen.has(row.indicator_type)) return false;
    seen.add(row.indicator_type);
    return true;
  });

  // 90일 min/max 조회
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const sinceDate = ninetyDaysAgo.toISOString().slice(0, 10);

  const indicatorRanges: Record<string, { min: number; max: number }> = {};
  for (const ind of indicators) {
    const { data: history } = await supabase
      .from("market_indicators")
      .select("value")
      .eq("indicator_type", ind.indicator_type)
      .gte("date", sinceDate);

    if (history && history.length > 0) {
      const values = history.map((h: { value: number }) => Number(h.value));
      indicatorRanges[ind.indicator_type] = {
        min: Math.min(...values),
        max: Math.max(...values),
      };
    }
  }

  // 점수 히스토리 (event_risk_score, combined_score 포함)
  const { data: scoreHistory } = await supabase
    .from("market_score_history")
    .select("date, total_score, breakdown, event_risk_score, combined_score")
    .order("date", { ascending: false })
    .limit(90);

  // 이벤트 (향후 30일)
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysLater = new Date();
  thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);

  const { data: events } = await supabase
    .from("market_events")
    .select("*")
    .gte("event_date", today)
    .lte("event_date", thirtyDaysLater.toISOString().slice(0, 10))
    .order("event_date", { ascending: true });

  return (
    <MarketClient
      indicators={indicators || []}
      weights={weights || []}
      scoreHistory={scoreHistory || []}
      indicatorRanges={indicatorRanges}
      events={events || []}
    />
  );
}
