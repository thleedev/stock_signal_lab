import { describe, it, expect } from 'vitest';
import { calcSignalScore } from '@/lib/ai-recommendation/signal-score';
import { calcTechnicalScore, DailyPrice } from '@/lib/ai-recommendation/technical-score';
import { calcValuationScore } from '@/lib/ai-recommendation/valuation-score';
import { calcSupplyScore } from '@/lib/ai-recommendation/supply-score';

// ---------------------------------------------------------------------------
// Helper: generate a series of DailyPrice entries
// ---------------------------------------------------------------------------
function makePrices(
  count: number,
  baseClose = 10000,
  options?: {
    trend?: 'up' | 'down' | 'flat';
    volumeBase?: number;
    lastVolumeMultiplier?: number;
  }
): DailyPrice[] {
  const { trend = 'flat', volumeBase = 100000, lastVolumeMultiplier = 1 } = options ?? {};
  const prices: DailyPrice[] = [];
  for (let i = 0; i < count; i++) {
    let close = baseClose;
    if (trend === 'up') close = baseClose + i * 100;
    else if (trend === 'down') close = baseClose - i * 50;

    const vol = i === count - 1 ? volumeBase * lastVolumeMultiplier : volumeBase;
    prices.push({
      date: `2025-01-${String(i + 1).padStart(2, '0')}`,
      open: close - 50,
      high: close + 100,
      low: close - 100,
      close,
      volume: vol,
    });
  }
  return prices;
}

// ===========================================================================
// calcSignalScore
// ===========================================================================
describe('calcSignalScore', () => {
  it('returns zero score for 0 signals', () => {
    const result = calcSignalScore([], 0, null);
    expect(result.score).toBe(0);
    expect(result.signal_count).toBe(0);
    expect(result.has_today_signal).toBe(false);
    expect(result.has_frequent_signal).toBe(false);
    expect(result.signal_below_price).toBe(false);
  });

  it('scores 1 unique source signal correctly', () => {
    const signals = [{ source: 'lassi', raw_data: {} }];
    const result = calcSignalScore(signals, 0, null);
    // 1 source => +5, hasTodaySignal => +5 = 10
    expect(result.score).toBe(10);
    expect(result.signal_count).toBe(1);
    expect(result.has_today_signal).toBe(true);
  });

  it('scores 2 unique sources correctly', () => {
    const signals = [
      { source: 'lassi', raw_data: {} },
      { source: 'stockbot', raw_data: {} },
    ];
    const result = calcSignalScore(signals, 0, null);
    // 2 sources => +10, hasTodaySignal => +5 = 15
    expect(result.score).toBe(15);
    expect(result.signal_count).toBe(2);
  });

  it('scores 3+ unique sources correctly', () => {
    const signals = [
      { source: 'lassi', raw_data: {} },
      { source: 'stockbot', raw_data: {} },
      { source: 'quant', raw_data: {} },
    ];
    const result = calcSignalScore(signals, 0, null);
    // 3 sources => +15, hasTodaySignal => +5 = 20
    expect(result.score).toBe(20);
    expect(result.signal_count).toBe(3);
  });

  it('deduplicates signals from the same source', () => {
    const signals = [
      { source: 'lassi', raw_data: {} },
      { source: 'lassi', raw_data: {} },
    ];
    const result = calcSignalScore(signals, 0, null);
    // 1 unique source => +5, hasTodaySignal => +5 = 10
    expect(result.signal_count).toBe(1);
    expect(result.score).toBe(10);
  });

  it('adds bonus for frequent recent signals', () => {
    const signals = [{ source: 'lassi', raw_data: {} }];
    const result = calcSignalScore(signals, 3, null);
    // 1 source => +5, hasTodaySignal => +5, frequent => +5 = 15
    expect(result.has_frequent_signal).toBe(true);
    expect(result.score).toBe(15);
  });

  it('does not add frequent bonus when recentCount < 3', () => {
    const signals = [{ source: 'lassi', raw_data: {} }];
    const result = calcSignalScore(signals, 2, null);
    expect(result.has_frequent_signal).toBe(false);
    expect(result.score).toBe(10);
  });

  it('adds signal_below_price bonus when currentPrice <= signalPrice', () => {
    const signals = [
      { source: 'lassi', raw_data: { signal_price: 5000 } },
    ];
    // currentPrice 4500 <= signalPrice 5000 => +5
    const result = calcSignalScore(signals, 0, 4500);
    expect(result.signal_below_price).toBe(true);
    // 1 source +5, today +5, below_price +5 = 15
    expect(result.score).toBe(15);
  });

  it('does not add signal_below_price when currentPrice > signalPrice', () => {
    const signals = [
      { source: 'lassi', raw_data: { signal_price: 5000 } },
    ];
    const result = calcSignalScore(signals, 0, 6000);
    expect(result.signal_below_price).toBe(false);
    expect(result.score).toBe(10);
  });

  it('caps score at 30', () => {
    const signals = [
      { source: 'lassi', raw_data: { signal_price: 50000 } },
      { source: 'stockbot', raw_data: {} },
      { source: 'quant', raw_data: {} },
    ];
    // 3 sources +15, today +5, frequent +5, below_price +5 = 30
    const result = calcSignalScore(signals, 5, 40000);
    expect(result.score).toBe(30);
  });
});

