import { SupabaseClient } from '@supabase/supabase-js';

export interface SignalScoreResult {
  score: number; // 0~30
  signal_count: number;
  has_today_signal: boolean;
  has_frequent_signal: boolean;
  signal_below_price: boolean;
}

// raw_data JSONB에서 신호가격 추출 (기존 extractSignalPrice 로직과 동일)
function extractSignalPriceFromRaw(rawData: Record<string, unknown> | null): number | null {
  if (!rawData) return null;
  const fields = ['signal_price', 'recommend_price', 'buy_price', 'sell_price', 'price', 'current_price'];
  for (const field of fields) {
    const val = rawData[field] as number | undefined;
    if (val && val > 0) return val;
  }
  return null;
}

export async function calcSignalScore(
  supabase: SupabaseClient,
  symbol: string,
  todayKst: string, // YYYY-MM-DD
  currentPrice: number | null
): Promise<SignalScoreResult> {
  const startOfDay = `${todayKst}T00:00:00+09:00`;
  const endOfDay = `${todayKst}T23:59:59+09:00`;

  const { data: todaySignals } = await supabase
    .from('signals')
    .select('source, raw_data')
    .eq('symbol', symbol)
    .in('signal_type', ['BUY', 'BUY_FORECAST'])
    .gte('timestamp', startOfDay)
    .lte('timestamp', endOfDay);

  // 최근 30일 신호 빈도 (KST 기준 날짜 경계 사용)
  const nowKst = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
  const thirtyDaysAgoKst = new Date(nowKst.getTime() - 30 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgoStr = thirtyDaysAgoKst.toISOString().slice(0, 10);
  const { count: recentCount } = await supabase
    .from('signals')
    .select('id', { count: 'exact', head: true })
    .eq('symbol', symbol)
    .in('signal_type', ['BUY', 'BUY_FORECAST'])
    .gte('timestamp', `${thirtyDaysAgoStr}T00:00:00+09:00`);

  const sources = new Set((todaySignals ?? []).map((s) => s.source));
  const sourceCount = sources.size;
  const hasTodaySignal = sourceCount > 0;

  let score = 0;
  if (sourceCount >= 3) score += 15;
  else if (sourceCount === 2) score += 10;
  else if (sourceCount === 1) score += 5;

  if (hasTodaySignal) score += 5;

  const hasFrequentSignal = (recentCount ?? 0) >= 3;
  if (hasFrequentSignal) score += 5;

  let signalBelowPrice = false;
  if (currentPrice && todaySignals && todaySignals.length > 0) {
    const signalPrice = extractSignalPriceFromRaw(
      todaySignals[0].raw_data as Record<string, unknown>
    );
    if (signalPrice && currentPrice <= signalPrice) {
      score += 5;
      signalBelowPrice = true;
    }
  }

  return {
    score: Math.min(score, 30),
    signal_count: sourceCount,
    has_today_signal: hasTodaySignal,
    has_frequent_signal: hasFrequentSignal,
    signal_below_price: signalBelowPrice,
  };
}
