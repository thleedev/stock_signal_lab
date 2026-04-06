/**
 * GET /api/v1/stock-analysis?symbol=XXXXXX
 *
 * 종목별 투자 체크리스트 데이터를 반환합니다.
 * calcCompositeScore 각 서브모듈의 reasons 배열을 카테고리별로 구성하여 반환합니다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { calcTechnicalReversal } from '@/lib/scoring/technical-reversal';
import { calcSupplyStrength } from '@/lib/scoring/supply-strength';
import { calcValuationAttractiveness } from '@/lib/scoring/valuation-attractiveness';
import { calcSignalBonus } from '@/lib/scoring/signal-bonus';
import { calcRiskScore } from '@/lib/scoring/risk-score';
import type { DailyPrice } from '@/lib/ai-recommendation/technical-score';
import type { ScoreReason } from '@/types/score-reason';

export const dynamic = 'force-dynamic';

/** 카테고리별 체크리스트 항목 */
export interface ChecklistReason {
  /** 조건명 */
  label: string;
  /** 조건 충족 여부 */
  passed: boolean;
  /** 실제 값 설명 (예: "PER 8.2배") */
  value?: string;
}

/** 카테고리별 점수 및 체크리스트 */
export interface AnalysisCategory {
  id: 'technical' | 'supply' | 'valuation' | 'signal' | 'risk';
  label: string;
  score: number;
  reasons: ChecklistReason[];
}

/** stock-analysis API 응답 타입 */
export interface StockAnalysisResponse {
  symbol: string;
  scored_at: string;
  categories: AnalysisCategory[];
}

/** ScoreReason 배열을 ChecklistReason 배열로 변환합니다. */
function toChecklistReasons(reasons: ScoreReason[]): ChecklistReason[] {
  return reasons.map((r) => ({
    label: r.label,
    passed: r.met,
    value: r.detail || undefined,
  }));
}

/**
 * 리스크 점수(음수 또는 0)를 0~100 범위의 표시용 감점 점수로 변환합니다.
 * 값이 클수록 리스크가 높다는 의미입니다.
 */
