import { createServiceClient } from "@/lib/supabase";
import { MarketClient } from "@/components/market/market-client";

export const dynamic = "force-dynamic";

export default async function MarketPage() {
  const supabase = createServiceClient();

  // 가중치 전체 조회
  const { data: weights } = await supabase
    .from("indicator_weights")
    .select("*")
    .order("indicator_type");

  // 지표별 최신 데이터 (indicator_type별 가장 최근 1건)
  const { data: rawIndicators } = await supabase
    .from("market_indicators")
    .select("*")
    .order("date", { ascending: false });

  // distinct on indicator_type: 첫 번째(최신) 항목만 유지
  const seen = new Set<string>();
  const indicators = (rawIndicators || []).filter((row: { indicator_type: string }) => {
    if (seen.has(row.indicator_type)) return false;
    seen.add(row.indicator_type);
    return true;
  });

  // 점수 히스토리 최근 90건
  const { data: scoreHistory } = await supabase
    .from("market_score_history")
    .select("date, total_score, breakdown")
    .order("date", { ascending: false })
    .limit(90);

  return (
    <MarketClient
      indicators={indicators || []}
      weights={weights || []}
      scoreHistory={scoreHistory || []}
    />
  );
}