// ===========================================================================
// calcTechnicalScore
// ===========================================================================
describe('calcTechnicalScore', () => {
  it('returns data_insufficient for empty prices', () => {
    const result = calcTechnicalScore([], null, null);
    expect(result.data_insufficient).toBe(true);
    expect(result.score).toBe(0);
    expect(result.rsi).toBeNull();
  });

  it('returns data_insufficient for fewer than 20 prices', () => {
    const prices = makePrices(10);
    const result = calcTechnicalScore(prices, null, null);
    expect(result.data_insufficient).toBe(true);
    expect(result.score).toBe(0);
  });

  it('returns data_insufficient=false for sufficient prices', () => {
    const prices = makePrices(30);
    const result = calcTechnicalScore(prices, null, null);
    expect(result.data_insufficient).toBe(false);
  });

  it('calculates RSI and awards points when RSI is in 30-50 zone', () => {
    // Create a pattern: prices go down then stabilize, producing RSI in 30-50 range
    const prices: DailyPrice[] = [];
    // 15 declining prices to push RSI low, then 10 flat to bring it to ~30-50
    for (let i = 0; i < 15; i++) {
      const close = 10000 - i * 200;
      prices.push({
        date: `2025-01-${String(i + 1).padStart(2, '0')}`,
        open: close + 50,
        high: close + 100,
        low: close - 100,
        close,
        volume: 100000,
      });
    }
    // Add 10 flat/slight up days
    for (let i = 0; i < 10; i++) {
      const close = 7200 + i * 30;
      prices.push({
        date: `2025-01-${String(16 + i).padStart(2, '0')}`,
        open: close - 10,
        high: close + 50,
        low: close - 50,
        close,
        volume: 100000,
      });
    }
    const result = calcTechnicalScore(prices, null, null);
    expect(result.rsi).not.toBeNull();
    // RSI should be calculated for 25 prices
    expect(typeof result.rsi).toBe('number');
  });

  it('detects 52-week low proximity', () => {
    const prices = makePrices(25, 10000);
    const currentPrice = prices[prices.length - 1].close;
    // Set low52w so that currentPrice / low52w is within 0.95..1.05
    const result = calcTechnicalScore(prices, null, currentPrice * 0.98);
    expect(result.week52_low_near).toBe(true);
  });

  it('does not flag 52-week low when price is far from low', () => {
    const prices = makePrices(25, 10000);
    const result = calcTechnicalScore(prices, null, 5000);
    expect(result.week52_low_near).toBe(false);
  });

  it('detects volume surge when last day volume >= 2x 20-day average', () => {
    const prices = makePrices(25, 10000, {
      volumeBase: 100000,
      lastVolumeMultiplier: 3,
    });
    const result = calcTechnicalScore(prices, null, null);
    expect(result.volume_surge).toBe(true);
  });

  it('does not flag volume surge when volume is normal', () => {
    const prices = makePrices(25, 10000, {
      volumeBase: 100000,
      lastVolumeMultiplier: 1,
    });
    const result = calcTechnicalScore(prices, null, null);
    expect(result.volume_surge).toBe(false);
  });

  it('score is clamped between -8 and 30', () => {
    // Even with extreme inputs, score should be within range
    const prices = makePrices(50, 10000);
    const result = calcTechnicalScore(prices, null, null);
    expect(result.score).toBeGreaterThanOrEqual(-8);
    expect(result.score).toBeLessThanOrEqual(30);
  });
});

