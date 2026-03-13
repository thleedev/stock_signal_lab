import { extractSignalPrice } from '@/lib/signal-constants';

export interface SignalScoreResult {
  score: number; // 0~30
  signal_count: number;
  has_today_signal: boolean;
  has_frequent_signal: boolean;
  signal_below_price: boolean;
}

export function calcSignalScore(
  todaySignals: Array<{ source: string; raw_data: unknown }>,
  recentCount: number,
  currentPrice: number | null
): SignalScoreResult {
  const sources = new Set(todaySignals.map((s) => s.source));
  const sourceCount = sources.size;
  const hasTodaySignal = sourceCount > 0;

  let score = 0;
  if (sourceCount >= 3) score += 15;
  else if (sourceCount === 2) score += 10;
  else if (sourceCount === 1) score += 5;

  if (hasTodaySignal) score += 5;

  const hasFrequentSignal = recentCount >= 3;
  if (hasFrequentSignal) score += 5;

  let signalBelowPrice = false;
  if (currentPrice && todaySignals.length > 0) {
    const signalPrice = extractSignalPrice(
      todaySignals[0].raw_data as Record<string, unknown> | null
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
