import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';
import { calcUnifiedScore } from '../../../web/src/lib/unified-scoring/engine.js';

const CHUNK_SIZE = 200;

/**
 * Step 4: 통합 점수 계산
 * stock_cache + daily_prices + stock_dart_info + signals 를 조합하여
 * calcUnifiedScore 엔진으로 종목별 점수를 계산한 뒤 stock_scores 에 저장한다.
 */
export async function runStep4Scoring(opts: { date: string }): Promise<{ scored: number; errors: string[] }> {
  const { date } = opts;
  log('step4', `점수 계산 시작 date=${date}`);
  const errors: string[] = [];
  let scored = 0;

  try {
    // 기본 캐시 데이터 전체 조회 - Supabase max_rows(1000) 우회를 위해 페이지네이션
    const COLS = 'symbol, name, market, current_price, price_change_pct, per, pbr, roe, roe_estimated, eps, bps, forward_per, forward_eps, target_price, invest_opinion, dividend_yield, high_52w, low_52w, foreign_net_qty, institution_net_qty, foreign_net_5d, institution_net_5d, foreign_streak, institution_streak, short_sell_ratio, market_cap, is_managed, volume, float_shares, signal_count_30d, latest_signal_price, latest_signal_date';
    const cacheRows: Record<string, unknown>[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await supabase
        .from('stock_cache')
        .select(COLS)
        .not('current_price', 'is', null)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`stock_cache 조회 실패: ${error.message}`);
      if (!data || data.length === 0) break;
      cacheRows.push(...(data as Record<string, unknown>[]));
      if (data.length < PAGE) break;
      from += PAGE;
    }

    if (cacheRows.length === 0) throw new Error('stock_cache 조회 결과 없음');
    log('step4', `${cacheRows.length}종목 기본 데이터 조회 완료`);

    // DART 재무/공시 데이터 전체 조회 후 Map 으로 변환
    const { data: dartRows } = await supabase
      .from('stock_dart_info')
      .select('symbol, has_recent_cbw, major_shareholder_pct, major_shareholder_delta, audit_opinion, has_treasury_buyback, revenue_growth_yoy, operating_profit_growth_yoy');
    const dartMap = new Map((dartRows ?? []).map(r => [r.symbol as string, r]));

    // 최근 30일 매수 시그널 조회 후 종목별 source 목록으로 집계
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const { data: signalRows } = await supabase
      .from('signals')
      .select('symbol, source')
      .in('signal_type', ['BUY', 'BUY_FORECAST'])
      .gte('timestamp', `${thirtyDaysAgo}T00:00:00+09:00`);
    const signalMap = new Map<string, string[]>();
    for (const s of signalRows ?? []) {
      const arr = signalMap.get(s.symbol as string) ?? [];
      if (s.source && !arr.includes(s.source as string)) arr.push(s.source as string);
      signalMap.set(s.symbol as string, arr);
    }

    const symbols = cacheRows.map(r => r.symbol as string);

    // 200종목 단위 청크로 처리 (daily_prices IN 쿼리 부하 분산)
    for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
      const chunk = symbols.slice(i, i + CHUNK_SIZE);

      // 최근 65거래일 일봉 조회 (기술적 지표 계산 여유분 포함)
      const { data: priceRows } = await supabase
        .from('daily_prices')
        .select('symbol, date, open, high, low, close, volume')
        .in('symbol', chunk)
        .gte('date', new Date(Date.now() - 65 * 86400000).toISOString().slice(0, 10))
        .order('date', { ascending: false });

      // 종목별 일봉 배열 Map 구성 (내림차순 정렬 유지)
      const priceMap = new Map<string, { date: string; open: number; high: number; low: number; close: number; volume: number }[]>();
      for (const p of priceRows ?? []) {
        const arr = priceMap.get(p.symbol as string) ?? [];
        arr.push({
          date: p.date as string,
          open: p.open as number,
          high: p.high as number,
          low: p.low as number,
          close: p.close as number,
          volume: p.volume as number,
        });
        priceMap.set(p.symbol as string, arr);
      }

      const scoreRows: Record<string, unknown>[] = [];

      for (const symbol of chunk) {
        const cache = cacheRows.find(r => r.symbol === symbol);
        if (!cache) continue;

        const prices = priceMap.get(symbol) ?? [];
        const dart = dartMap.get(symbol) ?? {};
        const signalSources = signalMap.get(symbol) ?? [];

        // 일봉에서 파생 지표 계산
        const today = prices[0];
        const yesterday = prices[1];
        const vol20Avg = prices.length >= 20
          ? prices.slice(0, 20).reduce((s, p) => s + p.volume, 0) / 20
          : null;
        const volumeRatio = today && vol20Avg && vol20Avg > 0
          ? today.volume / vol20Avg
          : null;
        const closePosition = today && (today.high - today.low) > 0
          ? (today.close - today.low) / (today.high - today.low)
          : null;
        const gapPct = today && yesterday && yesterday.close > 0
          ? (today.open - yesterday.close) / yesterday.close * 100
          : null;
        const close3dAgo = prices[3];
        const cumReturn3d = today && close3dAgo && close3dAgo.close > 0
          ? (today.close - close3dAgo.close) / close3dAgo.close * 100
          : null;
        const tradingValue = today ? today.close * today.volume : null;

        // latestSignalDaysAgo 계산
        const latestSignalDateStr = (cache.latest_signal_date as string) ?? null;
        const latestSignalDaysAgo = latestSignalDateStr
          ? Math.floor((Date.now() - new Date(latestSignalDateStr).getTime()) / 86400000)
          : null;

        // 통합 점수 엔진 입력 객체 구성
        const input = {
          symbol,
          name: (cache.name as string) ?? '',
          market: (cache.market as string) ?? '',
          currentPrice: (cache.current_price as number) ?? null,
          priceChangePct: (cache.price_change_pct as number) ?? null,
          marketCap: (cache.market_cap as number) ?? null,
          per: (cache.per as number) ?? null,
          pbr: (cache.pbr as number) ?? null,
          roe: (cache.roe as number) ?? null,
          roeEstimated: (cache.roe_estimated as number) ?? null,
          eps: (cache.eps as number) ?? null,
          bps: (cache.bps as number) ?? null,
          forwardPer: (cache.forward_per as number) ?? null,
          forwardEps: (cache.forward_eps as number) ?? null,
          targetPrice: (cache.target_price as number) ?? null,
          investOpinion: (cache.invest_opinion as number) ?? null,
          dividendYield: (cache.dividend_yield as number) ?? null,
          high52w: (cache.high_52w as number) ?? null,
          low52w: (cache.low_52w as number) ?? null,
          foreignNetQty: (cache.foreign_net_qty as number) ?? null,
          institutionNetQty: (cache.institution_net_qty as number) ?? null,
          foreignNet5d: (cache.foreign_net_5d as number) ?? null,
          institutionNet5d: (cache.institution_net_5d as number) ?? null,
          foreignStreak: (cache.foreign_streak as number) ?? null,
          institutionStreak: (cache.institution_streak as number) ?? null,
          shortSellRatio: (cache.short_sell_ratio as number) ?? null,
          volume: (cache.volume as number) ?? null,
          floatShares: (cache.float_shares as number) ?? null,
          signalCount30d: (cache.signal_count_30d as number) ?? null,
          latestSignalPrice: (cache.latest_signal_price as number) ?? null,
          latestSignalDate: latestSignalDateStr,
          latestSignalDaysAgo,
          isManaged: (cache.is_managed as boolean) ?? false,
          hasRecentCbw: (dart.has_recent_cbw as boolean) ?? false,
          majorShareholderPct: (dart.major_shareholder_pct as number) ?? null,
          majorShareholderDelta: (dart.major_shareholder_delta as number) ?? null,
          auditOpinion: (dart.audit_opinion as string) ?? null,
          hasTreasuryBuyback: (dart.has_treasury_buyback as boolean) ?? false,
          revenueGrowthYoy: (dart.revenue_growth_yoy as number) ?? null,
          operatingProfitGrowthYoy: (dart.operating_profit_growth_yoy as number) ?? null,
          signalSources,
          dailyPrices: prices,
          volumeRatio,
          closePosition,
          gapPct,
          cumReturn3d,
          tradingValue,
          sectorAvgChangePct: null,
          sectorRank: null,
          sectorTotal: null,
        };

        // 통합 점수 엔진 실행
        const result = calcUnifiedScore(input, 'balanced');

        const sv = Math.round(result.categories.valueGrowth?.normalized ?? 0);
        const sg = Math.round(result.categories.valueGrowth?.normalized ?? 0);
        const ss = Math.round(result.categories.supply?.normalized ?? 0);
        const sm = Math.round(result.categories.momentum?.normalized ?? 0);
        const sr = Math.round(result.categories.risk?.normalized ?? 0);
        const ssig = Math.round(result.categories.signalTech?.normalized ?? 0);

        // balanced 기준 종합 점수 (DB 레벨 정렬용)
        // weights: value=20, growth=15, supply=20, momentum=20, signal=10, risk=15
        const wTotal = 20 + 15 + 20 + 20 + 10;
        const scoreTotal = Math.max(0, Math.min(100,
          Math.round((sv * 20 + sg * 15 + ss * 20 + sm * 20 + ssig * 10) / wTotal - sr * 0.15)
        ));

        // 전일 종가: 일봉 배열 2번째 항목(내림차순), 없으면 current_price 사용
        const prevClose = prices.length >= 2 ? prices[1].close : ((cache.current_price as number) ?? 0);

        scoreRows.push({
          symbol,
          scored_at: date,
          prev_close: prevClose,
          score_value: sv,
          score_growth: sg,
          score_supply: ss,
          score_momentum: sm,
          score_risk: sr,
          score_signal: ssig,
          score_total: scoreTotal,
          updated_at: new Date().toISOString(),
        });
      }

      if (scoreRows.length > 0) {
        const { error } = await supabase
          .from('stock_scores')
          .upsert(scoreRows, { onConflict: 'symbol' });
        if (error) errors.push(`step4 upsert chunk ${i}: ${error.message}`);
        else scored += scoreRows.length;
      }

      // 5청크(1,000종목)마다 진행 상황 로그
      if ((i / CHUNK_SIZE) % 5 === 0) {
        log('step4', `진행 ${Math.min(i + CHUNK_SIZE, symbols.length)}/${symbols.length} scored=${scored}`);
      }
    }

    log('step4', `완료: ${scored}종목 점수 저장`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`step4 오류: ${msg}`);
    log('step4', `실패: ${msg}`);
  }

  return { scored, errors };
}