function riskToDisplayScore(riskScore: number): number {
  return Math.min(100, Math.max(0, Math.abs(riskScore)));
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');

  if (!symbol) {
    return NextResponse.json({ error: 'symbol 파라미터가 필요합니다.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // 90일 전 날짜 계산 (일봉 조회 범위)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  // 30일 전 날짜 계산 (신호 조회 범위)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString();

  try {
    // 1. 필요한 데이터를 병렬로 조회합니다.
    const [cacheRes, pricesRes, dartRes, signalsRes] = await Promise.all([
      // stock_cache: 종목 재무·수급 데이터
      supabase
        .from('stock_cache')
        .select(
          'symbol, current_price, market_cap, per, pbr, roe, dividend_yield, ' +
          'high_52w, low_52w, forward_per, target_price, invest_opinion, ' +
          'foreign_streak, institution_streak, foreign_net_qty, institution_net_qty, ' +
          'foreign_net_5d, institution_net_5d, short_sell_ratio, ' +
          'is_managed, updated_at, latest_signal_price, signal_count_30d'
        )
        .eq('symbol', symbol)
        .single(),

      // daily_prices: 최근 90일 일봉 (오름차순)
      supabase
        .from('daily_prices')
        .select('date, open, high, low, close, volume')
        .eq('symbol', symbol)
        .gte('date', ninetyDaysAgo)
        .order('date', { ascending: true }),

      // stock_dart_info: DART 재무 데이터 (CB/BW, 감사의견, 대주주 지분율 등)
      supabase
        .from('stock_dart_info')
        .select(
          'symbol, has_recent_cbw, audit_opinion, ' +
          'major_shareholder_pct, major_shareholder_delta, has_treasury_buyback'
        )
        .eq('symbol', symbol)
        .maybeSingle(),

      // signals: 최근 30일 BUY 신호
      supabase
        .from('signals')
        .select('source, timestamp, signal_price')
        .eq('symbol', symbol)
        .in('signal_type', ['BUY', 'BUY_FORECAST'])
        .gte('timestamp', thirtyDaysAgo)
        .order('timestamp', { ascending: false }),
    ]);

    if (cacheRes.error || !cacheRes.data) {
      return NextResponse.json(
        { error: `종목 데이터를 찾을 수 없습니다: ${symbol}` },
        { status: 404 }
      );
    }

    // Supabase generic 반환 타입을 Record로 캐스팅하여 필드 접근
    const cache = cacheRes.data as unknown as Record<string, unknown>;
    const prices = (pricesRes.data ?? []) as DailyPrice[];
    const dart = dartRes.data as unknown as Record<string, unknown> | null;
    const signals = signalsRes.data ?? [];

    // 2. 신호 관련 파생값 계산
    // 오늘 KST 날짜 문자열
    const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const todayKst = nowKst.toISOString().slice(0, 10);
    const startOfTodayKst = `${todayKst}T00:00:00+09:00`;

    // 오늘 신호를 발생시킨 고유 소스(채널) 수
    const todaySignals = signals.filter(
      (s) => s.timestamp >= startOfTodayKst
    );
    const todaySourceCount = new Set(todaySignals.map((s) => s.source)).size;

    // 마지막 신호로부터 경과 일수 및 신호가 점수 계산
    let daysSinceLastSignal: number | null = null;
    // cache의 latest_signal_price 우선 사용
    let lastSignalPrice: number | null =
      (cache.latest_signal_price as number | null) ?? null;
    if (signals.length > 0) {
      const lastSignal = signals[0];
      const lastTs = new Date(lastSignal.timestamp);
      daysSinceLastSignal = Math.floor(
        (Date.now() - lastTs.getTime()) / (1000 * 60 * 60 * 24)
      );
      // signals 테이블의 signal_price 컬럼 활용
      const signalPrice = (lastSignal as Record<string, unknown>).signal_price;
      if (signalPrice != null && lastSignalPrice === null) {
        lastSignalPrice = signalPrice as number;
      }
    }

    // 30일 내 BUY 신호 횟수
    const recentCount30d = signals.length;

    // 3. 각 스코어링 모듈 실행
    const techResult = calcTechnicalReversal(
      prices,
      cache.high_52w as number | null,
      cache.low_52w as number | null
    );

    const supplyResult = calcSupplyStrength({
      foreignStreak: cache.foreign_streak as number | null,
      institutionStreak: cache.institution_streak as number | null,
      foreignNetQty: cache.foreign_net_qty as number | null,
      institutionNetQty: cache.institution_net_qty as number | null,
      foreignNet5d: cache.foreign_net_5d as number | null,
      institutionNet5d: cache.institution_net_5d as number | null,
      shortSellRatio: cache.short_sell_ratio as number | null,
    });

    const valResult = calcValuationAttractiveness({
      currentPrice: cache.current_price as number | null,
      targetPrice: cache.target_price as number | null,
      forwardPer: cache.forward_per as number | null,
      per: cache.per as number | null,
      pbr: cache.pbr as number | null,
      roe: cache.roe as number | null,
      dividendYield: cache.dividend_yield as number | null,
      investOpinion: cache.invest_opinion as number | null,
    });

    const signalResult = calcSignalBonus({
      todaySourceCount,
      daysSinceLastSignal,
      recentCount30d,
      currentPrice: cache.current_price as number | null,
      lastSignalPrice,
    });

    // 5일 누적 등락률 계산 (RSI 75+ & 급등 과열 리스크 체크용)
    const fiveDayChangePct = prices.length >= 6
      ? ((prices[prices.length - 1].close - prices[prices.length - 6].close)
         / prices[prices.length - 6].close) * 100
      : null;

    const riskScore = calcRiskScore(
      {
        is_managed: (cache.is_managed as boolean | null) ?? undefined,
        has_recent_cbw: (dart?.has_recent_cbw as boolean | null) ?? undefined,
        audit_opinion: (dart?.audit_opinion as string | null) ?? undefined,
        major_shareholder_pct: (dart?.major_shareholder_pct as number | null) ?? undefined,
        major_shareholder_delta: (dart?.major_shareholder_delta as number | null) ?? undefined,
        has_treasury_buyback: (dart?.has_treasury_buyback as boolean | null) ?? undefined,
        market_cap: cache.market_cap as number | null,
        rsi: techResult.rsi,
        five_day_change_pct: fiveDayChangePct,
      },
      'standard'
    );

    // 4. 리스크 reasons 생성 (calcRiskScore는 reasons를 반환하지 않으므로 직접 구성)
    const riskReasons = buildRiskReasons({
      is_managed: (cache.is_managed as boolean | null) ?? undefined,
      has_recent_cbw: (dart?.has_recent_cbw as boolean | null) ?? undefined,
      audit_opinion: (dart?.audit_opinion as string | null) ?? undefined,
      major_shareholder_pct: (dart?.major_shareholder_pct as number | null) ?? undefined,
      major_shareholder_delta: (dart?.major_shareholder_delta as number | null) ?? undefined,
      has_treasury_buyback: (dart?.has_treasury_buyback as boolean | null) ?? undefined,
      market_cap: cache.market_cap as number | null,
      rsi: techResult.rsi,
      five_day_change_pct: fiveDayChangePct,
    });

    // 5. 응답 구성
    const categories: AnalysisCategory[] = [
      {
        id: 'technical',
        label: '기술',
        score: Math.round(techResult.normalizedScore),
        reasons: toChecklistReasons(techResult.reasons),
      },
      {
        id: 'supply',
        label: '수급',
        score: Math.round(supplyResult.normalizedScore),
        reasons: toChecklistReasons(supplyResult.reasons),
      },
      {
        id: 'valuation',
        label: '가치',
        score: Math.round(valResult.normalizedScore),
        reasons: toChecklistReasons(valResult.reasons),
      },
      {
        id: 'signal',
        label: '신호',
        score: Math.round(signalResult.normalizedScore),
        reasons: toChecklistReasons(signalResult.reasons),
      },
      {
        id: 'risk',
        label: '리스크',
        score: riskToDisplayScore(riskScore),
        reasons: riskReasons,
      },
    ];

    const response: StockAnalysisResponse = {
      symbol,
      scored_at: new Date().toISOString(),
      categories,
    };

    return NextResponse.json(response, {
      headers: {
        // 5분 캐시: 실시간성보다 서버 부하 감소 우선
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (e) {
    console.error('[stock-analysis] 오류:', e);
    return NextResponse.json(
      { error: '분석 데이터 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

/**
 * 리스크 요인별 체크리스트 항목을 직접 구성합니다.
 * calcRiskScore는 단일 숫자만 반환하므로 이 함수에서 reasons를 별도 생성합니다.
 */
function buildRiskReasons(input: {
  is_managed?: boolean;
  has_recent_cbw?: boolean;
  audit_opinion?: string | null;
  major_shareholder_pct?: number | null;
  major_shareholder_delta?: number | null;
  has_treasury_buyback?: boolean;
  market_cap?: number | null;
  rsi?: number | null;
  five_day_change_pct?: number | null;
}): ChecklistReason[] {
  const reasons: ChecklistReason[] = [];

  // 관리종목 여부 (통과 = 관리종목 아님)
  reasons.push({
    label: '관리종목',
    passed: !input.is_managed,
    value: input.is_managed ? '관리종목 지정' : '정상',
  });

  // 감사의견 (통과 = '적정')
  const auditOk = !input.audit_opinion || input.audit_opinion === '적정';
  reasons.push({
    label: '감사의견',
    passed: auditOk,
    value: input.audit_opinion ?? '데이터 없음',
  });

  // CB/BW 최근 발행 (통과 = 없음)
  reasons.push({
    label: 'CB/BW 발행',
    passed: !input.has_recent_cbw,
    value: input.has_recent_cbw ? '최근 발행 있음' : '없음',
  });

  // 최대주주 지분율
  if (input.major_shareholder_pct != null) {
    const cap = input.market_cap ?? 0;
    let threshold = 10;
    if (cap >= 10_000) threshold = 0;
    else if (cap >= 3_000) threshold = 5;

    const pctOk = threshold === 0 || input.major_shareholder_pct >= threshold;
    reasons.push({
      label: '대주주 지분율',
      passed: pctOk,
      value: `${input.major_shareholder_pct.toFixed(1)}%${threshold > 0 ? ` (기준 ${threshold}% 이상)` : ''}`,
    });
  }

  // 최대주주 지분율 변화 (통과 = 감소 없음)
  if (input.major_shareholder_delta != null) {
    const deltaOk = input.major_shareholder_delta >= 0;
    reasons.push({
      label: '대주주 지분 변화',
      passed: deltaOk,
      value: `${input.major_shareholder_delta >= 0 ? '+' : ''}${input.major_shareholder_delta.toFixed(1)}%p`,
    });
  }

  // 자사주 매입 여부 (긍정 신호)
  if (input.has_treasury_buyback !== undefined) {
    reasons.push({
      label: '자사주 매입',
      passed: !!input.has_treasury_buyback,
      value: input.has_treasury_buyback ? '자사주 매입 중' : '없음',
    });
  }

  // RSI 75+ & 5일 +20%+ 동시 과열 (통과 = 조건 미해당)
  if (input.rsi != null && input.five_day_change_pct != null) {
    const overheated = input.rsi >= 75 && input.five_day_change_pct >= 20;
    reasons.push({
      label: 'RSI 과열+급등',
      passed: !overheated,
      value: overheated
        ? `RSI ${input.rsi.toFixed(1)}, 5일 +${input.five_day_change_pct.toFixed(1)}% (과열)`
        : `RSI ${input.rsi.toFixed(1)}, 5일 ${input.five_day_change_pct >= 0 ? '+' : ''}${input.five_day_change_pct.toFixed(1)}%`,
    });
  }

  return reasons;
}
