import { describe, it, expect } from 'vitest';
import { sumInvestorFlow5d } from './investor-flow';

describe('수급 5일 누적 합산', () => {
  it('5행 미만이면 null 을 낸다', () => {
    expect(sumInvestorFlow5d([
      { date: '2026-08-17', foreign_net: -100, institution_net: -50 },
    ])).toBeNull();
  });

  it('정확히 5행이면 합산한다', () => {
    const rows = [
      { date: '2026-08-17', foreign_net: -100, institution_net: -50 },
      { date: '2026-08-14', foreign_net: -200, institution_net: -60 },
      { date: '2026-08-13', foreign_net: -300, institution_net: -70 },
      { date: '2026-08-12', foreign_net: -400, institution_net: -80 },
      { date: '2026-08-11', foreign_net: -500, institution_net: -90 },
    ];
    const r = sumInvestorFlow5d(rows);
    expect(r).not.toBeNull();
    expect(r!.date).toBe('2026-08-17');
    expect(r!.foreignNet).toBe(-1500);
    expect(r!.institutionNet).toBe(-350);
  });

  it('6행 이상 넘어오면 최신 5행만 합산한다', () => {
    const rows = [
      { date: '2026-08-17', foreign_net: -100, institution_net: 0 },
      { date: '2026-08-14', foreign_net: -100, institution_net: 0 },
      { date: '2026-08-13', foreign_net: -100, institution_net: 0 },
      { date: '2026-08-12', foreign_net: -100, institution_net: 0 },
      { date: '2026-08-11', foreign_net: -100, institution_net: 0 },
      { date: '2026-08-10', foreign_net: -100, institution_net: 0 }, // 6번째 행은 제외
    ];
    const r = sumInvestorFlow5d(rows);
    expect(r!.foreignNet).toBe(-500);
  });

  it('null 값은 0 으로 취급한다', () => {
    const rows = [
      { date: '2026-08-17', foreign_net: null, institution_net: -50 },
      { date: '2026-08-14', foreign_net: -200, institution_net: null },
      { date: '2026-08-13', foreign_net: -300, institution_net: -70 },
      { date: '2026-08-12', foreign_net: -400, institution_net: -80 },
      { date: '2026-08-11', foreign_net: -500, institution_net: -90 },
    ];
    const r = sumInvestorFlow5d(rows);
    expect(r!.foreignNet).toBe(-1400);
    expect(r!.institutionNet).toBe(-290);
  });
});
