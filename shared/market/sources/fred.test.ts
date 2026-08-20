import { describe, it, expect } from 'vitest';
import { parseFredCsv, latestOf } from './fred';

// FRED 무키 CSV 실제 응답 형태.
// 결측은 마침표가 아니라 빈 문자열이다 (2026-08-17 실측 확인).
const SAMPLE = `observation_date,VIXCLS
2020-02-03,17.97
2020-02-04,16.05
2020-12-25,
2020-02-05,15.15
`;

describe('FRED CSV 파싱', () => {
  it('헤더를 건너뛰고 값을 파싱한다', () => {
    const points = parseFredCsv(SAMPLE);
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({ date: '2020-02-03', value: 17.97 });
  });

  it('빈 문자열 결측을 제외한다', () => {
    const points = parseFredCsv(SAMPLE);
    expect(points.some((p) => p.date === '2020-12-25')).toBe(false);
  });

  it('마침표 결측도 제외한다', () => {
    const points = parseFredCsv('observation_date,DGS10\n2020-01-01,.\n2020-01-02,1.88\n');
    expect(points).toHaveLength(1);
    expect(points[0].value).toBe(1.88);
  });

  it('빈 입력에서 빈 배열을 낸다', () => {
    expect(parseFredCsv('')).toEqual([]);
    expect(parseFredCsv('observation_date,VIXCLS\n')).toEqual([]);
  });

  it('CRLF 줄바꿈을 처리한다', () => {
    const points = parseFredCsv('observation_date,VIXCLS\r\n2020-02-03,17.97\r\n');
    expect(points).toHaveLength(1);
    expect(points[0].value).toBe(17.97);
  });

  it('latestOf 는 날짜가 가장 늦은 값을 낸다', () => {
    const points = parseFredCsv(SAMPLE);
    expect(latestOf(points)).toEqual({ date: '2020-02-05', value: 15.15 });
  });

  it('latestOf 는 빈 배열에서 null 을 낸다', () => {
    expect(latestOf([])).toBeNull();
  });
});
