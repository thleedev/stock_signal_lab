import { describe, it, expect } from 'vitest';
import { mean, stddev, pctRank } from './stats';

describe('평균', () => {
  it('산술 평균을 계산한다', () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
  });

  it('음수가 섞여도 계산한다', () => {
    expect(mean([-10, 0, 10])).toBe(0);
  });
});

describe('표준편차', () => {
  it('표본표준편차(분모 n-1)를 계산하고 모집단표준편차(분모 n)와 구분한다', () => {
    // [1,2,3,4,5], 평균 3, 편차제곱합 10.
    // 표본(분모 n-1=4): sqrt(10/4)      ≈ 1.5811388
    // 모집단(분모 n=5):  sqrt(10/5)      ≈ 1.4142136
    // 허용폭을 넓게 잡으면 두 정의를 구분하지 못한 채 통과한다 — 직전
    // 태스크(realizedVol20d)에서 이 문제가 실제로 발견됐다. 여기서는
    // 소수점 6자리까지 표본값에 고정하고, 모집단값과는 명백히 다름을
    // 별도로 단언한다.
    const result = stddev([1, 2, 3, 4, 5]);
    expect(result).toBeCloseTo(1.5811388, 6);
    // 모집단표준편차(1.4142136)와 표본표준편차 사이 격차(약 0.167)보다
    // 훨씬 좁은 허용폭으로 비교해, 분모를 n으로 잘못 짜면 이 단언이
    // 실패하게 한다.
    expect(Math.abs(result - 1.4142136)).toBeGreaterThan(0.1);
  });

  it('원소가 2개 미만이면 0을 낸다', () => {
    expect(stddev([])).toBe(0);
    expect(stddev([5])).toBe(0);
  });

  it('모든 값이 같으면 0을 낸다', () => {
    expect(stddev([7, 7, 7, 7])).toBe(0);
  });
});

describe('백분위(pctRank)', () => {
  it('현재값이 배열 최댓값이면 1을 낸다', () => {
    expect(pctRank(10, [1, 2, 3, 10])).toBe(1);
  });

  it('현재값이 배열 최솟값이어도 0이 되지 않는다 (자기 자신 포함 정의)', () => {
    // current(1) 자신이 values 안에 포함되어 있어 count 최소 1.
    // 1,2,3,4 중 1 이하는 1 뿐이므로 1/4.
    expect(pctRank(1, [1, 2, 3, 4])).toBeCloseTo(0.25, 6);
  });

  it('중간값이면 그 이하 관측치 비율을 낸다', () => {
    // values=[1,2,3,4,5], current=3 → 1,2,3 이 3 이하 → 3/5
    expect(pctRank(3, [1, 2, 3, 4, 5])).toBeCloseTo(0.6, 6);
  });

  it('빈 배열이면 0을 낸다', () => {
    expect(pctRank(5, [])).toBe(0);
  });
});
