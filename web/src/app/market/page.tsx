import { createServiceClient } from "@/lib/supabase";
import { MarketClient } from "@/components/market/market-client";

export const dynamic = "force-dynamic";

export default async function MarketPage() {
  const supabase = createServiceClient();

  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysLater = new Date();
  thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);

  // 모든 독립 쿼리를 병렬 실행
  // 252일 윈도우 (상대 분위수 계산용)
  const yearAgo = new Date();
  yearAgo.setDate(yearAgo.getDate() - 365);
  const yearAgoStr = yearAgo.toISOString().slice(0, 10);

  const [
    { data: rawIndicators },
    { data: scoreHistory },
    { data: events },
  ] = await Promise.all([
    supabase.from("market_indicators").select("indicator_type, value, prev_value, change_pct, date")
      .gte("date", yearAgoStr)
      .order("date", { ascending: false }),
    supabase.from("market_score_history")
      .select("date, total_score, breakdown, event_risk_score, combined_score, risk_index")
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

  // 지표별 252일 history (상대 임계값 계산용)
  const historyByType: Record<string, number[]> = {};
  for (const row of rawIndicators || []) {
    const t = row.indicator_type as string;
    const v = Number(row.value);
    if (!Number.isFinite(v)) continue;
    if (!historyByType[t]) historyByType[t] = [];
    if (historyByType[t].length < 252) historyByType[t].push(v);
  }

  return (
    <MarketClient
      indicators={indicators || []}
      scoreHistory={scoreHistory || []}
      events={events || []}
      historyByType={historyByType}
    />
  );
}
