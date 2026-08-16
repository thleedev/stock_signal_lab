/**
 * 롤링 통계 순수 함수 — mean·stddev·pctRank.
 *
 * 배치(.github/scripts/batch/step13-indicator-stats.ts)가 지표별 252일
 * 분위수·200일 이평 등을 계산할 때 쓰며, 순수 함수라 배치 파일 밖으로 뽑아
 * vitest 로 검증한다(.github/scripts/batch 는 vitest 실행 대상이 아니다).
 *
 * shared/market/ 의 다른 파일과 같은 제약을 따른다 — 배치와 웹 양쪽에서
 * 모듈 해석 규칙이 달라 이 파일은 다른 파일을 import 하지 않는다.
 *
 * 이 파일의 함수는 배열 정렬 순서에 의존하지 않는다(합·평균·이하 개수
 * 세기는 순서와 무관). 정렬 규약은 호출부(step13)가 명시한다.
 */

/** 산술 평균. 빈 배열이면 NaN — 호출부가 길이를 미리 검사해야 한다. */
export function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * 표본표준편차(분모 n-1, Bessel 보정).
 *
 * xs 를 더 긴 시계열에서 뽑은 표본(예: 최근 20일)으로 보고 n-1 을 쓴다.
 * 분모 n(모집단표준편차)과는 표본이 작을수록 차이가 커진다 — 예를 들어
 * [1,2,3,4,5]는 표본 1.58114 대 모집단 1.41421 로 약 12% 차이 난다. 이
 * 차이를 구분 못 하는 느슨한 허용폭 테스트는 분모를 잘못 짜도 통과하므로
 * stats.test.ts 는 두 값을 명시적으로 구분해 단언한다.
 *
 * xs.length < 2 면 표준편차를 정의할 수 없어(분모가 0이거나 음수) 0을 낸다.
 */
export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1));
}

/**
 * values 안에서 current 의 백분위(0~1).
 *
 * 정의: values 중 current 이하인 개수 / values.length — 경험적 누적분포함수
 * (empirical CDF)의 inclusive 버전이다. 이 배치의 호출부는 최근 N일 시계열의
 * 최신값 자체를 current 로 넘기므로 current 는 항상 values 안에 포함되어
 * 있다. 그 결과 count 는 최소 1이라 결과가 정확히 0이 될 수 없다(최솟값
 * 1/values.length). current 가 values 안에서 최댓값이면 정확히 1이 나올 수
 * 있다.
 *
 * 이는 버그가 아니라 "최근 N일 관측치(자기 자신 포함) 중 오늘이 몇 번째
 * 백분위인가"라는 의도된 정의의 결과다. "오늘을 제외한 과거 대비 순위"가
 * 필요하면 호출부가 values 에서 current 를 제외하고 넘겨야 한다.
 */
export function pctRank(current: number, values: number[]): number {
  if (values.length === 0) return 0;
  let count = 0;
  for (const v of values) if (v <= current) count++;
  return count / values.length;
}
