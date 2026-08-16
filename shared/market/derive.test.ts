import { describe, it, expect } from 'vitest';
import { realizedVol20d, changePct, drawdown52w, ma200Diff } from './derive';

describe('등락률', () => {
  it('상승률을 퍼센트로 낸다', () => {
    expect(changePct(110, 100)).toBeCloseTo(10, 6);
  });

  it('하락률을 음수로 낸다', () => {
    expect(changePct(90, 100)).toBeCloseTo(-10, 6);
  });

  it('직전값이 0 이면 null 을 낸다', () => {
    expect(changePct(10, 0)).toBeNull();
  });

  it('직전값이 없으면 null 을 낸다', () => {
    expect(changePct(10, null)).toBeNull();
  });
});

describe('20일 실현변동성', () => {
  it('변동이 없으면 0 을 낸다', () => {
    const flat = Array(21).fill(100);
    expect(realizedVol20d(flat)).toBeCloseTo(0, 6);
  });

  it('종가가 21개 미만이면 null 을 낸다', () => {
    expect(realizedVol20d(Array(20).fill(100))).toBeNull();
  });

  it('변동이 클수록 값이 커진다', () => {
    const mild = [100, 101, 100, 101, 100, 101, 100, 101, 100, 101,
                  100, 101, 100, 101, 100, 101, 100, 101, 100, 101, 100];
    const wild = [100, 110, 100, 110, 100, 110, 100, 110, 100, 110,
                  100, 110, 100, 110, 100, 110, 100, 110, 100, 110, 100];
    const a = realizedVol20d(mild);
    const b = realizedVol20d(wild);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(b!).toBeGreaterThan(a!);
  });

  it('연율화된 퍼센트 값을 낸다', () => {
    // 일간 1% 진폭이 반복되면 연율화 변동성은 10% 를 넘는다
    const series = Array.from({ length: 21 }, (_, i) => (i % 2 === 0 ? 100 : 101));
    const v = realizedVol20d(series);
    expect(v).not.toBeNull();
    expect(v!).toBeGreaterThan(10);
    expect(v!).toBeLessThan(30);
  });

  it('0 이하 종가가 섞이면 null 을 낸다', () => {
    const bad = Array(21).fill(100);
    bad[5] = 0;
    expect(realizedVol20d(bad)).toBeNull();
  });
});

describe('52주 낙폭', () => {
  it('고점 대비 낙폭을 음수 퍼센트로 낸다', () => {
    const hist = Array(60).fill(0).map((_, i) => (i === 0 ? 200 : 150));
    expect(drawdown52w(150, hist)).toBeCloseTo(-25, 6);
  });

  it('현재가 고점이면 0 을 낸다', () => {
    const hist = Array(60).fill(100);
    expect(drawdown52w(120, hist)).toBeCloseTo(0, 6);
  });

  it('이력이 50개 미만이면 null 을 낸다', () => {
    expect(drawdown52w(100, Array(49).fill(100))).toBeNull();
  });
});

describe('200일 이격도', () => {
  it('평균 대비 이격을 퍼센트로 낸다', () => {
    const hist = Array(200).fill(100);
    expect(ma200Diff(110, hist)).toBeCloseTo(10, 6);
  });

  it('이력이 50개 미만이면 null 을 낸다', () => {
    expect(ma200Diff(100, Array(49).fill(100))).toBeNull();
  });

  it('평균이 0 이면 null 을 낸다', () => {
    expect(ma200Diff(100, Array(60).fill(0))).toBeNull();
  });
});
