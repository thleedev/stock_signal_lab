import { createServiceClient } from "@/lib/supabase";
import { MarketClient } from "@/components/market/market-client";
import { sumInvestorFlow5d } from "@shared/market/investor-flow";

export const dynamic = "force-dynamic";

/** KST 기준 오늘부터 days일 후(음수면 이전) 날짜. UTC 를 쓰면 KST 00~09시에 하루 어긋납니다. */
function kstDate(days: number): string {
  return new Date(Date.now() + 9 * 3600 * 1000 + days * 86400000)
    .toISOString()
    .slice(0, 10);
}

export default async function MarketPage() {
  const supabase = createServiceClient();

  const today = kstDate(0);
  const thirtyDaysLater = kstDate(30);

  // 지표 이력은 롤링 통계(market_indicator_stats, Task 8)로 대체했으므로
  // 화면은 최근 값만 읽습니다. 이전 구현은 365일 원시 행을 limit 없이 읽어
  // PostgREST 1000행 상한에 잘렸고, 절단이 짧은 배열로 나타나 길이 가드를
  // 통과했습니다(52주 고점 대비가 실제로는 약 3개월 고점 대비로 계산됨).
  const [
    { data: rawIndicators, error: indicatorsError },
    { data: stats, error: statsError },
    { data: scoreHistory, error: scoreHistoryError },
    { data: events, error: eventsError },
    { data: investorDaily, error: investorError },
  ] = await Promise.all([
    supabase
      .from("market_indicators")
      .select("indicator_type, value, prev_value, change_pct, date, source, collected_at")
      .gte("date", kstDate(-30))
      .order("date", { ascending: false })
      .limit(600),
    supabase
      .from("market_indicator_stats")
      .select("indicator_key, high_52w, low_52w, ma_200d, pct_rank_252d, sample_days, as_of")
      .order("as_of", { ascending: false })
      .limit(60),
    supabase
      .from("market_score_history")
      .select("date, total_score, breakdown, event_risk_score, combined_score, risk_index")
      .order("date", { ascending: false })
      .limit(90),
    supabase
      .from("market_events")
      .select("*")
      .gte("event_date", today)
      .lte("event_date", thirtyDaysLater)
      .order("event_date", { ascending: true })
      .limit(1000),
    // 수급 5일 누적(FOREIGN_NET/INSTITUTION_NET)용 원천 — market_investor_daily 는
    // market_indicators 가 아니라 별도 일별 적재 테이블이라 따로 조회한다.
    supabase
      .from("market_investor_daily")
      .select("date, foreign_net, institution_net")
      .order("date", { ascending: false })
      .limit(5),
  ]);

  // 조회 실패는 빈 배열과 구분되지 않으면 "데이터 없음"으로 오인된다.
  // 화면에 오류를 어떻게 노출할지는 다음 태스크 범위이므로 여기서는 로그만 남긴다.
  if (indicatorsError) console.error("[market] market_indicators 조회 실패:", indicatorsError.message);
  if (statsError) console.error("[market] market_indicator_stats 조회 실패:", statsError.message);
  if (scoreHistoryError) console.error("[market] market_score_history 조회 실패:", scoreHistoryError.message);
  if (eventsError) console.error("[market] market_events 조회 실패:", eventsError.message);
  if (investorError) console.error("[market] market_investor_daily 조회 실패:", investorError.message);

  // 지표별 최신 1행만 남깁니다
  const seen = new Set<string>();
  const indicators = (rawIndicators || []).filter((row: { indicator_type: string }) => {
    if (seen.has(row.indicator_type)) return false;
    seen.add(row.indicator_type);
    return true;
  });

  // 수급 5일 누적: 카탈로그(shared/market/catalog.ts) 의 FOREIGN_NET/INSTITUTION_NET
  // 임계값([-5000,-12000,-25000] 등, 억원)은 5일 누적 기준이다. 합산·판정 가능 여부
  // 규칙은 shared/market/investor-flow.ts 하나로 크론(cron/market-score/route.ts)과
  // 공유한다 — 각자 다른 합산 로직을 쓰면 같은 날 다른 위험 지수가 나온다.
  // prev_value/change_pct 는 정의되지 않는 값이라 null 로 둔다.
  const investorFlow = sumInvestorFlow5d(investorDaily || []);
  if (investorFlow) {
    indicators.push(
      { indicator_type: "FOREIGN_NET", value: investorFlow.foreignNet, prev_value: null, change_pct: null, date: investorFlow.date, source: null, collected_at: null },
      { indicator_type: "INSTITUTION_NET", value: investorFlow.institutionNet, prev_value: null, change_pct: null, date: investorFlow.date, source: null, collected_at: null },
    );
  }

  // 지표별 최신 통계 1행만 남깁니다. as_of 도 함께 넘겨 화면이 신선도를 판단할 수 있게 합니다.
  // market_indicator_stats 는 (indicator_key, as_of) 복합키이고 지표가 12종이므로,
  // as_of 내림차순 60건이면 최근 5일치가 섞여 들어온다 — 지표별 첫 등장 행이 최신이다.
  // 배치가 며칠 멈추면 as_of 가 오늘보다 오래된 채로 넘어올 수 있다.
  const statSeen = new Set<string>();
  const statsByKey: Record<string, {
    high_52w: number | null;
    low_52w: number | null;
    ma_200d: number | null;
    pct_rank_252d: number | null;
    sample_days: number;
    as_of: string;
  }> = {};
  for (const s of stats || []) {
    const key = s.indicator_key as string;
    if (statSeen.has(key)) continue;
    statSeen.add(key);
    statsByKey[key] = {
      high_52w: s.high_52w as number | null,
      low_52w: s.low_52w as number | null,
      ma_200d: s.ma_200d as number | null,
      pct_rank_252d: s.pct_rank_252d as number | null,
      sample_days: s.sample_days as number,
      as_of: s.as_of as string,
    };
  }

  return (
    <MarketClient
      indicators={indicators}
      statsByKey={statsByKey}
      scoreHistory={scoreHistory || []}
      events={events || []}
    />
  );
}
