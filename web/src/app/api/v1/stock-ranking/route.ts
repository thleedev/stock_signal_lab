import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchBulkInvestorData, fetchNaverDailyPrices } from '@/lib/naver-stock-api';
import type { StockInvestorData, NaverDailyPrice } from '@/lib/naver-stock-api';
import { fetchBulkIndicators } from '@/lib/krx-api';
import { calcRiskScore } from '@/lib/scoring/risk-score';
import { calcSupplyAdditions } from '@/lib/scoring/supply-score-additions';
import { calcValuationAdditions } from '@/lib/scoring/valuation-score-additions';

export const dynamic = 'force-dynamic';

export interface StockRankItem {
  symbol: string;
  name: string;
  market: string;
  current_price: number | null;
  price_change_pct: number | null;
  per: number | null;
  pbr: number | null;
  roe: number | null;
  foreign_net_qty: number | null;
  institution_net_qty: number | null;
  foreign_net_5d: number | null;
  institution_net_5d: number | null;
  foreign_streak: number | null;
  institution_streak: number | null;
  short_sell_ratio: number | null;
  short_sell_updated_at: string | null;
  dividend_yield: number | null;
  market_cap: number | null;
  forward_per: number | null;
  target_price: number | null;
  invest_opinion: number | null;
  signal_count_30d: number | null;
  latest_signal_type: string | null;
  latest_signal_date: string | null;
  latest_signal_price: number | null;
  sector: string | null;
  high_52w: number | null;
  low_52w: number | null;
  // 초단기 모멘텀용 파생 필드 (daily_prices 기반)
  volume_ratio: number | null;      // 당일거래량 / 20일평균거래량
  close_position: number | null;    // (종가-저가)/(고가-저가), 고가=저가면 1.0
  trading_value: number | null;     // 거래대금 (원) = volume * close
  gap_pct: number | null;           // (당일시가-전일종가)/전일종가 * 100
  cum_return_3d: number | null;     // 3일 누적 수익률 (%)
  // 기본 점수 (stock_cache 기반)
  score_total: number;
  score_valuation: number;
  score_supply: number;
  score_signal: number;
  score_momentum: number;
  // 리스크/촉매 점수
  score_risk?: number;
  score_catalyst?: number;
  // 거래 관련 추가 필드
  daily_trading_value?: number | null;
  avg_trading_value_20d?: number | null;
  turnover_rate?: number | null;
  // DART/리스크 관련 필드
  is_managed?: boolean;
  has_recent_cbw?: boolean;
  major_shareholder_pct?: number | null;
  major_shareholder_delta?: number | null;
  audit_opinion?: string | null;
  has_treasury_buyback?: boolean;
  revenue_growth_yoy?: number | null;
  operating_profit_growth_yoy?: number | null;
  // 신호/등급 관련 필드
  signal_date?: string | null;
  grade?: string;
  characters?: string[];
  recommendation?: string;
  // AI 추천 데이터 (ai_recommendations 있는 경우)
  ai?: {
    total_score: number;
    signal_score: number;
    trend_score: number;
    valuation_score: number;
    supply_score: number;
    rsi: number | null;
    golden_cross: boolean;
    bollinger_bottom: boolean;
    phoenix_pattern: boolean;
    macd_cross: boolean;
    volume_surge: boolean;
    week52_low_near: boolean;
    double_top: boolean;
    disparity_rebound: boolean;
    volume_breakout: boolean;
    consecutive_drop_rebound: boolean;
    foreign_buying: boolean;
    institution_buying: boolean;
    volume_vs_sector: boolean;
    low_short_sell: boolean;
  };
}

/**
 * 각 카테고리 0~100 정규화 점수 산출 (애널리스트 관점)
 *
 * - score_valuation (0~100): 저평가 매력도 (PER·PBR·ROE 복합)
 * - score_supply    (0~100): 수급 동향 (외국인·기관·공매도)
 * - score_signal    (0~100): AI 신호 신뢰도 (빈도 + 최근성)
 * - score_momentum  (0~100): 기술적 모멘텀 (가격위치 + 등락률, 과열시 감점)
 */
