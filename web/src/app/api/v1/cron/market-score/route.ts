import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import {
  calculateEventRiskScore,
  calculateCombinedScore,
  calculateMarketScore,
} from '@/lib/market-score';
import { calculateRiskIndex, COVERAGE_THRESHOLD, type IndicatorStats } from '@/lib/market-thresholds';
import { mean, pctRank } from '@shared/market/stats';
import { sumInvestorFlow5d } from '@shared/market/investor-flow';
import type { MarketEvent } from '@/types/market-event';
import type { IndicatorWeight } from '@/types/market';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * KST(UTC+9) 기준 오늘부터 daysOffset 일 후(음수면 이전) 날짜.
 *
 * UTC 로 "오늘"을 구하면 KST 00~09시에 하루 어긋난다. `market-open` 스케줄
 * (`30 22 * * 0-4`, UTC 22:30 = KST 익일 07:30)이 정확히 이 구간에서 돈다 —
 * UTC 로는 아직 전날이라 이 라우트가 전날자 market_score_history 행을
 * "오늘"로 착각해 마감 확정 값을 덮어쓴다(최종 리뷰 C2). 이 파일의 날짜
 * 계산은 모두 이 함수를 거쳐 기준을 KST 하나로 통일한다.
 * web/src/app/market/page.tsx 의 kstDate() 와 같은 관용구다.
 */
function kstDate(daysOffset = 0): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000 + daysOffset * 86400000)
    .toISOString()
    .slice(0, 10);
}

