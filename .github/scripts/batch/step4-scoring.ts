import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';
import { calcCompositeScore } from '../../../web/src/lib/scoring/composite-score.js';

const CHUNK_SIZE = 200;

/**
 * Step 4: 통합 점수 계산
 * stock_cache + daily_prices + stock_dart_info + signals 를 조합하여
 * calcCompositeScore 엔진으로 종목별 점수를 계산한 뒤 stock_scores 에 저장한다.
 */
export async function runStep4Scoring(opts: { date: string }): Promise<{ scored: number; errors: string[] }> {
  const { date } = opts;
  log('step4', `점수 계산 시작 date=${date}`);
  const errors: string[] = [];
  let scored = 0;

  try {
    // 기본 캐시 데이터 전체 조회 - Supabase max_rows(1000) 우회를 위해 페이지네이션
    const COLS = 'symbol, name, market, current_price, price_change_pct, per, pbr, roe, forward_per, target_price, invest_opinion, dividend_yield, high_52w, low_52w, foreign_net_qty, institution_net_qty, foreign_net_5d, institution_net_5d, foreign_streak, institution_streak, short_sell_ratio, market_cap, is_managed, volume, float_shares, signal_count_30d, latest_signal_price, latest_signal_date';
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
      .select('symbol, has_recent_cbw, major_shareholder_pct, major_shareholder_delta, audit_opinion, has_treasury_buyback');
    const dartMap = new Map((dartRows ?? []).map(r => [r.symbol as string, r]));

    // 최근 30일 매수 시그널 조회 후 종목별 source 목록으로 집계
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const { data: signalRows } = await supabase
      .from('signals')
      .select('symbol, source, timestamp')
      .in('signal_type', ['BUY', 'BUY_FORECAST'])
      .gte('timestamp', `${thirtyDaysAgo}T00:00:00+09:00`);

    // 종목별 30일 신호 소스 목록
    const signalSourceMap = new Map<string, string[]>();
    // 종목별 오늘(batch date) 신호 소스 수
    const todaySignalCountMap = new Map<string, Set<string>>();

    for (const s of signalRows ?? []) {
      const sym = s.symbol as string;
      // 30일 소스 목록
      const arr = signalSourceMap.get(sym) ?? [];
      if (s.source && !arr.includes(s.source as string)) arr.push(s.source as string);
      signalSourceMap.set(sym, arr);
      // 오늘 신호인지 확인 (timestamp 앞 10자리 = YYYY-MM-DD)
      const sigDate = String(s.timestamp ?? '').slice(0, 10);
      if (sigDate === date && s.source) {
        const set = todaySignalCountMap.get(sym) ?? new Set<string>();
        set.add(s.source as string);
        todaySignalCountMap.set(sym, set);
      }
    }

    const symbols = cacheRows.map(r => r.symbol as string);

    // 200종목 단위 청크로 처리 (daily_prices IN 쿼리 부하 분산)
    for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
      const chunk = symbols.slice(i, i + CHUNK_SIZE);

      // 최근 90 캘린더일 일봉 조회 (SMA60 계산에 충분한 거래일 확보)
      const { data: priceRows } = await supabase
        .from('daily_prices')
        .select('symbol, date, open, high, low, close, volume')
        .in('symbol', chunk)
        .gte('date', new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10))
        .order('date', { ascending: true }); // oldest-first (calcCompositeScore 요구사항)

      // 종목별 일봉 배열 Map 구성 (오름차순 = 오래된 것부터)
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

        const prices = priceMap.get(symbol) ?? []; // oldest-first
        const dart = dartMap.get(symbol) ?? {};
        const signalSources = signalSourceMap.get(symbol) ?? [];
        const todaySourceCount = todaySignalCountMap.get(symbol)?.size ?? 0;

        // latestSignalDaysAgo 계산
        const latestSignalDateStr = (cache.latest_signal_date as string) ?? null;
        const latestSignalDaysAgo = latestSignalDateStr
          ? Math.floor((Date.now() - new Date(latestSignalDateStr).getTime()) / 86400000)
          : null;

        // 당일/20일평균 거래대금 계산 (최신일 = prices 배열 마지막 항목)
        const todayPrice = prices[prices.length - 1];
        const dailyTradingValue = todayPrice ? todayPrice.close * todayPrice.volume : null;
        const avgTradingValue20d = prices.length >= 20
          ? prices.slice(-20).reduce((s, p) => s + p.close * p.volume, 0) / 20
          : null;

        // 회전율 계산
        const floatShares = (cache.float_shares as number) ?? null;
        const turnoverRate = todayPrice && floatShares && floatShares > 0
          ? (todayPrice.volume / floatShares) * 100
          : null;

        // 통합 점수 엔진 실행 (balanced 스타일)
        const result = calcCompositeScore({
          prices,
          high52w: (cache.high_52w as number) ?? null,
          low52w: (cache.low_52w as number) ?? null,
          foreignStreak: (cache.foreign_streak as number) ?? null,
          institutionStreak: (cache.institution_streak as number) ?? null,
          foreignNetQty: (cache.foreign_net_qty as number) ?? null,
          institutionNetQty: (cache.institution_net_qty as number) ?? null,
          foreignNet5d: (cache.foreign_net_5d as number) ?? null,
          institutionNet5d: (cache.institution_net_5d as number) ?? null,
          shortSellRatio: (cache.short_sell_ratio as number) ?? null,
          currentPrice: (cache.current_price as number) ?? null,
          targetPrice: (cache.target_price as number) ?? null,
          forwardPer: (cache.forward_per as number) ?? null,
          per: (cache.per as number) ?? null,
          pbr: (cache.pbr as number) ?? null,
          roe: (cache.roe as number) ?? null,
          dividendYield: (cache.dividend_yield as number) ?? null,
          investOpinion: (cache.invest_opinion as number) ?? null,
          todaySourceCount,
          daysSinceLastSignal: latestSignalDaysAgo,
          recentCount30d: (cache.signal_count_30d as number) ?? 0,
          lastSignalPrice: (cache.latest_signal_price as number) ?? null,
          marketCap: (cache.market_cap as number) ?? null,
          isManaged: (cache.is_managed as boolean) ?? false,
          hasRecentCbw: (dart.has_recent_cbw as boolean) ?? false,
          auditOpinion: (dart.audit_opinion as string) ?? null,
          majorShareholderPct: (dart.major_shareholder_pct as number) ?? null,
          majorShareholderDelta: (dart.major_shareholder_delta as number) ?? null,
          hasTreasuryBuyback: (dart.has_treasury_buyback as boolean) ?? false,
          dailyTradingValue,
          avgTradingValue20d,
          turnoverRate,
        }, 'balanced');

        // score_risk: calcRiskScore는 음수 반환 → 0~100 양수 스케일로 변환
        const scoreRisk = Math.min(100, Math.abs(result.score_risk));

        // 전일 종가: 오름차순 배열에서 끝에서 두 번째 항목
        const prevClose = prices.length >= 2
          ? prices[prices.length - 2].close
          : (cache.current_price as number) ?? 0;

        scoreRows.push({
          symbol,
          scored_at: date,
          prev_close: prevClose,
          score_value: result.score_valuation,
          score_growth: result.score_valuation,
          score_supply: result.score_supply,
          score_momentum: result.score_technical,
          score_risk: scoreRisk,
          score_signal: result.score_signal,
          score_total: result.score_total,
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
