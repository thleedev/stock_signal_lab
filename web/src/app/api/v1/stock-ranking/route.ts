// web/src/app/api/v1/stock-ranking/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * stock-ranking API 응답의 개별 종목 항목 타입
 *
 * DB 컬럼 매핑 (step4-scoring.ts 기준):
 *   score_momentum → 기술전환 점수 (calcTechnicalReversal)
 *   score_value    → 가치매력 점수 (calcValuationAttractiveness)
 *   score_supply   → 수급강도 점수 (calcSupplyStrength)
 *   score_signal   → 신호보너스 점수 (calcSignalBonus)
 *   score_risk     → 리스크 감점 절대값 (0~100)
 *   score_total    → 최종 종합 점수 (calcCompositeScore, 티어별 가중치 적용)
 */
export type StockRankItem = {
  symbol: string;
  scored_at: string | null;
  score_total: number;
  score_value: number;      // 가치매력
  score_growth: number;     // (score_value와 동일값 저장됨 — 하위호환용)
  score_supply: number;     // 수급강도
  score_momentum: number;   // 모멘텀 (추세 지속력)
  score_reversal: number;   // 기술적 반전 신호 (contrarian 스타일 전용)
  score_risk: number;       // 리스크 감점 절대값
  score_signal: number;     // 신호보너스
  name: string | null;
  market: string | null;
  current_price: number | null;
  price_change_pct: number | null;
  per: number | null;
  pbr: number | null;
  roe: number | null;
  market_cap: number | null;
  dividend_yield: number | null;
  foreign_net_qty: number | null;
  institution_net_qty: number | null;
  foreign_net_5d: number | null;
  institution_net_5d: number | null;
  foreign_streak: number | null;
  institution_streak: number | null;
  short_sell_ratio: number | null;
  high_52w: number | null;
  low_52w: number | null;
  forward_per: number | null;
  target_price: number | null;
  invest_opinion: number | null;
  signal_count_30d: number | null;
  latest_signal_type: string | null;
  latest_signal_date: string | null;
  latest_signal_price: number | null;
  is_managed: boolean | null;
  volume: number | null;
  prices_updated_at: string | null;
  // 카테고리별 체크리스트 충족/전체 조건 수 (step4-scoring 크론이 저장)
  checklist_tech_pass: number | null;
  checklist_tech_total: number | null;
  checklist_sup_pass: number | null;
  checklist_sup_total: number | null;
  checklist_val_pass: number | null;
  checklist_val_total: number | null;
  checklist_sig_pass: number | null;
  checklist_sig_total: number | null;
};

const SELECT_COLS = `
  symbol, scored_at,
  score_value, score_growth, score_supply, score_momentum, score_reversal, score_risk, score_signal, score_total,
  checklist_tech_pass, checklist_tech_total,
  checklist_sup_pass, checklist_sup_total,
  checklist_val_pass, checklist_val_total,
  checklist_sig_pass, checklist_sig_total,
  stock_cache!inner(
    symbol, name, market, current_price, price_change_pct,
    per, pbr, roe, market_cap, dividend_yield,
    foreign_net_qty, institution_net_qty, foreign_net_5d, institution_net_5d,
    foreign_streak, institution_streak, short_sell_ratio,
    high_52w, low_52w, forward_per, target_price, invest_opinion,
    signal_count_30d, latest_signal_type, latest_signal_date, latest_signal_price,
    is_managed, volume, updated_at
  )
`;

const SUPABASE_PAGE = 1000; // Supabase max_rows 제한