/** PostgREST 1000행 상한을 넘겨 90일~365일 윈도우 지표를 전부 읽는다 */
async function loadAllIndicators(
  supabase: ReturnType<typeof createServiceClient>,
  since: string,
) {
  const PAGE = 1000;
  const out: { indicator_type: string; value: number; date: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('market_indicators')
      .select('indicator_type, value, date')
      .gte('date', since)
      .order('date', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`market_indicators 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as typeof out));
    if (data.length < PAGE) break;
  }
  return out;
}

/**
 * 시황 점수 보강 cron
 * - calculateMarketScore(가중치 + 90일 정규화 기반 total_score/breakdown)
 * - calculateRiskIndex(절대 임계값 기반 위험 지수)
 * - calculateEventRiskScore(향후 30일 이벤트 가중)
 * - calculateCombinedScore(total_score × 0.7 + event_risk × 0.3)
 *
 * 지표 원본 수집은 .github/scripts/batch/step6-market-data.ts 가 담당하고,
 * 이 cron은 그 위에 total_score/breakdown/event_risk_score/risk_index/
 * combined_score를 계산해 덮어쓴다.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const today = kstDate(0);
  const in30Str = kstDate(30);

  // 1) 365일 윈도우 지표 (현재값 + 90일 min/max + 252일 history)
  const sinceStr = kstDate(-365);
  const ninetyAgoStr = kstDate(-90);

  // 365일 × 12종 지표는 4천행을 넘겨 PostgREST 1000행 상한에 걸린다.
  // 페이지네이션으로 전부 읽지 않으면 90일 min/max·252일 history 가 조용히 짧아진다.
  let rawIndicators: { indicator_type: string; value: number; date: string }[];
  try {
    rawIndicators = await loadAllIndicators(supabase, sinceStr);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const valueMap: Record<string, number> = {};
  const minMaxMap: Record<string, { current: number; min90d: number; max90d: number }> = {};
  const historyByType: Record<string, number[]> = {};
  for (const row of rawIndicators) {
    const t = row.indicator_type as string;
    const v = Number(row.value);
    if (!Number.isFinite(v)) continue;
    if (!(t in valueMap)) valueMap[t] = v; // 첫 행이 가장 최근(desc 정렬)

    // 252일 history (drawdown_52w / ma200_diff 파생용)
    if (!historyByType[t]) historyByType[t] = [];
    if (historyByType[t].length < 252) historyByType[t].push(v);

    // 90일 min/max는 90일 이내 값만 반영
    if ((row.date as string) >= ninetyAgoStr) {
      const cur = minMaxMap[t];
      if (!cur) {
        minMaxMap[t] = { current: v, min90d: v, max90d: v };
      } else {
        cur.min90d = Math.min(cur.min90d, v);
        cur.max90d = Math.max(cur.max90d, v);
      }
    }
  }
  // current 보정: 첫 row가 desc 첫 행이므로 valueMap[t] 가 곧 current
  for (const t of Object.keys(minMaxMap)) {
    minMaxMap[t].current = valueMap[t];
  }

  // 수급 5일 누적(FOREIGN_NET/INSTITUTION_NET) — market_investor_daily 는
  // market_indicators 와 분리된 테이블이라 loadAllIndicators 로는 잡히지
  // 않는다. 합산 규칙은 shared/market/investor-flow.ts 로 web/src/app/
  // market/page.tsx 와 공유한다. 카탈로그 전환 이전에는 RISK_THRESHOLDS 가
  // 하드코딩이라 이 두 지표가 판정 대상이 아니어서 이 조회가 없어도
  // 화면·크론이 같은 값을 냈다. 카탈로그 전환으로 두 지표(가중치 3+2)가
  // 판정에 들어오면서, 이 조회를 빼먹으면 화면과 크론이 같은 날 다른
  // 위험 지수를 낸다 — 외국인·기관이 대량 순매도하는 국면일수록 그 괴리가
  // 커진다(리스크가 화면에는 반영되고 크론이 쓰는 대시보드·추이 차트에는
  // 반영되지 않는다).
  //
  // 이 조회 실패는 500 으로 라우트 전체를 죽이지 않는다 — 로그만 남기고
  // investorFlow 를 null 로 둔 채 진행한다. Naver 차단·일시 장애로 이
  // 조회만 실패하는 일은 드물지 않다. 여기서 500 을 반환하면 그날
  // market_score_history 행 자체가 안 만들어져, 이 조회와 무관한
  // event_risk_score(market_events 기반)까지 함께 잃는다 — 바로 아래
  // 커버리지 게이트 주석이 "과도한 손실"이라 부르는 것과 정확히 같은
  // 결과를, 이 조회의 500 반환이 스스로 만들고 있었다. 화면(page.tsx)도
  // 같은 오류를 로그만 남기고 진행하므로 실패 처리를 일치시킨다 — investorFlow
  // 가 null 이면 FOREIGN_NET/INSTITUTION_NET 은 missing 으로 빠지고
  // coverage 가 그만큼(가중치 5/30) 낮아져, 결손이 숨겨지지 않고 coverage
  // 로 드러난다.
  const { data: investorDaily, error: investorError } = await supabase
    .from('market_investor_daily')
    .select('date, foreign_net, institution_net')
    .order('date', { ascending: false })
    .limit(5);
  if (investorError) {
    console.error('[cron/market-score] market_investor_daily 조회 실패:', investorError.message);
  }
  const investorFlow = investorError ? null : sumInvestorFlow5d(investorDaily || []);
  if (investorFlow) {
    valueMap.FOREIGN_NET = investorFlow.foreignNet;
    valueMap.INSTITUTION_NET = investorFlow.institutionNet;
  }

  // calculateRiskIndex 는 365일 원시 배열이 아니라 지표별 선계산 통계
  // (IndicatorStats)를 받는다(market-thresholds.ts 참고). 이 라우트는
  // loadAllIndicators 가 이미 페이지네이션으로 전량을 읽어 두므로,
  // market_indicator_stats 배치(step13)와 같은 계산(high/low_52w·200일
  // 이평·252일 백분위)을 historyByType(날짜 내림차순, [0]=현재값)으로
  // 직접 만들어 넘긴다. 이 값을 넘기지 않으면 KOSPI/KOSDAQ/EWY/GOLD 같은
  // drawdown_52w/ma200_diff 파생 지표가 통계 없음으로 missing 처리되어
  // 위험 지수 계산에서 빠진다.
  const statsByType: Record<string, IndicatorStats> = {};
  for (const [t, values] of Object.entries(historyByType)) {
    const current = values[0];
    const window200 = values.slice(0, 200);
    statsByType[t] = {
      high_52w: values.length > 0 ? Math.max(...values) : null,
      low_52w: values.length > 0 ? Math.min(...values) : null,
      ma_200d: window200.length >= 50 ? mean(window200) : null,
      pct_rank_252d: values.length >= 30 ? pctRank(current, values) : null,
      sample_days: values.length,
      as_of: today,
    };
  }

  const { riskIndex, breakdown: riskBreakdown, dangerCount, validCount, coverage, missing } =
    calculateRiskIndex(valueMap, statsByType);

  // 커버리지 미달이면 risk_index 를 저장하지 않는다(null). 컬럼은 이미
  // nullable(마이그레이션 032, DEFAULT NULL)이라 스키마 변경이 필요 없다.
  //
  // 저장 자체를 걸러야 하는 이유 — 이 컬럼을 대시보드 첫 화면 배너
  // (web/src/app/page.tsx → dashboard-risk-banner.tsx)와 /market 의 30일
  // 추이 차트(RiskHistoryChart)가 그대로 읽는다. coverage 를 무시하고
  // riskIndex(배치가 죽은 날은 0에 가까워짐)를 그대로 저장하면, 이번
  // 태스크가 /market 배너에서 고친 "지표 결손을 안전으로 그리는" 결함이
  // 이 컬럼을 거쳐 다른 화면 두 곳에 그대로 남는다. null 은 이미 두
  // 소비처 모두가 "판정 불가"로 다루도록 되어 있다 — RiskHistoryChart 는
  // `risk_index ?? null` 로 회색 막대를 그리고, dashboard-risk-banner.tsx
  // 는 이번 라운드에서 null 을 별도 중립 상태로 렌더링하도록 고쳤다.
  //
  // total_score/breakdown/event_risk_score/combined_score 는 별도 계산
  // 경로(calculateMarketScore, indicator_weights 기반)라 이 게이트와
  // 무관하게 계속 저장한다 — risk_index 산정 근거의 부족이지 시황 점수
  // 전체의 부족은 아니기 때문이다.
  const storedRiskIndex = coverage >= COVERAGE_THRESHOLD ? riskIndex : null;

  // 1-1) total_score 계산 (가중치 + 90일 정규화)
  const { data: weightRows } = await supabase.from('indicator_weights').select('*');
  const weights = ((weightRows ?? []) as IndicatorWeight[]);
  const { totalScore: computedTotal, breakdown: scoreBreakdown } =
    calculateMarketScore(minMaxMap, weights);
  const weightsSnapshot: Record<string, number> = {};
  for (const w of weights) weightsSnapshot[w.indicator_type] = w.weight;

  // 2) 향후 30일 이벤트 → event_risk_score
  const { data: events, error: evError } = await supabase
    .from('market_events')
    .select('*')
    .gte('event_date', today)
    .lte('event_date', in30Str);

  if (evError) {
    return NextResponse.json({ error: evError.message }, { status: 500 });
  }

  // baseDate 생략 시 UTC 기준으로 감쇠를 계산해 위 이벤트 조회 범위(KST)와 어긋난다 —
  // kstDate() 와 같은 보정을 그대로 넘긴다.
  const eventRiskScore = calculateEventRiskScore(
    (events ?? []) as MarketEvent[],
    new Date(Date.now() + 9 * 60 * 60 * 1000),
  );

  // 3) 오늘자 행: 항상 새로 계산한 total_score / breakdown 사용
  const totalScore = weights.length > 0 ? computedTotal : 50;
  const finalBreakdown = weights.length > 0 ? scoreBreakdown : riskBreakdown;
  const combinedScore = calculateCombinedScore(Number(totalScore), eventRiskScore);

  // 4) Upsert (breakdown / weights_snapshot NOT NULL)
  const { error: upsertError } = await supabase
    .from('market_score_history')
    .upsert(
      {
        date: today,
        total_score: totalScore,
        breakdown: finalBreakdown,
        weights_snapshot: weightsSnapshot,
        event_risk_score: eventRiskScore,
        combined_score: combinedScore,
        risk_index: storedRiskIndex,
      },
      { onConflict: 'date' }
    );

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    date: today,
    risk_index: storedRiskIndex,
    // coverage/missing 은 DB 에 저장하지 않는다(스키마 변경 없이 관측
    // 목적으로만 응답에 싣는다) — risk_index 가 null 로 나온 이유를
    // 모니터링에서 바로 확인할 수 있게 한다.
    coverage,
    missing,
    event_risk_score: eventRiskScore,
    combined_score: combinedScore,
    total_score: totalScore,
    indicator_count: validCount,
    danger_count: dangerCount,
    upcoming_events: events?.length ?? 0,
  });
}