function calcScore(
  stock: Omit<StockRankItem, 'score_total' | 'score_valuation' | 'score_supply' | 'score_signal' | 'score_momentum' | 'ai'>,
  todayStr: string,
  sectorAvgPct: number | null = null, // 같은 섹터 평균 등락률
  scoringModel: string = 'standard', // 점수 계산 모델
) {
  // ── 밸류에이션 (0~100) ──
  const hasForward = stock.forward_per !== null || stock.target_price !== null || stock.invest_opinion !== null;
  let vPer = 0, vPbr = 0, vRoe = 0, vUpside = 0, vOpinion = 0;

  if (hasForward) {
    // Forward PER (0~35)
    if (stock.forward_per !== null && stock.forward_per > 0) {
      if (stock.forward_per < 5) vPer = 35;
      else if (stock.forward_per < 8) vPer = 28;
      else if (stock.forward_per < 12) vPer = 18;
      else if (stock.forward_per < 15) vPer = 8;
      else if (stock.forward_per < 20) vPer = 3;
    } else if (stock.per !== null && stock.per > 0) {
      // forward PER 없으면 trailing 폴백
      if (stock.per < 5) vPer = 35;
      else if (stock.per < 8) vPer = 28;
      else if (stock.per < 12) vPer = 18;
      else if (stock.per < 15) vPer = 8;
      else if (stock.per < 20) vPer = 3;
    }
    // 목표주가 상승여력 (0~25)
    if (stock.target_price && stock.current_price && stock.current_price > 0) {
      const upside = ((stock.target_price - stock.current_price) / stock.current_price) * 100;
      if (upside >= 50) vUpside = 25;
      else if (upside >= 30) vUpside = 20;
      else if (upside >= 15) vUpside = 12;
      else if (upside >= 5) vUpside = 5;
    }
    // 투자의견 (0~15)
    if (stock.invest_opinion !== null && stock.invest_opinion > 0) {
      if (stock.invest_opinion >= 4.5) vOpinion = 15;
      else if (stock.invest_opinion >= 3.5) vOpinion = 10;
      else if (stock.invest_opinion >= 2.5) vOpinion = 3;
    }
  } else {
    // Forward 없으면 trailing 기준
    if (stock.per !== null && stock.per > 0) {
      if (stock.per < 5) vPer = 35;
      else if (stock.per < 8) vPer = 28;
      else if (stock.per < 12) vPer = 18;
      else if (stock.per < 15) vPer = 8;
      else if (stock.per < 20) vPer = 3;
    }
    if (stock.pbr !== null && stock.pbr > 0) {
      if (stock.pbr < 0.3) vPbr = 35;
      else if (stock.pbr < 0.5) vPbr = 30;
      else if (stock.pbr < 0.8) vPbr = 20;
      else if (stock.pbr < 1.0) vPbr = 10;
      else if (stock.pbr < 1.5) vPbr = 3;
    }
  }
  if (stock.roe !== null) {
    if (stock.roe > 25) vRoe = 30;
    else if (stock.roe > 20) vRoe = 25;
    else if (stock.roe > 15) vRoe = 20;
    else if (stock.roe > 10) vRoe = 12;
    else if (stock.roe > 5) vRoe = 5;
  }
  // 배당수익률 가산 (0~15)
  let vDiv = 0;
  if (stock.dividend_yield !== null && stock.dividend_yield > 0) {
    if (stock.dividend_yield >= 5) vDiv = 15;
    else if (stock.dividend_yield >= 3) vDiv = 10;
    else if (stock.dividend_yield >= 1.5) vDiv = 5;
  }
  let score_valuation = Math.min(100, vPer + vPbr + vRoe + vDiv + vUpside + vOpinion);

  // 밸류에이션 추가 점수 (성장률 기반)
  const valBonus = calcValuationAdditions({
    revenue_growth_yoy: (stock as Record<string, unknown>).revenue_growth_yoy as number | null | undefined,
    operating_profit_growth_yoy: (stock as Record<string, unknown>).operating_profit_growth_yoy as number | null | undefined,
  });
  score_valuation = Math.min(100, Math.max(0, score_valuation + valBonus));

  // ── 수급 (0~100) ──
  // 1일 순매수 + 5일 누적 + 연속성 복합 판단
  let score_supply = 0;
  const foreignBuying = stock.foreign_net_qty !== null && stock.foreign_net_qty > 0;
  const instBuying = stock.institution_net_qty !== null && stock.institution_net_qty > 0;
  const foreign5d = stock.foreign_net_5d ?? 0;
  const inst5d = stock.institution_net_5d ?? 0;
  const foreignStreak = stock.foreign_streak ?? 0;
  const instStreak = stock.institution_streak ?? 0;

  // 오늘 순매수 (기본 시그널)
  if (foreignBuying) score_supply += 20;
  if (instBuying) score_supply += 20;

  // 5일 누적 순매수 (추세 확인)
  if (foreign5d > 0) score_supply += 12;
  if (inst5d > 0) score_supply += 12;

  // 연속 매수 (강한 의지 = 높은 가산점)
  if (foreignStreak >= 5) score_supply += 20;
  else if (foreignStreak >= 3) score_supply += 15;
  else if (foreignStreak >= 2) score_supply += 8;

  if (instStreak >= 5) score_supply += 20;
  else if (instStreak >= 3) score_supply += 15;
  else if (instStreak >= 2) score_supply += 8;

  // 동반매수 시너지 (외국인+기관 동시 5일 순매수)
  if (foreign5d > 0 && inst5d > 0) score_supply += 10;

  // 시총 대비 순매수 비율 (유의미한 규모인지)
  if (stock.market_cap && stock.market_cap > 0 && stock.current_price && stock.current_price > 0) {
    const totalNetAmount = ((stock.foreign_net_qty ?? 0) + (stock.institution_net_qty ?? 0)) * stock.current_price;
    const ratio = totalNetAmount / stock.market_cap;
    if (ratio > 0.001) score_supply += 8;        // 시총 대비 0.1% 이상
    else if (ratio > 0.0005) score_supply += 4;  // 0.05% 이상
  }

  // 공매도
  const shortSellFresh = stock.short_sell_updated_at?.slice(0, 10) === todayStr;
  if (shortSellFresh && stock.short_sell_ratio !== null && stock.short_sell_ratio >= 0) {
    if (stock.short_sell_ratio < 0.5) score_supply += 10;
    else if (stock.short_sell_ratio < 1) score_supply += 5;
  }
  score_supply = Math.min(100, score_supply);

  // 수급 추가 점수 (거래대금·회전율·자사주·대주주 기반)
  const supplyBonus = calcSupplyAdditions({
    daily_trading_value: (stock as Record<string, unknown>).trading_value as number | null | undefined,
    avg_trading_value_20d: (stock as Record<string, unknown>).avg_trading_value_20d as number | null | undefined,
    turnover_rate: (stock as Record<string, unknown>).turnover_rate as number | null | undefined,
    has_treasury_buyback: (stock as Record<string, unknown>).has_treasury_buyback as boolean | undefined,
    major_shareholder_delta: (stock as Record<string, unknown>).major_shareholder_delta as number | null | undefined,
  });
  score_supply = Math.min(100, Math.max(0, score_supply + supplyBonus));

  // ── 신호 신뢰도 (0~100) ──
  // 반복 추천 + 매수가 대비 현재가 위치
  let score_signal = 0;
  const cnt = stock.signal_count_30d ?? 0;

  // 신호 존재 자체가 핵심 — 반복될수록 확신
  if (cnt >= 5) score_signal += 60;
  else if (cnt >= 3) score_signal += 50;
  else if (cnt >= 2) score_signal += 40;
  else if (cnt >= 1) score_signal += 30;

  // 매수가 대비 현재가 갭 (보조 지표, 최대 ±20점)
  if (stock.latest_signal_price && stock.latest_signal_price > 0 && stock.current_price && stock.current_price > 0) {
    const gap = ((stock.current_price - stock.latest_signal_price) / stock.latest_signal_price) * 100;
    if (gap <= 0) score_signal += 20;          // 매수가 이하: 진입 기회
    else if (gap < 5) score_signal += 15;      // +5% 미만: 아직 초입
    else if (gap < 10) score_signal += 10;     // +5~10%: 유효
    else if (gap < 20) score_signal += 5;      // +10~20%: 상당 반영
    else score_signal -= 10;                    // +20% 이상: 추격매수 감점
  } else {
    // 매수가 정보 없으면 기본 가산
    if (cnt >= 1) score_signal += 10;
  }
  score_signal = Math.max(0, Math.min(100, score_signal));

  // ── 기술/모멘텀 (0~100) ──
  // 52주 범위 내 상대 위치(하단일수록 유리) + 단기 등락률(과열 감점)
  let score_momentum = 0;

  // 52주 범위 내 상대 위치: 하단일수록 상승 여력
  if (stock.current_price && stock.high_52w && stock.low_52w &&
      stock.high_52w > stock.low_52w) {
    const range = stock.high_52w - stock.low_52w;
    const position = (stock.current_price - stock.low_52w) / range; // 0=저점, 1=고점
    if (position <= 0.15) score_momentum += 40;       // 바닥권: 강한 반등 기대
    else if (position <= 0.30) score_momentum += 35;  // 저점 이탈 초기
    else if (position <= 0.50) score_momentum += 25;  // 중간 하단: 상승 여력
    else if (position <= 0.70) score_momentum += 15;  // 중간 상단
    else if (position <= 0.85) score_momentum += 8;   // 고점 접근
    else score_momentum += 3;                          // 52주 고점 근접 (상승 추세 유지)
  }

  // 단기 등락률: 상승 초입에 가점, 과열에 감점
  if (stock.price_change_pct !== null) {
    const pct = stock.price_change_pct;
    if (pct >= 1 && pct < 3) score_momentum += 30;       // 완만 상승: 진입 적기
    else if (pct >= 3 && pct < 5) score_momentum += 40;   // 상승 초입: 최적 모멘텀
    else if (pct >= 5 && pct < 10) score_momentum += 25;  // 상승 진행
    else if (pct >= 10 && pct < 15) score_momentum += 10; // 강한 상승
    else if (pct >= 15 && pct < 25) score_momentum -= 5;  // 과열 주의
    else if (pct >= 25) score_momentum -= 20;              // 극단적 급등: 강한 감점
    else if (pct >= 0 && pct < 1) score_momentum += 15;   // 보합~미약 상승
    else if (pct > -3) score_momentum += 5;                // 소폭 하락: 눌림목 가능
    else if (pct > -5) score_momentum += 3;                // 조정: 바닥 탐색
    else if (pct > -10) score_momentum += 0;               // 급락: 중립
    else score_momentum -= 10;                              // 폭락: 감점
  }

  // 섹터 상대강도: 같은 섹터 평균 대비 얼마나 강한지
  if (sectorAvgPct !== null && stock.price_change_pct !== null) {
    const relStrength = stock.price_change_pct - sectorAvgPct;
    if (relStrength >= 5) score_momentum += 20;        // 섹터 대비 +5% 이상: 강한 주도주
    else if (relStrength >= 2) score_momentum += 12;   // 섹터 대비 +2% 이상: 상대 강세
    else if (relStrength >= 0) score_momentum += 5;    // 섹터 평균 이상
    else if (relStrength < -5) score_momentum -= 10;   // 섹터 대비 크게 뒤처짐
  }
  score_momentum = Math.max(0, Math.min(100, score_momentum));

  // ── 리스크 점수 (감점 방식, 0 이하) ──
  const riskScore = calcRiskScore({
    is_managed: (stock as Record<string, unknown>).is_managed as boolean | undefined,
    audit_opinion: (stock as Record<string, unknown>).audit_opinion as string | null | undefined,
    has_recent_cbw: (stock as Record<string, unknown>).has_recent_cbw as boolean | undefined,
    major_shareholder_pct: (stock as Record<string, unknown>).major_shareholder_pct as number | null | undefined,
    major_shareholder_delta: (stock as Record<string, unknown>).major_shareholder_delta as number | null | undefined,
    daily_trading_value: (stock as Record<string, unknown>).trading_value as number | null | undefined,
    avg_trading_value_20d: (stock as Record<string, unknown>).avg_trading_value_20d as number | null | undefined,
    turnover_rate: (stock as Record<string, unknown>).turnover_rate as number | null | undefined,
    market_cap: (stock as Record<string, unknown>).market_cap as number | null | undefined,
  }, scoringModel as 'standard' | 'short_term');

  // 가중 합산: signal(10) + trend(35) + valuation(20) + supply(25) + risk(10) = 100
  const riskNormalized = Math.max(0, 100 + riskScore); // 0~100 스케일로 변환
  const score_total = Math.round(
    (score_signal * 10 +
     score_momentum * 35 +
     score_valuation * 20 +
     score_supply * 25 +
     riskNormalized * 10) / 100
  );
  return { score_total, score_valuation, score_supply, score_signal, score_momentum, score_risk: riskScore };
}

