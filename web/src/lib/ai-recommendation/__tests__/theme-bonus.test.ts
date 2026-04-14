import { describe, it, expect } from 'vitest';
import { calcThemeBonus } from '../theme-bonus';

describe('calcThemeBonus', () => {
  it('테마 미소속 종목은 보너스 없음', () => {
    const result = calcThemeBonus({ themes: [], is_leader: false });
    expect(result.supply_bonus).toBe(0);
    expect(result.trend_bonus).toBe(0);
    expect(result.risk_deduction).toBe(0);
    expect(result.theme_tags).toEqual([]);
    expect(result.is_leader).toBe(false);
    expect(result.is_hot_theme).toBe(false);
  });

  it('테마 강도 100이면 수급 보너스 +10', () => {
    const result = calcThemeBonus({
      themes: [{ theme_id: 't1', theme_name: '반도체', momentum_score: 100, is_hot: false }],
      is_leader: false,
    });
    expect(result.supply_bonus).toBe(10);
    expect(result.trend_bonus).toBe(0);
  });

  it('테마 강도 50이면 수급 보너스 +5', () => {
    const result = calcThemeBonus({
      themes: [{ theme_id: 't1', theme_name: 'AI', momentum_score: 50, is_hot: false }],
      is_leader: false,
    });
    expect(result.supply_bonus).toBe(5);
  });

  it('주도주이면 수급 +5, 추세 +3 추가', () => {
    const result = calcThemeBonus({
      themes: [{ theme_id: 't1', theme_name: '방산', momentum_score: 0, is_hot: false }],
      is_leader: true,
    });
    expect(result.supply_bonus).toBe(5);
    expect(result.trend_bonus).toBe(3);
  });

  it('테마 강도 80 + 주도주 → 수급 +13, 추세 +3', () => {
    const result = calcThemeBonus({
      themes: [{ theme_id: 't1', theme_name: '2차전지', momentum_score: 80, is_hot: false }],
      is_leader: true,
    });
    expect(result.supply_bonus).toBe(13); // 8(테마) + 5(주도주)
    expect(result.trend_bonus).toBe(3);
  });

  it('과열 테마 소속이면 risk_deduction +5', () => {
    const result = calcThemeBonus({
      themes: [{ theme_id: 't1', theme_name: 'AI', momentum_score: 90, is_hot: true }],
      is_leader: false,
    });
    expect(result.risk_deduction).toBe(5);
    expect(result.is_hot_theme).toBe(true);
  });

  it('여러 테마 중 가장 강한 테마로 보너스 계산', () => {
    const result = calcThemeBonus({
      themes: [
        { theme_id: 't1', theme_name: 'AI', momentum_score: 80, is_hot: false },
        { theme_id: 't2', theme_name: '반도체', momentum_score: 60, is_hot: false },
        { theme_id: 't3', theme_name: '방산', momentum_score: 40, is_hot: false },
      ],
      is_leader: false,
    });
    expect(result.supply_bonus).toBe(8); // 80/100 * 10
  });

  it('테마 태그는 강도 순 최대 2개', () => {
    const result = calcThemeBonus({
      themes: [
        { theme_id: 't1', theme_name: 'AI', momentum_score: 80, is_hot: false },
        { theme_id: 't2', theme_name: '반도체', momentum_score: 60, is_hot: false },
        { theme_id: 't3', theme_name: '방산', momentum_score: 40, is_hot: false },
      ],
      is_leader: false,
    });
    expect(result.theme_tags).toHaveLength(2);
    expect(result.theme_tags[0].theme_name).toBe('AI');
    expect(result.theme_tags[1].theme_name).toBe('반도체');
  });

  it('momentum_score가 null인 테마는 0으로 처리', () => {
    const result = calcThemeBonus({
      themes: [{ theme_id: 't1', theme_name: 'X', momentum_score: null, is_hot: false }],
      is_leader: false,
    });
    expect(result.supply_bonus).toBe(0);
  });
});