/**
 * 실시간 등락률 → 모멘텀 점수 (벨커브)
 *
 * 상승 초입(+1~3%)을 최고점(90)으로 두고, 과열(+7%↑)은 점수를 낮춤.
 * 기존 선형 공식은 당일 최대상승 종목만 상위에 올려 "이미 늦은" 종목 추천 문제 발생.
 *
 * 구간별 점수:
 *   ≤ -5%     → 10  (뚜렷한 하락)
 *   -5% ~ 0%  → 10 ~ 40  (약세 ~ 보합)
 *    0% ~ 1%  → 40 ~ 60  (보합 ~ 소폭 상승)
 *    1% ~ 3%  → 60 ~ 90  ★ 최적 구간 (상승 초입)
 *    3% ~ 5%  → 90 ~ 60  (적정 ~ 과열 경계)
 *    5% ~ 8%  → 60 ~ 15  (과열 진입)
 *   ≥  8%     → 10        (급등, 추격매수 위험)
 */
function calcBellMomentum(pricePct: number): number {
  if (pricePct <= -5) return 10;
  if (pricePct <= 0) return 10 + (pricePct + 5) * 6;  // -5%→10, 0%→40
  if (pricePct <= 1) return 40 + pricePct * 20;        // 0%→40, 1%→60
  if (pricePct <= 3) return 60 + (pricePct - 1) * 15; // 1%→60, 3%→90
  if (pricePct <= 5) return 90 - (pricePct - 3) * 15; // 3%→90, 5%→60
  if (pricePct <= 8) return 60 - (pricePct - 5) * 15; // 5%→60, 8%→15
  return Math.max(10, 15 - (pricePct - 8) * 2);        // 8%↑ → 10
}

/**
 * 역발상 스타일 전용 수급 전환 점수 (0~100)
 *
 * 일반 score_supply는 "지속적 매수 강도"를 측정해 하락주에 불리하다.
 * 역발상에서는 "매도세 종료 + 매수 전환 조짐"을 측정해야 한다.
 *
 * 점수 체계 (기준 30점에서 가감):
 *   외국인 연속 매수 1~3일:  +25 (막 전환, 가장 유망)
 *   외국인 연속 매도 -1~-2일: +12 (매도 마지막 단계 가능)
 *   외국인 연속 매도 -5일↓:  -15 (강한 매도 지속, 위험)
 *   기관 동일 기준 적용
 *   5일 합산 순매수 전환:    +10
 */
function calcContrarianSupply(cache: Record<string, unknown>): number {
  const fStreak = (cache.foreign_streak as number | null) ?? 0;
  const iStreak = (cache.institution_streak as number | null) ?? 0;
  const fNet5d  = (cache.foreign_net_5d    as number | null) ?? 0;
  const iNet5d  = (cache.institution_net_5d as number | null) ?? 0;

  let score = 30; // 역발상 기본점 (하락주라 매수세 낮은 것은 당연)

  // 외국인 수급 전환 신호
  if (fStreak >= 1 && fStreak <= 3)  score += 25; // 매수 막 전환
  else if (fStreak >= -2 && fStreak < 0) score += 12; // 매도 약화
  else if (fStreak < -5) score -= 15; // 강한 매도 지속

  // 기관 수급 전환 신호
  if (iStreak >= 1 && iStreak <= 3)  score += 20; // 매수 막 전환
  else if (iStreak >= -2 && iStreak < 0) score += 10; // 매도 약화
  else if (iStreak < -5) score -= 10; // 강한 매도 지속

  // 5일 순매수 전환 (외국인+기관 합산)
  if (fNet5d + iNet5d > 0) score += 10;

  return Math.min(100, Math.max(0, score));
}

/**
 * 커스텀 가중치로 score_total 재계산
 *
 * DB에 저장된 카테고리별 점수(0~100)에 사용자 가중치를 적용해 순위를 재산정.
 *
 * [일반 스타일]
 *   signalTech: AI신호(score_signal) + 기술적 점수(score_momentum) 평균
 *   supply:     score_supply (지속적 매수 강도)
 *
 * [역발상 스타일]
 *   signalTech: score_reversal 단독 — score_signal은 하락주에 거의 없어 발목 잡음
 *   supply:     calcContrarianSupply — "매도 종료 + 매수 전환 조짐"으로 재계산
 *   momentum:   score_reversal 단독 (liveRatio=0, wMO=10이라 비중 낮음)
 */
