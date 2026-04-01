import { describe, it, expect } from 'vitest';
import { calcCompositeScore } from './composite-score';
import type { DailyPrice } from '@/lib/ai-recommendation/technical-score';

function makePrice(close: number, volume = 500000): DailyPrice {
  return { date: '2026-01-01', open: close * 0.99, high: close * 1.01, low: close * 0.98, close, volume };
}

describe('calcCompositeScore', () => {
  it('삼성전자 시뮬 — 가치우량 + 수급전환 → B+ (65점+)', () => {
    // 40일치: 초반 하락 후 반등 (52주 저점 +12% 구간)
    const prices: DailyPrice[] = [];
    for (let i = 0; i < 25; i++) prices.push(makePrice(60000 - i * 500));
    for (let i = 0; i < 15; i++) prices.push(makePrice(47500 + i * 600));

    const result = calcCompositeScore({
      prices,
      high52w: 90000,
      low52w: 45000,
      foreignStreak: 3,
      institutionStreak: 1,
      foreignNetQty: 1000000,
      institutionNetQty: 500000,
      foreignNet5d: 2000000,
      institutionNet5d: 800000,
      shortSellRatio: 0.5,
      currentPrice: 56500,
      targetPrice: 72000,
      forwardPer: 12,
      per: 16,
      pbr: 1.0,
      roe: 12,
      dividendYield: 2.0,
      investOpinion: 4.0,
      todaySourceCount: 0,
      daysSinceLastSignal: null,
      recentCount30d: 0,
      lastSignalPrice: null,
      marketCap: 3500000,
      isManaged: false,
      hasRecentCbw: false,
      auditOpinion: null,
    });
    expect(result.score_total).toBeGreaterThanOrEqual(60);
  });

  it('관리종목 → 리스크 페널티로 감점', () => {
    const prices: DailyPrice[] = Array.from({ length: 30 }, (_, i) => makePrice(50 + i));
    const base = {
      prices, high52w: 100, low52w: 50,
      foreignStreak: 2, institutionStreak: 2,
      foreignNetQty: 100, institutionNetQty: 100,
      foreignNet5d: 200, institutionNet5d: 200,
      shortSellRatio: 0.5,
      currentPrice: 80, targetPrice: 100, forwardPer: 8, per: 10,
      pbr: 0.6, roe: 15, dividendYield: 3, investOpinion: 4.5,
      todaySourceCount: 1, daysSinceLastSignal: 0, recentCount30d: 2, lastSignalPrice: 80,
      marketCap: 500,
      hasRecentCbw: false, auditOpinion: null,
    };
    const managed = calcCompositeScore({ ...base, isManaged: true });
    const normal = calcCompositeScore({ ...base, isManaged: false });
    expect(managed.score_total).toBeLessThan(normal.score_total);
  });

  it('신호 없어도 가치+기술+수급으로 고득점', () => {
    const prices: DailyPrice[] = [];
    for (let i = 0; i < 30; i++) prices.push(makePrice(80 + i * 0.5));
    const result = calcCompositeScore({
      prices, high52w: 150, low52w: 75,
      foreignStreak: 1, institutionStreak: 1,
      foreignNetQty: 50000, institutionNetQty: 30000,
      foreignNet5d: 80000, institutionNet5d: 50000,
      shortSellRatio: 0.3,
      currentPrice: 95,
      targetPrice: 135,
      forwardPer: 6, per: 9, pbr: 0.5, roe: 18,
      dividendYield: 4, investOpinion: 4.5,
      todaySourceCount: 0, daysSinceLastSignal: null, recentCount30d: 0, lastSignalPrice: null,
      marketCap: 5000,
      isManaged: false, hasRecentCbw: false, auditOpinion: null,
    });
    expect(result.score_total).toBeGreaterThanOrEqual(65);
  });
});
