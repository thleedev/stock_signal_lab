import { createServiceClient } from "@/lib/supabase";
import { MarketClient } from "@/components/market/market-client";

export const revalidate = 120;

export default async function MarketPage() {
  const supabase = createServiceClient();

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const sinceDate = ninetyDaysAgo.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysLater = new Date();
  thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);

  // 모든 독립 쿼리를 병렬 실행
  const [
    { data: weights },
    { data: rawIndicators },
    { data: allHistory },
    { data: scoreHistory },
    { data: events },
  ] = await Promise.all([
    supabase.from("indicator_weights").select("*").order("indicator_type"),
    supabase.from("market_indicators").select("*").order("date", { ascending: false }),
    supabase.from("market_indicators").select("indicator_type, value").gte("date", sinceDate),
    supabase.from("market_score_history")
      .select("date, total_score, breakdown, event_risk_score, combined_score")
      .order("date", { ascending: false }).limit(90),
    supabase.from("market_events").select("*")
      .gte("event_date", today)
      .lte("event_date", thirtyDaysLater.toISOString().slice(0, 10))
      .order("event_date", { ascending: true }),
  ]);

  const seen = new Set<string>();
  const indicators = (rawIndicators || []).filter((row: { indicator_type: string }) => {
    if (seen.has(row.indicator_type)) return false;
    seen.add(row.indicator_type);
    return true;
  });

  // 90일 min/max를 단일 쿼리 결과에서 JS로 집계
  const indicatorRanges: Record<string, { min: number; max: number }> = {};
  for (const h of allHistory || []) {
    const val = Number(h.value);
    const type = h.indicator_type as string;
    if (!indicatorRanges[type]) {
      indicatorRanges[type] = { min: val, max: val };
    } else {
      if (val < indicatorRanges[type].min) indicatorRanges[type].min = val;
      if (val > indicatorRanges[type].max) indicatorRanges[type].max = val;
    }
  }

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