/**
 * 여러 종목의 일봉 데이터를 병렬 fetch (네이버 fchart API)
 * concurrency 제한으로 API 부하 방지
 */
async function fetchBulkDailyPrices(
  symbols: string[],
  concurrency = 10,
  days = 22,
): Promise<Map<string, NaverDailyPrice[]>> {
  const result = new Map<string, NaverDailyPrice[]>();
  if (symbols.length === 0) return result;

  const queue = [...symbols];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const sym = queue.shift()!;
      try {
        const prices = await fetchNaverDailyPrices(sym, days);
        if (prices.length > 0) result.set(sym, prices);
      } catch {
        // 개별 종목 실패 무시
      }
    }
  });
  await Promise.all(workers);
  return result;
}

function kstDayRange(dateStr: string) {
  return {
    start: `${dateStr}T00:00:00+09:00`,
    end: `${dateStr}T23:59:59+09:00`,
  };
}

/**
 * 스냅샷 테이블에서 캐싱된 랭킹 결과를 읽어온다.
 * 스냅샷이 없으면 null 반환 → 실시간 계산으로 폴백
 */
async function readSnapshot(
  supabase: ReturnType<typeof createServiceClient>,
  model: string,
  date: string,
): Promise<{ items: StockRankItem[]; snapshot_time: string | null } | null> {
  let query = supabase
    .from('stock_ranking_snapshot')
    .select('*')
    .eq('model', model)

  if (date === 'all' || date === 'signal_all') {
    const { data: latest } = await supabase
      .from('stock_ranking_snapshot')
      .select('snapshot_date')
      .eq('model', model)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .single()

    if (!latest) return null
    query = query.eq('snapshot_date', latest.snapshot_date)
  } else {
    query = query.eq('snapshot_date', date)
  }

  // Supabase 기본 1000건 제한 → 페이지네이션으로 전체 조회
  const allData: Record<string, unknown>[] = [];
  let offset = 0;
  while (true) {
    const { data: page, error: pageError } = await query
      .order('score_total', { ascending: false })
      .range(offset, offset + 999);
    if (pageError || !page?.length) break;
    allData.push(...page);
    if (page.length < 1000) break;
    offset += 1000;
  }
  if (!allData.length) return null;

  return {
    items: allData.map((row: Record<string, unknown>) => ({
      ...(row.raw_data as Record<string, unknown> ?? {}),
      symbol: row.symbol as string,
      name: row.name as string,
      market: row.market as string,
      current_price: row.current_price as number,
      market_cap: row.market_cap as number,
      score_total: Number(row.score_total),
      score_signal: Number(row.score_signal),
      score_valuation: Number(row.score_valuation),
      score_supply: Number(row.score_supply),
      score_momentum: Number(row.score_momentum),
      score_risk: Number(row.score_risk ?? 0),
      daily_trading_value: row.daily_trading_value as number | null,
      avg_trading_value_20d: row.avg_trading_value_20d as number | null,
      turnover_rate: Number(row.turnover_rate ?? 0),
      is_managed: row.is_managed as boolean,
      has_recent_cbw: row.has_recent_cbw as boolean,
      major_shareholder_pct: Number(row.major_shareholder_pct ?? 0),
      signal_date: row.signal_date as string | null,
      grade: row.grade as string,
      characters: row.characters as string[],
      recommendation: row.recommendation as string,
    })) as StockRankItem[],
    snapshot_time: (allData[0] as Record<string, unknown>)?.snapshot_time as string ?? null,
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    // 페이지네이션은 클라이언트에서 처리 — 서버는 전체 반환
    const page = 1;
    const limit = 99999;
    const q = searchParams.get('q')?.trim().toLowerCase() ?? '';
    const market = searchParams.get('market') ?? 'all';
    const model = searchParams.get('model') || 'standard';
    const refresh = searchParams.get('refresh') === 'true';

    const supabase = createServiceClient();
    const now = new Date();
    const todayStr = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dateParam = searchParams.get('date');
    const showAll = !dateParam || dateParam === 'all';
    const showWeek = dateParam === 'week';
    const showSignalAll = dateParam === 'signal_all'; // 신호전체: 최근 30일 신호 있는 종목

    // ── 스냅샷 캐시 읽기 (refresh가 아닐 때만) ──
    if (!refresh) {
      const snapshotDate = showAll || showSignalAll ? 'all' : (showWeek ? todayStr : (dateParam ?? todayStr));
      const snapshot = await readSnapshot(supabase, model, snapshotDate);
      if (snapshot) {
        let snapshotItems = snapshot.items;
        // signal_all: 신호 있는 종목만
        if (showSignalAll) {
          snapshotItems = snapshotItems.filter((s) =>
            (s.signal_count_30d ?? 0) > 0 || s.signal_date
          );
        }
        // 특정 날짜(오늘 등): 해당 날짜 BUY 신호 있는 종목만
        if (!showAll && !showSignalAll && !showWeek && dateParam) {
          const { data: sigRows } = await supabase
            .from('signals')
            .select('symbol')
            .gte('timestamp', `${dateParam}T00:00:00+09:00`)
            .lte('timestamp', `${dateParam}T23:59:59+09:00`)
            .in('signal_type', ['BUY', 'BUY_FORECAST']);
          if (sigRows && sigRows.length > 0) {
            const dateSigs = new Set(sigRows.map((r) => r.symbol as string));
            snapshotItems = snapshotItems.filter((s) => dateSigs.has(s.symbol));
          } else {
            return NextResponse.json({ items: [], total: 0, page: 1, limit: 99999, today: todayStr });
          }
        }
        // 검색 필터 적용
        if (q) {
          snapshotItems = snapshotItems.filter((s) =>
            s.name?.toLowerCase().includes(q) || s.symbol?.toLowerCase().includes(q)
          );
        }
        // 마켓 필터 적용
        const filteredItems = market !== 'all'
          ? snapshotItems.filter((s) => s.market === market)
          : snapshotItems;

        // ETF 분리 — market='ETF'인 종목은 별도 스코어링 (모멘텀 60% + 수급 40%)
        const regularFiltered = filteredItems.filter(s => s.market !== 'ETF');
        const etfFiltered = filteredItems.filter(s => s.market === 'ETF');
        for (const item of etfFiltered) {
          item.score_total = Math.round(
            (item.score_momentum * 60 + item.score_supply * 40) / 100
          );
        }
        etfFiltered.sort((a, b) => b.score_total - a.score_total);

        const { data: status } = await supabase
          .from('snapshot_update_status')
          .select('updating, last_updated')
          .single();

        // 스냅샷이 30분 이상 오래되었으면 stale 표시
        const snapshotAge = snapshot.snapshot_time
          ? Date.now() - new Date(snapshot.snapshot_time).getTime()
          : Infinity;
        const isStale = snapshotAge > 30 * 60 * 1000;

        return NextResponse.json({
          items: regularFiltered,
          etf_items: etfFiltered,
          total: regularFiltered.length,
          etf_total: etfFiltered.length,
          page: 1,
          limit: 99999,
          today: todayStr,
          snapshot_time: snapshot.snapshot_time,
          updating: status?.updating ?? false,
          stale: isStale,
        }, {
          headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
        });
      }
    }

    // 이번주(월~오늘) 범위 계산
    const weekStart = (() => {
      const day = now.getUTCDay(); // UTC 기준 요일 (KST +9h 반영된 now)
      const kstDay = new Date(now.getTime() + 9 * 60 * 60 * 1000).getDay();
      const daysFromMonday = kstDay === 0 ? 6 : kstDay - 1;
      return new Date(now.getTime() + 9 * 60 * 60 * 1000 - daysFromMonday * 86400000)
        .toISOString().slice(0, 10);
    })();

    const dateStr = showAll || showWeek || showSignalAll ? todayStr : dateParam;

    // ── 날짜 지정 시: 해당 날짜/기간 BUY 신호 심볼 먼저 조회
    let dateSymbols: Set<string> | null = null;
    // 선택된 날짜의 실제 신호 날짜 (stock_cache.latest_signal_date 대체)
    const dateSignalMap = new Map<string, string>();
    if (!showAll && !showSignalAll) {
      const start = showWeek ? `${weekStart}T00:00:00+09:00` : kstDayRange(dateStr).start;
      const end = showWeek ? `${todayStr}T23:59:59+09:00` : kstDayRange(dateStr).end;
      const { data: sigRows } = await supabase
        .from('signals')
        .select('symbol, timestamp')
        .gte('timestamp', start)
        .lte('timestamp', end)
        .in('signal_type', ['BUY', 'BUY_FORECAST'])
        .order('timestamp', { ascending: false });
      if (sigRows && sigRows.length > 0) {
        dateSymbols = new Set<string>();
        for (const r of sigRows) {
          const sym = r.symbol as string;
          dateSymbols.add(sym);
          // 해당 날짜의 가장 최근 BUY 신호 시각 저장
          if (!dateSignalMap.has(sym)) {
            dateSignalMap.set(sym, r.timestamp as string);
          }
        }
      } else {
        // 해당 날짜/기간 신호 없음 → 빈 결과 반환
        return NextResponse.json({ items: [], total: 0, page, limit, today: todayStr });
      }
    }

    // ── stock_cache + ai_recommendations 병렬 조회
    const allRows: Record<string, unknown>[] = [];
    let from = 0;

    const aiSelect = 'symbol, total_score, signal_score, technical_score, valuation_score, supply_score, rsi, golden_cross, bollinger_bottom, phoenix_pattern, macd_cross, volume_surge, week52_low_near, double_top, disparity_rebound, volume_breakout, consecutive_drop_rebound, foreign_buying, institution_buying, volume_vs_sector, low_short_sell';
    const [, aiRecsResult, sectorResult, dartResult] = await Promise.all([
      (async () => {
        while (true) {
          let query = supabase
            .from('stock_cache')
            .select('symbol, name, market, current_price, price_change_pct, per, pbr, roe, foreign_net_qty, institution_net_qty, foreign_net_5d, institution_net_5d, foreign_streak, institution_streak, short_sell_ratio, short_sell_updated_at, investor_updated_at, signal_count_30d, latest_signal_type, latest_signal_date, latest_signal_price, high_52w, low_52w, dividend_yield, market_cap, forward_per, target_price, invest_opinion, float_shares, is_managed, volume')
            .not('current_price', 'is', null)
            .range(from, from + 999);
          if (market !== 'all') query = query.eq('market', market);
          const { data } = await query;
          if (!data || data.length === 0) break;
          allRows.push(...data);
          if (data.length < 1000) break;
          from += 1000;
        }
      })(),
      supabase
        .from('ai_recommendations')
        .select(aiSelect)
        .eq('date', todayStr),
      supabase
        .from('stock_info')
        .select('symbol, sector'),
      supabase
        .from('stock_dart_info')
        .select('*'),
    ]);

    const aiRecMap = new Map(
      (aiRecsResult.data ?? []).map((r) => [r.symbol as string, r])
    );
    const sectorMap = new Map(
      (sectorResult.data ?? []).map((r) => [r.symbol as string, r.sector as string | null])
    );

    // DART 데이터 맵 생성
    const dartMap = new Map<string, Record<string, unknown>>();
    if (dartResult.data) {
      for (const d of dartResult.data) {
        dartMap.set(d.symbol as string, d as Record<string, unknown>);
      }
    }

    // sector + DART 정보를 allRows에 병합
    for (const row of allRows) {
      row.sector = sectorMap.get(row.symbol as string) ?? null;

      // DART 데이터 병합 (리스크/수급/밸류에이션 스코어링용)
      const dart = dartMap.get(row.symbol as string) ?? {};
      row.is_managed = (row.is_managed as boolean) ?? false;
      const floatShares = row.float_shares as number | null;
      const volume = row.volume as number | null;
      row.turnover_rate = floatShares ? ((volume ?? 0) / floatShares) * 100 : null;
      row.has_recent_cbw = (dart.has_recent_cbw as boolean) ?? false;
      row.major_shareholder_pct = (dart.major_shareholder_pct as number) ?? null;
      row.major_shareholder_delta = (dart.major_shareholder_delta as number) ?? null;
      row.audit_opinion = (dart.audit_opinion as string) ?? null;
      row.has_treasury_buyback = (dart.has_treasury_buyback as boolean) ?? false;
      row.revenue_growth_yoy = (dart.revenue_growth_yoy as number) ?? null;
      row.operating_profit_growth_yoy = (dart.operating_profit_growth_yoy as number) ?? null;
    }

    // ── 신호 종목 중 수급 stale인 종목 live 보강 ──
    // 화면에 표시될 종목만 대상 (전 종목 X)
    const signalSymbols = allRows
      .filter((r) => {
        const sym = r.symbol as string;
        // 날짜 필터된 종목이거나 신호가 있는 종목
        const isRelevant = dateSymbols ? dateSymbols.has(sym) : ((r.signal_count_30d as number) ?? 0) > 0;
        if (!isRelevant) return false;
        const invDate = (r.investor_updated_at as string)?.slice(0, 10);
        return invDate !== todayStr; // stale인 것만
      })
      .map((r) => r.symbol as string);

    // 지표(PER/52주 등) null인 종목도 보강 대상에 포함
    const indicatorNullSymbols = signalSymbols.filter((sym) => {
      const r = allRows.find((row) => row.symbol === sym);
      return r && (r.per === null || r.high_52w === null);
    });

    // 수급 + 지표 병렬 live 조회
    const [liveInvMap, liveIndMap] = await Promise.all([
      signalSymbols.length > 0
        ? (async () => {
            const m = new Map<string, StockInvestorData>();
            const chunks = [];
            for (let i = 0; i < signalSymbols.length; i += 200)
              chunks.push(signalSymbols.slice(i, i + 200));
            const results = await Promise.all(chunks.map(c => fetchBulkInvestorData(c, 20)));
            for (const r of results) for (const [k, v] of r) m.set(k, v);
            return m;
          })()
        : Promise.resolve(new Map<string, StockInvestorData>()),
      indicatorNullSymbols.length > 0
        ? fetchBulkIndicators(indicatorNullSymbols, 20)
        : Promise.resolve(new Map()),
    ]);

    // live 결과를 allRows에 반영
    for (const row of allRows) {
      const sym = row.symbol as string;
      const inv = liveInvMap.get(sym);
      if (inv) {
        row.foreign_net_qty = inv.foreign_net;
        row.institution_net_qty = inv.institution_net;
        row.foreign_net_5d = inv.foreign_net_5d;
        row.institution_net_5d = inv.institution_net_5d;
        row.foreign_streak = inv.foreign_streak;
        row.institution_streak = inv.institution_streak;
        row.investor_updated_at = todayStr;
      }
      const ind = liveIndMap.get(sym);
      if (ind) {
        if (ind.per > 0) row.per = ind.per;
        if (ind.pbr > 0) row.pbr = ind.pbr;
        if (ind.roe !== 0) row.roe = ind.roe;
        if (ind.high_52w > 0) row.high_52w = ind.high_52w;
        if (ind.low_52w > 0) row.low_52w = ind.low_52w;
        if (ind.dividend_yield > 0) row.dividend_yield = ind.dividend_yield;
        if (ind.forward_per !== null) row.forward_per = ind.forward_per;
        if (ind.target_price !== null) row.target_price = ind.target_price;
        if (ind.invest_opinion !== null) row.invest_opinion = ind.invest_opinion;
      }
    }

    // live 결과를 stock_cache에도 비동기 저장 (다음 요청에서도 유효하도록)
    if (liveInvMap.size > 0 || liveIndMap.size > 0) {
      const cacheUpdates: Record<string, unknown>[] = [];
      for (const sym of new Set([...liveInvMap.keys(), ...liveIndMap.keys()])) {
        const update: Record<string, unknown> = { symbol: sym };
        const inv = liveInvMap.get(sym);
        if (inv) {
          update.foreign_net_qty = inv.foreign_net;
          update.institution_net_qty = inv.institution_net;
          update.foreign_net_5d = inv.foreign_net_5d;
          update.institution_net_5d = inv.institution_net_5d;
          update.foreign_streak = inv.foreign_streak;
          update.institution_streak = inv.institution_streak;
          update.investor_updated_at = new Date().toISOString();
        }
        const ind = liveIndMap.get(sym);
        if (ind) {
          if (ind.per > 0) update.per = ind.per;
          if (ind.pbr > 0) update.pbr = ind.pbr;
          if (ind.high_52w > 0) update.high_52w = ind.high_52w;
          if (ind.low_52w > 0) update.low_52w = ind.low_52w;
          if (ind.forward_per !== null) update.forward_per = ind.forward_per;
          if (ind.target_price !== null) update.target_price = ind.target_price;
          if (ind.invest_opinion !== null) update.invest_opinion = ind.invest_opinion;
        }
        cacheUpdates.push(update);
      }
      // 비동기 — 응답 차단하지 않음
      Promise.resolve(supabase.from('stock_cache').upsert(cacheUpdates, { onConflict: 'symbol' }))
        .catch((e: unknown) => console.error('[stock-ranking] cache upsert error:', e));
    }

    // ── 섹터별 평균 등락률 집계 (인메모리, 추가 쿼리 없음) ──
    const sectorPctMap = new Map<string, number[]>();
    for (const r of allRows) {
      const sec = sectorMap.get(r.symbol as string);
      const pct = r.price_change_pct as number | null;
      if (sec && pct !== null) {
        if (!sectorPctMap.has(sec)) sectorPctMap.set(sec, []);
        sectorPctMap.get(sec)!.push(pct);
      }
    }
    const sectorAvgPctMap = new Map<string, number>();
    for (const [sec, pcts] of sectorPctMap) {
      sectorAvgPctMap.set(sec, pcts.reduce((a, b) => a + b, 0) / pcts.length);
    }

    // ── 점수 계산 + ai 병합 + 날짜 필터
    const scored: StockRankItem[] = allRows
      .filter((r) => r.symbol && r.name)
      .filter((r) => {
        const sym = r.symbol as string;
        if (dateSymbols) return dateSymbols.has(sym);
        if (showSignalAll) return ((r.signal_count_30d as number) ?? 0) > 0;
        return true;
      })
      .map((r) => {
        const base = r as Omit<StockRankItem, 'score_total' | 'score_valuation' | 'score_supply' | 'score_signal' | 'score_momentum' | 'ai'>;
        const dateSig = dateSignalMap.get(base.symbol);
        if (dateSig) {
          base.latest_signal_date = dateSig;
          base.latest_signal_type = 'BUY';
        }
        const sector = sectorMap.get(base.symbol) ?? null;
        const sectorAvgPct = sector ? (sectorAvgPctMap.get(sector) ?? null) : null;
        const scores = calcScore(base, todayStr, sectorAvgPct, model);
        const aiRec = aiRecMap.get(base.symbol);
        const item: StockRankItem = {
          ...base,
          ...scores,
          volume_ratio: null,
          close_position: null,
          trading_value: null,
          gap_pct: null,
          cum_return_3d: null,
        };
        if (aiRec) {
          // AI 점수를 0~100으로 정규화하여 score_* 필드도 통일 (이중 체계 제거)
          const clamp100 = (v: number) => Math.round(Math.min(100, Math.max(0, v)));
          item.score_signal = clamp100((aiRec.signal_score ?? 0) / 30 * 100);
          item.score_momentum = clamp100((aiRec.technical_score ?? 0) / 58 * 100);
          item.score_valuation = clamp100((aiRec.valuation_score ?? 0) / 25 * 100);
          item.score_supply = clamp100(((aiRec.supply_score ?? 0) + 10) / 55 * 100);
          item.score_total = Math.round(
            (item.score_signal + item.score_momentum + item.score_valuation + item.score_supply) / 4
          );
          item.ai = {
            total_score: aiRec.total_score ?? 0,
            signal_score: aiRec.signal_score ?? 0,
            trend_score: aiRec.technical_score ?? 0, // DB 컬럼은 아직 technical_score (Task 7 마이그레이션 후 변경)
            valuation_score: aiRec.valuation_score ?? 0,
            supply_score: aiRec.supply_score ?? 0,
            rsi: aiRec.rsi ?? null,
            golden_cross: aiRec.golden_cross ?? false,
            bollinger_bottom: aiRec.bollinger_bottom ?? false,
            phoenix_pattern: aiRec.phoenix_pattern ?? false,
            macd_cross: aiRec.macd_cross ?? false,
            volume_surge: aiRec.volume_surge ?? false,
            week52_low_near: aiRec.week52_low_near ?? false,
            double_top: aiRec.double_top ?? false,
            disparity_rebound: aiRec.disparity_rebound ?? false,
            volume_breakout: aiRec.volume_breakout ?? false,
            consecutive_drop_rebound: aiRec.consecutive_drop_rebound ?? false,
            foreign_buying: aiRec.foreign_buying ?? false,
            institution_buying: aiRec.institution_buying ?? false,
            volume_vs_sector: aiRec.volume_vs_sector ?? false,
            low_short_sell: aiRec.low_short_sell ?? false,
          };
        }
        return item;
      });

    // ── 초단기 모멘텀용 daily_prices 조회 ──
    const displaySymbols = scored.map(s => s.symbol);
    if (displaySymbols.length > 0) {
      type DailyPrice = { date: string; open: number | null; high: number; low: number; close: number; volume: number };
      const dpResults: Record<string, unknown>[] = [];
      for (let i = 0; i < displaySymbols.length; i += 300) {
        const chunk = displaySymbols.slice(i, i + 300);
        const { data } = await supabase
          .from('daily_prices')
          .select('symbol, date, open, high, low, close, volume')
          .in('symbol', chunk)
          .order('date', { ascending: false })
          .limit(chunk.length * 22);
        if (data) dpResults.push(...data);
      }

      // symbol별 그룹핑 (날짜 내림차순 유지)
      const dpMap = new Map<string, DailyPrice[]>();
      for (const p of dpResults) {
        const sym = p.symbol as string;
        if (!dpMap.has(sym)) dpMap.set(sym, []);
        dpMap.get(sym)!.push({
          date: p.date as string,
          open: p.open as number | null,
          high: p.high as number,
          low: p.low as number,
          close: p.close as number,
          volume: p.volume as number,
        });
      }

      // 각 scored item에 초단기 필드 계산
      for (const item of scored) {
        const prices = dpMap.get(item.symbol);
        if (!prices || prices.length === 0) continue;

        const today = prices[0];
        const yesterday = prices.length > 1 ? prices[1] : null;
        // 3일전 = prices[3] (today, -1d, -2d, -3d)
        const threeDaysAgo = prices.length > 3 ? prices[3] : null;

        // volume_ratio: 당일거래량 / 20일평균거래량
        const volSlice = prices.slice(1, 21); // 전일~20일전
        const avgVol = volSlice.length > 0
          ? volSlice.reduce((sum, p) => sum + p.volume, 0) / volSlice.length
          : 0;
        item.volume_ratio = avgVol > 0
          ? Math.round((today.volume / avgVol) * 100) / 100
          : null;

        // close_position: (종가-저가)/(고가-저가)
        item.close_position = today.high === today.low
          ? 1.0
          : Math.round(((today.close - today.low) / (today.high - today.low)) * 100) / 100;

        // trading_value: 거래대금
        item.trading_value = today.volume * today.close;

        // gap_pct: 갭 비율
        item.gap_pct = today.open != null && yesterday
          ? Math.round(((today.open - yesterday.close) / yesterday.close) * 10000) / 100
          : null;

        // cum_return_3d: 3일 누적 수익률
        item.cum_return_3d = threeDaysAgo && threeDaysAgo.close > 0
          ? Math.round(((today.close - threeDaysAgo.close) / threeDaysAgo.close) * 10000) / 100
          : null;
      }

      // ── 장중 daily_prices live 보강 (오늘 데이터 없는 종목) ──
      const dpStaleSymbols = scored
        .filter(item => {
          const prices = dpMap.get(item.symbol);
          if (!prices || prices.length === 0) return true;
          return prices[0].date !== todayStr;
        })
        .filter(item => {
          // 신호 있는 종목만 (전체 2000+종목 다 fetch하면 안 됨)
          return (item.signal_count_30d ?? 0) > 0 || dateSymbols?.has(item.symbol);
        })
        .map(item => item.symbol);

      if (dpStaleSymbols.length > 0) {
        const liveDpMap = await fetchBulkDailyPrices(dpStaleSymbols, 10, 22);

        // scored items 업데이트
        for (const item of scored) {
          const livePrices = liveDpMap.get(item.symbol);
          if (!livePrices || livePrices.length === 0) continue;

          const liveToday = livePrices[0];
          const liveYesterday = livePrices.length > 1 ? livePrices[1] : null;
          const liveThreeDaysAgo = livePrices.length > 3 ? livePrices[3] : null;

          // volume_ratio
          const volSliceLive = livePrices.slice(1, 21);
          const avgVolLive = volSliceLive.length > 0
            ? volSliceLive.reduce((sum, p) => sum + p.volume, 0) / volSliceLive.length
            : 0;
          item.volume_ratio = avgVolLive > 0
            ? Math.round((liveToday.volume / avgVolLive) * 100) / 100
            : null;

          // close_position
          item.close_position = liveToday.high === liveToday.low
            ? 1.0
            : Math.round(((liveToday.close - liveToday.low) / (liveToday.high - liveToday.low)) * 100) / 100;

          // trading_value
          item.trading_value = liveToday.volume * liveToday.close;

          // gap_pct
          item.gap_pct = liveToday.open && liveYesterday
            ? Math.round(((liveToday.open - liveYesterday.close) / liveYesterday.close) * 10000) / 100
            : null;

          // cum_return_3d
          item.cum_return_3d = liveThreeDaysAgo && liveThreeDaysAgo.close > 0
            ? Math.round(((liveToday.close - liveThreeDaysAgo.close) / liveThreeDaysAgo.close) * 10000) / 100
            : null;

          // price_change_pct도 갱신 (장중 최신 반영)
          if (liveYesterday) {
            item.price_change_pct = Math.round(((liveToday.close - liveYesterday.close) / liveYesterday.close) * 10000) / 100;
          }
          // current_price도 갱신
          item.current_price = liveToday.close;
        }

        // daily_prices에 비동기 upsert (다음 요청에서 DB에서 직접 읽힘)
        const dpUpserts: Array<{symbol: string; date: string; open: number; high: number; low: number; close: number; volume: number}> = [];
        for (const [sym, prices] of liveDpMap) {
          const todayPrice = prices[0];
          if (todayPrice && todayPrice.date === todayStr) {
            dpUpserts.push({
              symbol: sym,
              date: todayPrice.date,
              open: todayPrice.open,
              high: todayPrice.high,
              low: todayPrice.low,
              close: todayPrice.close,
              volume: todayPrice.volume,
            });
          }
        }
        if (dpUpserts.length > 0) {
          Promise.resolve(
            supabase.from('daily_prices').upsert(dpUpserts, { onConflict: 'symbol,date' })
          ).catch((e: unknown) => console.error('[stock-ranking] daily_prices upsert error:', e));
        }

        // stock_cache의 price_change_pct, current_price도 갱신
        const cacheUpdatesForPct: Array<{symbol: string; price_change_pct: number; current_price: number}> = [];
        for (const [sym, prices] of liveDpMap) {
          const lpToday = prices[0];
          const lpYesterday = prices.length > 1 ? prices[1] : null;
          if (lpToday && lpYesterday) {
            cacheUpdatesForPct.push({
              symbol: sym,
              price_change_pct: Math.round(((lpToday.close - lpYesterday.close) / lpYesterday.close) * 10000) / 100,
              current_price: lpToday.close,
            });
          }
        }
        if (cacheUpdatesForPct.length > 0) {
          Promise.resolve(
            supabase.from('stock_cache').upsert(cacheUpdatesForPct, { onConflict: 'symbol' })
          ).catch((e: unknown) => console.error('[stock-ranking] cache pct upsert error:', e));
        }
      }
    }

    // ── 검색 필터
    const filtered = q
      ? scored.filter((s) => s.name?.toLowerCase().includes(q) || s.symbol?.toLowerCase().includes(q))
      : scored;

    // ── ETF 분리 — market='ETF'인 종목은 모멘텀(60%) + 수급(40%)으로 재계산 ──
    const regularItems: StockRankItem[] = [];
    const etfItems: StockRankItem[] = [];
    for (const item of filtered) {
      if (item.market === 'ETF') {
        const etfTotal = Math.round(
          (item.score_momentum * 60 + item.score_supply * 40) / 100
        );
        etfItems.push({ ...item, score_total: etfTotal });
      } else {
        regularItems.push(item);
      }
    }

    // ── 정렬: AI 우선, 그 다음 score_total 내림차순
    regularItems.sort((a, b) => {
      const aHasAi = a.ai ? 1 : 0;
      const bHasAi = b.ai ? 1 : 0;
      if (aHasAi !== bHasAi) return bHasAi - aHasAi;
      return b.score_total - a.score_total;
    });
    etfItems.sort((a, b) => b.score_total - a.score_total);

    const total = regularItems.length;
    const offset = (page - 1) * limit;
    const items = regularItems.slice(offset, offset + limit);

    // ── 비동기 스냅샷 저장 (ETF 포함 전체 저장 — ETF 재스코어링은 읽기 시점) ──
    void (async () => {
      try {
        const snapshotRows = filtered.map((item: StockRankItem) => ({
          snapshot_date: todayStr,
          snapshot_time: new Date().toISOString(),
          model: model || 'standard',
          symbol: item.symbol,
          name: item.name,
          market: item.market,
          current_price: item.current_price,
          market_cap: item.market_cap,
          daily_trading_value: item.trading_value ?? null,
          avg_trading_value_20d: item.avg_trading_value_20d ?? null,
          turnover_rate: item.turnover_rate ?? null,
          is_managed: item.is_managed ?? false,
          has_recent_cbw: item.has_recent_cbw ?? false,
          major_shareholder_pct: item.major_shareholder_pct ?? null,
          score_total: item.score_total,
          score_signal: item.score_signal,
          score_trend: item.score_momentum,
          score_valuation: item.score_valuation,
          score_supply: item.score_supply,
          score_risk: item.score_risk ?? 0,
          score_momentum: item.score_momentum,
          score_catalyst: item.score_catalyst ?? 0,
          grade: item.grade ?? null,
          characters: item.characters ?? null,
          recommendation: item.recommendation ?? null,
          signal_date: item.latest_signal_date ?? null,
          raw_data: item,
        }));

        // 500건씩 배치 upsert
        for (let i = 0; i < snapshotRows.length; i += 500) {
          await supabase
            .from('stock_ranking_snapshot')
            .upsert(snapshotRows.slice(i, i + 500), {
              onConflict: 'snapshot_date,model,symbol',
              ignoreDuplicates: false,
            });
        }
      } catch (e) {
        console.error('스냅샷 저장 실패:', e);
      }
    })();

    return NextResponse.json({
      items, total, page, limit, today: todayStr,
      etf_items: etfItems, etf_total: etfItems.length,
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
    });
  } catch (e) {
    console.error('[stock-ranking]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
