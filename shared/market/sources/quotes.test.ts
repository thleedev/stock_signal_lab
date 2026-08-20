import { describe, it, expect } from 'vitest';
import { parseYahooChart, parseNaverSiseJson } from './quotes';

const YAHOO = {
  chart: {
    result: [
      {
        meta: { symbol: '^KS11', gmtoffset: 32400 },
        timestamp: [1580601600, 1580688000, 1580774400],
        indicators: { quote: [{ close: [2118.88, 2157.9, null] }] },
      },
    ],
  },
};

// 네이버 siseJson 은 JS 리터럴에 가까운 형태를 준다.
// 키가 따옴표 없이 오고 마지막에 쉼표가 붙는 경우가 있어 JSON.parse 가 실패한다.
const NAVER = `[['날짜','시가','고가','저가','종가','거래량','외국인소진율'],
['20150102', 1914.24, 1929.15, 1909.67, 1926.44, 258775, 0.0],
['20150105', 1926.44, 1930.10, 1901.05, 1915.65, 301254, 0.0]]`;

describe('Yahoo chart 파싱', () => {
  it('타임스탬프와 종가를 날짜별로 묶는다', () => {
    const points = parseYahooChart(YAHOO);
    expect(points).toHaveLength(2);
    expect(points[0].close).toBe(2118.88);
  });

  it('null 종가를 제외한다', () => {
    const points = parseYahooChart(YAHOO);
    expect(points.every((p) => Number.isFinite(p.close))).toBe(true);
  });

  it('KST 기준 날짜로 변환한다', () => {
    // 1580601600 = 2020-02-02T00:00:00Z = KST 2020-02-02 09:00
    const points = parseYahooChart(YAHOO);
    expect(points[0].date).toBe('2020-02-02');
  });

  it('빈 응답에서 빈 배열을 낸다', () => {
    expect(parseYahooChart({})).toEqual([]);
    expect(parseYahooChart({ chart: { result: [] } })).toEqual([]);
    expect(parseYahooChart(null)).toEqual([]);
  });
});

describe('네이버 siseJson 파싱', () => {
  it('헤더 행을 건너뛰고 종가를 뽑는다', () => {
    const points = parseNaverSiseJson(NAVER);
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual({ date: '2015-01-02', close: 1926.44 });
  });

  it('YYYYMMDD 를 하이픈 형식으로 바꾼다', () => {
    const points = parseNaverSiseJson(NAVER);
    expect(points[1].date).toBe('2015-01-05');
  });

  it('빈 입력에서 빈 배열을 낸다', () => {
    expect(parseNaverSiseJson('')).toEqual([]);
    expect(parseNaverSiseJson('[]')).toEqual([]);
  });

  it('차단 응답(HTML)에서 빈 배열을 낸다', () => {
    expect(parseNaverSiseJson('<html><body>error</body></html>')).toEqual([]);
  });
});
