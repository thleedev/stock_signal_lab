import { SupabaseClient } from '@supabase/supabase-js';
import { getTodayKst } from '@/lib/ai-recommendation/index';
import { getLastNWeekdays } from '@/lib/date-utils';
import type { DailyPrice } from '@/lib/ai-recommendation/technical-score';
import { fetchBulkInvestorData } from '@/lib/naver-stock-api';
import { fetchBulkIndicators } from '@/lib/krx-api';
import { evaluateConditions } from './checklist-conditions';
import type { ChecklistItem, ChecklistGrade } from './types';

function calcGrade(ratio: number): { grade: ChecklistGrade; gradeLabel: string } {
  if (ratio >= 0.8) return { grade: 'A', gradeLabel: '적극매수' };
  if (ratio >= 0.6) return { grade: 'B', gradeLabel: '매수 고려' };
  if (ratio >= 0.4) return { grade: 'C', gradeLabel: '관망' };
  return { grade: 'D', gradeLabel: '주의' };
}

const CACHE_FIELDS = 'symbol, name, market, per, pbr, roe, volume, current_price, high_52w, low_52w, short_sell_ratio, foreign_net_qty, institution_net_qty, foreign_net_5d, institution_net_5d, foreign_streak, institution_streak, market_cap, forward_per, target_price, invest_opinion';

