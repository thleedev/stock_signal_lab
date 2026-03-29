import { SupabaseClient } from '@supabase/supabase-js';
import { fetchTodayBuySymbols, getTodayKst } from '@/lib/ai-recommendation/index';
import type { DailyPrice } from '@/lib/ai-recommendation/technical-score';
import { fetchBulkInvestorData } from '@/lib/naver-stock-api';
import { evaluateConditions } from './checklist-conditions';
import type { ChecklistItem, ChecklistGrade } from './types';

function calcGrade(ratio: number): { grade: ChecklistGrade; gradeLabel: string } {
  if (ratio >= 0.8) return { grade: 'A', gradeLabel: '적극매수' };
  if (ratio >= 0.6) return { grade: 'B', gradeLabel: '매수 고려' };
  if (ratio >= 0.4) return { grade: 'C', gradeLabel: '관망' };
  return { grade: 'D', gradeLabel: '주의' };
}

export async function generateChecklist(
  supabase: SupabaseClient,
  activeConditionIds: string[],
  limit = 30,
): Promise<{ items: ChecklistItem[]; total_candidates: number }> {
  const todayKst = getTodayKst();
  const candidates = await fetchTodayBuySymbols(supabase, todayKst);
  if (candidates.length === 0) return { items: [], total_candidates: 0 };

  const symbols = candidates.map(c => c.symbol);

  // 병렬 데이터 조회 (ai-recommendation/index.ts 패턴과 동일)
  const [{ data: cacheData }, { data: priceRows }] = await Promise.all([
    supabase
      .from('stock_cache')
      .select('symbol, per, pbr, roe, volume, current_price, high_52w, low_52w, short_sell_ratio, foreign_net_qty, institution_net_qty, investor_updated_at, foreign_net_5d, institution_net_5d, foreign_streak, institution_streak, market_cap, forward_per, target_price, invest_opinion')
      .in('symbol', symbols),
    supabase
      .from('daily_prices')
      .select('symbol, date, open, high, low, close, volume')
      .in('symbol', symbols)
      .order('date', { ascending: false })
      .limit(symbols.length * 65),
  ]);

  // Map 구성
  const cacheMap = new Map((cacheData ?? []).map(c => [c.symbol, c]));
  const priceMap = new Map<string, DailyPrice[]>();
  for (const row of priceRows ?? []) {
    const sym = row.symbol as string;
    if (!priceMap.has(sym)) priceMap.set(sym, []);
    priceMap.get(sym)!.push(row as DailyPrice);
  }
  for (const [sym, rows] of priceMap) {
    priceMap.set(sym, rows.reverse().slice(-65));
  }

  // 캐시가 오래된 종목은 실시간 수급 데이터 조회
  const todayStr = todayKst;
  const symbolsNeedingLive = symbols.filter(sym => {
    const c = cacheMap.get(sym);
    if (!c?.investor_updated_at) return true;
    return (c.investor_updated_at as string).slice(0, 10) !== todayStr;
  });
  const liveInvestorMap = symbolsNeedingLive.length > 0
    ? await fetchBulkInvestorData(symbolsNeedingLive)
    : new Map();

  // 각 종목 조건 평가
  const items: ChecklistItem[] = candidates.map(({ symbol, name }) => {
    const cache = cacheMap.get(symbol);
    const prices = priceMap.get(symbol) ?? [];
    const volumes = prices.map(p => p.volume);
    const closes = prices.map(p => p.close);

    const cachedFresh = cache?.investor_updated_at &&
      (cache.investor_updated_at as string).slice(0, 10) === todayStr;
    const liveInv = liveInvestorMap.get(symbol);

    const foreignNet: number | null = cachedFresh ? cache!.foreign_net_qty : (liveInv?.foreign_net ?? null);
    const institutionNet: number | null = cachedFresh ? cache!.institution_net_qty : (liveInv?.institution_net ?? null);
    const foreignStreak: number | null = cachedFresh ? cache!.foreign_streak : (liveInv?.foreign_streak ?? null);
    const institutionStreak: number | null = cachedFresh ? cache!.institution_streak : (liveInv?.institution_streak ?? null);

    const avgVol20 = volumes.length >= 21
      ? volumes.slice(-21, -1).reduce((a: number, b: number) => a + b, 0) / 20
      : null;

    const pct5d = closes.length >= 6
      ? ((closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6]) * 100
      : 0;

    const allConditions = evaluateConditions({
      prices,
      high52w: cache?.high_52w ?? null,
      low52w: cache?.low_52w ?? null,
      foreignNet,
      institutionNet,
      foreignStreak,
      institutionStreak,
      currentVolume: cache?.volume ?? null,
      avgVolume20d: avgVol20,
      per: cache?.per ?? null,
      forwardPer: cache?.forward_per ?? null,
      pbr: cache?.pbr ?? null,
      roe: cache?.roe ?? null,
      targetPrice: cache?.target_price ?? null,
      currentPrice: cache?.current_price ?? null,
      investOpinion: cache?.invest_opinion ?? null,
      rsi: null,
      pct5d,
      shortSellRatio: cache?.short_sell_ratio ?? null,
    });

    const activeConditions = allConditions.filter(c => activeConditionIds.includes(c.id));
    const judgeable = activeConditions.filter(c => !c.na);
    const metCount = judgeable.filter(c => c.met).length;
    const activeCount = judgeable.length;
    const metRatio = activeCount > 0 ? metCount / activeCount : 0;
    const { grade, gradeLabel } = calcGrade(metRatio);

    return {
      symbol,
      name: name ?? symbol,
      currentPrice: cache?.current_price ?? null,
      grade, gradeLabel, metCount, activeCount, metRatio,
      conditions: allConditions,
    };
  });

  items.sort((a, b) => b.metRatio - a.metRatio);
  return { items: items.slice(0, limit), total_candidates: candidates.length };
}