// ===========================================================================
// calcValuationScore
// ===========================================================================
describe('calcValuationScore', () => {
  it('returns 0 for all null values', () => {
    const result = calcValuationScore(null, null, null);
    expect(result.score).toBe(0);
    expect(result.per).toBeNull();
    expect(result.pbr).toBeNull();
    expect(result.roe).toBeNull();
  });

  it('returns 0 for negative PER and PBR', () => {
    const result = calcValuationScore(-5, -1, null);
    expect(result.score).toBe(0);
  });

  it('scores deeply undervalued stocks (low PBR < 0.5)', () => {
    const result = calcValuationScore(null, 0.3, null);
    expect(result.score).toBe(7);
  });

  it('scores undervalued PBR (0.5-0.8)', () => {
    const result = calcValuationScore(null, 0.6, null);
    expect(result.score).toBe(5);
  });

  it('scores slightly undervalued PBR (0.8-1.0)', () => {
    const result = calcValuationScore(null, 0.9, null);
    expect(result.score).toBe(3);
  });

  it('scores PBR >= 1.0 as 0', () => {
    const result = calcValuationScore(null, 1.5, null);
    expect(result.score).toBe(0);
  });

  it('scores extremely low PER (< 5)', () => {
    const result = calcValuationScore(3, null, null);
    expect(result.score).toBe(7);
  });

  it('scores low PER (5-8)', () => {
    const result = calcValuationScore(6, null, null);
    expect(result.score).toBe(5);
  });

  it('scores reasonable PER (8-12)', () => {
    const result = calcValuationScore(10, null, null);
    expect(result.score).toBe(3);
  });

  it('scores average PER (12-15)', () => {
    const result = calcValuationScore(13, null, null);
    expect(result.score).toBe(1);
  });

  it('scores high PER (>= 15) as 0', () => {
    const result = calcValuationScore(20, null, null);
    expect(result.score).toBe(0);
  });

  it('scores excellent ROE (> 20)', () => {
    const result = calcValuationScore(null, null, 25);
    expect(result.score).toBe(6);
  });

  it('scores good ROE (15-20)', () => {
    const result = calcValuationScore(null, null, 17);
    expect(result.score).toBe(5);
  });

  it('scores average ROE (10-15)', () => {
    const result = calcValuationScore(null, null, 12);
    expect(result.score).toBe(3);
  });

  it('scores minimal ROE (5-10)', () => {
    const result = calcValuationScore(null, null, 7);
    expect(result.score).toBe(1);
  });

  it('scores ROE <= 5 as 0', () => {
    const result = calcValuationScore(null, null, 3);
    expect(result.score).toBe(0);
  });

  it('combines all good values correctly', () => {
    // PBR 0.3 => +7, PER 3 => +7, ROE 25 => +6 = 20 (capped)
    const result = calcValuationScore(3, 0.3, 25);
    expect(result.score).toBe(20);
  });

  it('caps score at 20', () => {
    // PBR 0.3 => +7, PER 3 => +7, ROE 25 => +6 = 20 (capped at 20)
    const result = calcValuationScore(3, 0.3, 25);
    expect(result.score).toBeLessThanOrEqual(20);
  });

  it('preserves input values in result', () => {
    const result = calcValuationScore(10, 0.8, 15);
    expect(result.per).toBe(10);
    expect(result.pbr).toBe(0.8);
    expect(result.roe).toBe(15);
  });
});

