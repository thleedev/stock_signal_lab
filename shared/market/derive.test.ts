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

  it('표본표준편차 기준으로 연율화한다', () => {
    // 로그수익률 ±ln(1.01) 20개, 평균 0.
    // 분모 n-1(19) → 16.21%, 분모 n(20) → 15.80%.
    // 허용폭을 넓게 잡으면 이 둘을 구분하지 못한다.
    const series = Array.from({ length: 21 }, (_, i) => (i % 2 === 0 ? 100 : 101));
    expect(realizedVol20d(series)).toBeCloseTo(16.21, 1);
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

  it('drawdown52w 는 최근 252개만 본다', () => {
    // 오래된 48개에 500 이 있으나 52주 윈도 밖이다.
    // 윈도잉이 있으면 max=100 → 0%, 없으면 max=500 → -80%
    const hist = [...Array(48).fill(500), ...Array(252).fill(100)];
    expect(drawdown52w(100, hist)).toBeCloseTo(0, 6);
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

  it('ma200Diff 는 최근 200개를 본다 (오름차순 배열의 끝)', () => {
    // 오래된 200개는 50, 최근 200개는 100.
    // slice(-200) 이면 평균 100 → (110-100)/100*100 = 10
    // slice(0,200) 이면 평균 50  → (110-50)/50*100  = 120
    const hist = [...Array(200).fill(50), ...Array(200).fill(100)];
    expect(ma200Diff(110, hist)).toBeCloseTo(10, 6);
  });
});