function computeCustomScore(
  row: Record<string, unknown>,
  wST: number, wSU: number, wVG: number, wMO: number, wRI: number,
  isContrarian: boolean
): number {
  const clamp = (v: number) => Math.min(100, Math.max(0, v));

  const cache = (row.stock_cache ?? {}) as Record<string, unknown>;

  // DB 점수 (0~100, 전일 배치 기준)
  const reversalScore = clamp(row.score_reversal as number ?? 0);
  const techScore     = clamp(row.score_momentum as number ?? 0);
  const signalScore   = clamp(row.score_signal   as number ?? 0);
  const supplyScore   = clamp(row.score_supply   as number ?? 0);
  const valueScore    = clamp(row.score_value    as number ?? 0);
  const riskAbs       = Math.abs(row.score_risk  as number ?? 0);

  // 실시간 모멘텀: 벨커브 — 상승 초입(+1~3%)이 최고점, 과열(+7%↑)은 페널티
  const pricePct = (cache.price_change_pct as number | null) ?? 0;
  const liveMomentum = clamp(calcBellMomentum(pricePct));

  // 모멘텀 가중치가 높을수록(단기 모멘텀형) 실시간 등락률 비중 증가
  // wMO=15(균형형) → live 20%, wMO=40(단기형) → live 60%
  // 역발상(wMO=10) → liveRatio=0, 실시간 가격 영향 없음
  const liveRatio  = Math.min(0.6, (wMO - 10) / 50);
  const blendedTech = isContrarian
    ? reversalScore // 역발상: reversal 단독 (live 비중 0)
    : techScore * (1 - liveRatio) + liveMomentum * liveRatio;

  const effectiveSupply = isContrarian
    ? calcContrarianSupply(cache) // 역발상: 수급 전환 신호
    : supplyScore;                // 일반: 배치 수급 점수

  const effectiveSignalTech = isContrarian
    ? blendedTech                                                         // 역발상: reversal 단독 (signal은 하락주에 0에 가까움)
    : (signalScore > 0 ? (signalScore + blendedTech) / 2 : blendedTech); // 일반: AI신호 있으면 평균, 없으면 기술 단독

  const positiveSum = wST + wSU + wVG + wMO;
  if (positiveSum === 0) return 0;

  const base = (
    wST * effectiveSignalTech +
    wSU * effectiveSupply +
    wVG * valueScore +
    wMO * blendedTech
  ) / positiveSum;

  const riskPenalty = Math.min(0.20, (riskAbs / 100) * 0.20 * (wRI / 15));
  return Math.min(100, Math.max(0, Math.round(base * (1 - riskPenalty))));
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get('market') ?? 'all';
  const dateParam = searchParams.get('date') ?? 'all'; // 'all' | 'signal_all' | 'YYYY-MM-DD'
  const style   = searchParams.get('style') ?? 'balanced';
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit = Math.min(9999, Math.max(10, parseInt(searchParams.get('limit') ?? '50')));
  const offset = (page - 1) * limit;

  // 커스텀 가중치 파싱 (5개 모두 양수일 때만 적용)
  const wST = parseFloat(searchParams.get('w_st') ?? '0');
  const wSU = parseFloat(searchParams.get('w_su') ?? '0');
  const wVG = parseFloat(searchParams.get('w_vg') ?? '0');
  const wMO = parseFloat(searchParams.get('w_mo') ?? '0');
  const wRI = parseFloat(searchParams.get('w_ri') ?? '0');
  const hasCustomWeights = wST > 0 && wSU > 0 && wVG > 0 && wMO > 0 && wRI > 0;

  const supabase = createServiceClient();

  // Supabase max_rows=1000 제한 우회: 전체 데이터를 페이지네이션으로 수집 후 API 레벨에서 정렬/슬라이스
  const allRows: Record<string, unknown>[] = [];
  let from = 0;

  while (true) {
    let query = supabase
      .from('stock_scores')
      .select(SELECT_COLS)
      .not('stock_cache.current_price', 'is', null)
      // 최신 신호가 SELL인 종목 제외 (has_active_sell: generated column)
      .eq('stock_cache.has_active_sell', false);

    if (market !== 'all') {
      query = query.eq('stock_cache.market', market);
    }

    if (dateParam === 'signal_all') {
      query = query.gt('stock_cache.signal_count_30d', 0);
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      query = query.gte('stock_cache.latest_signal_date', `${dateParam}T00:00:00Z`);
    }

    const { data, error } = await query
      .order('score_total', { ascending: false })
      .range(from, from + SUPABASE_PAGE - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data || data.length === 0) break;
    allRows.push(...(data as Record<string, unknown>[]));
    if (data.length < SUPABASE_PAGE) break;
    from += SUPABASE_PAGE;
  }

  // 커스텀 가중치가 있으면 카테고리 점수를 재계산해 재정렬
  const isContrarian = style === 'contrarian';
  if (hasCustomWeights) {
    allRows.sort((a, b) =>
      computeCustomScore(b, wST, wSU, wVG, wMO, wRI, isContrarian) -
      computeCustomScore(a, wST, wSU, wVG, wMO, wRI, isContrarian)
    );
  }

  const rawData = allRows.slice(offset, offset + limit);

  const items = (rawData ?? []).map(row => {
    const cache = row.stock_cache as unknown as Record<string, unknown>;

    return {
      symbol: row.symbol,
      scored_at: row.scored_at,
      score_total: hasCustomWeights
        ? computeCustomScore(row, wST, wSU, wVG, wMO, wRI, isContrarian)
        : (row.score_total as number),
      score_value: row.score_value as number,
      score_growth: row.score_growth as number,
      score_supply: row.score_supply as number,
      score_momentum: row.score_momentum as number,
      score_reversal: row.score_reversal as number,
      score_risk: row.score_risk as number,
      score_signal: row.score_signal as number,
      name: cache.name,
      market: cache.market,
      current_price: cache.current_price,
      price_change_pct: cache.price_change_pct,
      per: cache.per,
      pbr: cache.pbr,
      roe: cache.roe,
      market_cap: cache.market_cap,
      dividend_yield: cache.dividend_yield,
      foreign_net_qty: cache.foreign_net_qty,
      institution_net_qty: cache.institution_net_qty,
      foreign_net_5d: cache.foreign_net_5d,
      institution_net_5d: cache.institution_net_5d,
      foreign_streak: cache.foreign_streak,
      institution_streak: cache.institution_streak,
      short_sell_ratio: cache.short_sell_ratio,
      high_52w: cache.high_52w,
      low_52w: cache.low_52w,
      forward_per: cache.forward_per,
      target_price: cache.target_price,
      invest_opinion: cache.invest_opinion,
      signal_count_30d: cache.signal_count_30d,
      latest_signal_type: cache.latest_signal_type,
      latest_signal_date: cache.latest_signal_date,
      latest_signal_price: cache.latest_signal_price,
      is_managed: cache.is_managed,
      volume: cache.volume,
      prices_updated_at: cache.updated_at,
      checklist_tech_pass:  row.checklist_tech_pass  as number | null,
      checklist_tech_total: row.checklist_tech_total as number | null,
      checklist_sup_pass:   row.checklist_sup_pass   as number | null,
      checklist_sup_total:  row.checklist_sup_total  as number | null,
      checklist_val_pass:   row.checklist_val_pass   as number | null,
      checklist_val_total:  row.checklist_val_total  as number | null,
      checklist_sig_pass:   row.checklist_sig_pass   as number | null,
      checklist_sig_total:  row.checklist_sig_total  as number | null,
    };
  });

  return NextResponse.json({
    items,
    total: allRows.length,
    page,
    limit,
    scored_at: items[0]?.scored_at ?? null,
  });
}