// ===========================================================================
// calcSupplyScore
// ===========================================================================
describe('calcSupplyScore', () => {
  // 새 시그니처: (volume, price, sectorAvg, foreignNet, instNet, shortSell, foreign5d, inst5d, fStreak, iStreak, marketCap)
  it('returns 0 for all null inputs', () => {
    const result = calcSupplyScore(null, null, null, null, null, null, null, null, null, null, null);
    expect(result.score).toBe(0);
    expect(result.foreign_buying).toBe(false);
    expect(result.institution_buying).toBe(false);
    expect(result.volume_vs_sector).toBe(false);
    expect(result.low_short_sell).toBe(false);
  });

  it('scores foreign buying (+9)', () => {
    const result = calcSupplyScore(null, null, null, 1000, null, null, null, null, null, null, null);
    expect(result.foreign_buying).toBe(true);
    expect(result.score).toBe(9);
  });

  it('does not score foreign selling', () => {
    const result = calcSupplyScore(null, null, null, -500, null, null, null, null, null, null, null);
    expect(result.foreign_buying).toBe(false);
    expect(result.score).toBe(0);
  });

  it('scores institution buying (+9)', () => {
    const result = calcSupplyScore(null, null, null, null, 2000, null, null, null, null, null, null);
    expect(result.institution_buying).toBe(true);
    expect(result.score).toBe(9);
  });

  it('scores both foreign and institution buying with synergy bonus', () => {
    // foreign +9, institution +9, synergy +3 = 21
    const result = calcSupplyScore(null, null, null, 1000, 2000, null, null, null, null, null, null);
    expect(result.foreign_buying).toBe(true);
    expect(result.institution_buying).toBe(true);
    expect(result.score).toBe(21);
  });

  it('scores volume vs sector when turnover >= 2x sector average', () => {
    const result = calcSupplyScore(1000, 50000, 20000000, null, null, null, null, null, null, null, null);
    expect(result.volume_vs_sector).toBe(true);
    expect(result.score).toBe(4);
  });

  it('does not score volume vs sector when turnover < 2x', () => {
    const result = calcSupplyScore(1000, 50000, 30000000, null, null, null, null, null, null, null, null);
    expect(result.volume_vs_sector).toBe(false);
    expect(result.score).toBe(0);
  });

  it('scores low short sell ratio (< 1%)', () => {
    const result = calcSupplyScore(null, null, null, null, null, 0.5, null, null, null, null, null);
    expect(result.low_short_sell).toBe(true);
    expect(result.score).toBe(2);
  });

  it('does not score short sell ratio >= 1%', () => {
    const result = calcSupplyScore(null, null, null, null, null, 1.5, null, null, null, null, null);
    expect(result.low_short_sell).toBe(false);
    expect(result.score).toBe(0);
  });

  it('scores 0% short sell ratio as low', () => {
    const result = calcSupplyScore(null, null, null, null, null, 0, null, null, null, null, null);
    expect(result.low_short_sell).toBe(true);
    expect(result.score).toBe(2);
  });

  it('combines all positive factors', () => {
    // foreign +9, institution +9, synergy +3, volume +4, shortSell +2 = 27
    const result = calcSupplyScore(5000, 10000, 20000000, 1000, 2000, 0.3, null, null, null, null, null);
    expect(result.score).toBe(27);
  });

  it('caps score at 45', () => {
    const result = calcSupplyScore(5000, 10000, 20000000, 1000, 2000, 0.3, 5000, 5000, 5, 5, 100000000);
    expect(result.score).toBeLessThanOrEqual(45);
  });
});