export async function generateChecklist(
  supabase: SupabaseClient,
  activeConditionIds: string[],
  dateMode: 'today' | 'signal_all' | 'all' = 'today',
  market = 'all',
): Promise<{ items: ChecklistItem[]; total_candidates: number }> {
  const todayKst = getTodayKst();

  // ── Step 1: 후보 종목 + stock_cache 데이터 한번에 조회 ──
  const cacheMap = new Map<string, Record<string, unknown>>();
  let candidateSymbols: { symbol: string; name: string }[] = [];

  if (dateMode === 'all') {
    // 종목전체: stock_cache 전체를 페이지네이션으로 조회 (필요 필드 포함)
    let from = 0;
    while (true) {
      let query = supabase
        .from('stock_cache')
        .select(CACHE_FIELDS)
        .not('current_price', 'is', null)
        .range(from, from + 999);
      if (market !== 'all') query = query.eq('market', market);
      const { data } = await query;
      if (!data || data.length === 0) break;
      for (const r of data) {
        cacheMap.set(r.symbol, r);
        candidateSymbols.push({ symbol: r.symbol, name: r.name });
      }
      if (data.length < 1000) break;
      from += 1000;
    }
  } else {
    // today / signal_all: 신호 기반 후보
    let startDate: string;
    let endDate: string;
    if (dateMode === 'signal_all') {
      const last7 = getLastNWeekdays(7);
      startDate = `${last7[last7.length - 1]}T00:00:00+09:00`;
      endDate = `${last7[0]}T23:59:59+09:00`;
    } else {
      startDate = `${todayKst}T00:00:00+09:00`;
      endDate = `${todayKst}T23:59:59+09:00`;
    }

    const { data: sigData } = await supabase
      .from('signals')
      .select('symbol, name')
      .in('signal_type', ['BUY', 'BUY_FORECAST'])
      .gte('timestamp', startDate)
      .lte('timestamp', endDate)
      .limit(5000);

    // 중복 제거
    const seen = new Set<string>();
    candidateSymbols = (sigData ?? []).filter(s => {
      if (seen.has(s.symbol)) return false;
      seen.add(s.symbol);
      return true;
    });

    // stock_cache 조회 (80개씩 청크)
    const symbols = candidateSymbols.map(s => s.symbol);
    for (let i = 0; i < symbols.length; i += 80) {
      const chunk = symbols.slice(i, i + 80);
      const { data } = await supabase
        .from('stock_cache')
        .select(CACHE_FIELDS)
        .in('symbol', chunk);
      for (const c of data ?? []) cacheMap.set(c.symbol, c);
    }

    // name/market 보강 + 시장 필터
    candidateSymbols = candidateSymbols.map(s => ({
      symbol: s.symbol,
      name: (cacheMap.get(s.symbol)?.name as string) ?? s.name ?? s.symbol,
    }));
    if (market !== 'all') {
      candidateSymbols = candidateSymbols.filter(s =>
        (cacheMap.get(s.symbol)?.market as string) === market
      );
    }
  }

  if (candidateSymbols.length === 0) return { items: [], total_candidates: 0 };

  const symbols = candidateSymbols.map(c => c.symbol);

  // ── Step 2: daily_prices 조회 (추세 데이터) — 15개씩 병렬 ──
  const priceMap = new Map<string, DailyPrice[]>();
  const PRICE_CHUNK = 15;
  const priceChunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += PRICE_CHUNK) {
    priceChunks.push(symbols.slice(i, i + PRICE_CHUNK));
  }
  const priceResults = await Promise.all(
    priceChunks.map(chunk =>
      supabase
        .from('daily_prices')
        .select('symbol, date, open, high, low, close, volume')
        .in('symbol', chunk)
        .order('date', { ascending: false })
        .limit(chunk.length * 65)
    )
  );
  for (const { data: priceRows } of priceResults) {
    for (const row of priceRows ?? []) {
      const sym = row.symbol as string;
      if (!priceMap.has(sym)) priceMap.set(sym, []);
      priceMap.get(sym)!.push(row as DailyPrice);
    }
  }
  for (const [sym, rows] of priceMap) {
    priceMap.set(sym, rows.reverse().slice(-65));
  }

  // ── Step 2.5: stock_cache에 데이터 없는 종목은 실시간 보강 (종목전체 제외) ──
  if (dateMode !== 'all') {
    const needIndicator = symbols.filter(s => {
      const c = cacheMap.get(s);
      return !c || (c.per == null && c.forward_per == null);
    });
    const needInvestor = symbols.filter(s => {
      const c = cacheMap.get(s);
      return !c || c.foreign_net_qty == null;
    });

    if (needIndicator.length > 0 || needInvestor.length > 0) {
      const [indMap, invMap] = await Promise.all([
        needIndicator.length > 0 ? fetchBulkIndicators(needIndicator, 30) : Promise.resolve(new Map()),
        needInvestor.length > 0 ? fetchBulkInvestorData(needInvestor, 30) : Promise.resolve(new Map()),
      ]);

      for (const [sym, ind] of indMap) {
        const c = cacheMap.get(sym) ?? {};
        if (ind.per != null) c.per = ind.per;
        if (ind.pbr != null) c.pbr = ind.pbr;
        if (ind.roe != null) c.roe = ind.roe;
        if (ind.high_52w != null) c.high_52w = ind.high_52w;
        if (ind.low_52w != null) c.low_52w = ind.low_52w;
        if (ind.forward_per != null) c.forward_per = ind.forward_per;
        if (ind.target_price != null) c.target_price = ind.target_price;
        if (ind.invest_opinion != null) c.invest_opinion = ind.invest_opinion;
        cacheMap.set(sym, c);
      }
      for (const [sym, inv] of invMap) {
        const c = cacheMap.get(sym) ?? {};
        c.foreign_net_qty = inv.foreign_net;
        c.institution_net_qty = inv.institution_net;
        c.foreign_net_5d = inv.foreign_net_5d;
        c.institution_net_5d = inv.institution_net_5d;
        c.foreign_streak = inv.foreign_streak;
        c.institution_streak = inv.institution_streak;
        cacheMap.set(sym, c);
      }
    }
  }

  // ── Step 3: 각 종목 조건 평가 ──
  const n = (v: unknown): number | null => (typeof v === 'number' ? v : null);

  const items: ChecklistItem[] = candidateSymbols.map(({ symbol, name }) => {
    const cache = cacheMap.get(symbol);
    const prices = priceMap.get(symbol) ?? [];
    const volumes = prices.map(p => p.volume);
    const closes = prices.map(p => p.close);

    const avgVol20 = volumes.length >= 21
      ? volumes.slice(-21, -1).reduce((a: number, b: number) => a + b, 0) / 20
      : null;

    const pct5d = closes.length >= 6
      ? ((closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6]) * 100
      : 0;

    const allConditions = evaluateConditions({
      prices,
      high52w: n(cache?.high_52w),
      low52w: n(cache?.low_52w),
      foreignNet: n(cache?.foreign_net_qty),
      institutionNet: n(cache?.institution_net_qty),
      foreignStreak: n(cache?.foreign_streak),
      institutionStreak: n(cache?.institution_streak),
      currentVolume: n(cache?.volume),
      avgVolume20d: avgVol20,
      per: n(cache?.per),
      forwardPer: n(cache?.forward_per),
      pbr: n(cache?.pbr),
      roe: n(cache?.roe),
      targetPrice: n(cache?.target_price),
      currentPrice: n(cache?.current_price),
      investOpinion: n(cache?.invest_opinion),
      rsi: null,
      pct5d,
      shortSellRatio: n(cache?.short_sell_ratio),
    });

    const activeConditions = allConditions.filter(c => activeConditionIds.includes(c.id));
    const naCount = activeConditions.filter(c => c.na).length;
    const judgeable = activeConditions.filter(c => !c.na);
    const metCount = judgeable.filter(c => c.met).length;
    const activeCount = judgeable.length;
    const dataInsufficient = activeConditions.length > 0 && activeCount < activeConditions.length / 2;
    const metRatio = dataInsufficient ? 0 : (activeCount > 0 ? metCount / activeCount : 0);
    const { grade, gradeLabel } = dataInsufficient
      ? { grade: 'D' as const, gradeLabel: '데이터 부족' }
      : calcGrade(metRatio);

    return {
      symbol,
      name: name ?? symbol,
      currentPrice: n(cache?.current_price),
      grade, gradeLabel, metCount, activeCount, metRatio,
      conditions: allConditions,
    };
  });

  items.sort((a, b) => b.metRatio - a.metRatio);
  return { items, total_candidates: candidateSymbols.length };
}
