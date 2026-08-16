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

  it('오름차순으로 넘어와도 함수가 직접 정렬해 같은 값을 낸다', () => {
    // 호출부 하나가 실수로 .order('date', { ascending: true }) 로 바꿔도
    // (page.tsx 와 route.ts 가 각자 같은 쿼리를 복붙해 두고 있다) 이
    // 함수가 정렬을 책임지므로 결과가 흔들리지 않아야 한다.
    const descending = [
      { date: '2026-08-17', foreign_net: -100, institution_net: -50 },
      { date: '2026-08-14', foreign_net: -200, institution_net: -60 },
      { date: '2026-08-13', foreign_net: -300, institution_net: -70 },
      { date: '2026-08-12', foreign_net: -400, institution_net: -80 },
      { date: '2026-08-11', foreign_net: -500, institution_net: -90 },
    ];
    const ascending = [...descending].reverse();
    expect(sumInvestorFlow5d(ascending)).toEqual(sumInvestorFlow5d(descending));
  });

  it('오름차순 7행이 넘어와도 가장 오래된 5행이 아니라 최신 5행을 합산한다', () => {
    // 정렬 없이 slice(0,5) 만 했다면 오름차순 입력에서 가장 오래된
    // 5행(위험이 가장 낮은 시점)을 조용히 합산하는 사고로 이어진다.
    const ascending = [
      { date: '2026-08-11', foreign_net: -10, institution_net: 0 },
      { date: '2026-08-12', foreign_net: -10, institution_net: 0 },
      { date: '2026-08-13', foreign_net: -10, institution_net: 0 }, // 최신 5행에 포함
      { date: '2026-08-14', foreign_net: -100, institution_net: 0 },
      { date: '2026-08-17', foreign_net: -100, institution_net: 0 },
      { date: '2026-08-18', foreign_net: -100, institution_net: 0 },
      { date: '2026-08-19', foreign_net: -100, institution_net: 0 },
    ];
    const r = sumInvestorFlow5d(ascending);
    // 최신 5행: 08-13,08-14,08-17,08-18,08-19 = -10 + -100*4 = -410
    expect(r!.date).toBe('2026-08-19');
    expect(r!.foreignNet).toBe(-410);
  });
});
