/**
 * 백테스트 정답지 — KOSPI 하락 국면 (설계 §8.1).
 *
 * KOSPI 2015-01-02 ~ 2026-08-14 종가를 지그재그(10% 반전)로 분해한
 * 하락 국면입니다. 전고점 회복 방식은 2018년 하락장이 코로나 폭락을
 * 삼키므로 쓰지 않았습니다.
 *
 * breach(-10% 최초 이탈일)는 날짜가 아니라 규칙입니다 — 백테스트 엔진이
 * 고점일 이후 종가가 고점 대비 -10% 를 처음 뚫는 날을 KOSPI 시계열에서
 * 계산합니다. 여기 고정하지 않는 이유는 백필 소스가 바뀌어 종가가 미세
 * 조정되면 이탈일도 함께 움직여야 하기 때문입니다.
 */

export interface DrawdownRegime {
  name: string;
  peakDate: string;
  troughDate: string;
  /** 설계 시점 실측 낙폭(%). 검산용 참고값이며 판정에는 쓰지 않는다 */
  drawdownPct: number;
}

export const DRAWDOWN_REGIMES: DrawdownRegime[] = [
  { name: '2015 여름', peakDate: '2015-04-23', troughDate: '2015-08-24', drawdownPct: -15.81 },
  { name: '2016 초', peakDate: '2015-11-04', troughDate: '2016-02-12', drawdownPct: -10.59 },
  { name: '2018~19', peakDate: '2018-01-29', troughDate: '2019-01-03', drawdownPct: -23.27 },
  { name: '2019 여름', peakDate: '2019-04-16', troughDate: '2019-08-07', drawdownPct: -15.07 },
  { name: '2020 코로나', peakDate: '2020-01-22', troughDate: '2020-03-19', drawdownPct: -35.71 },
  { name: '2021~22 긴축', peakDate: '2021-07-06', troughDate: '2022-07-06', drawdownPct: -30.65 },
  { name: '2022 가을', peakDate: '2022-08-16', troughDate: '2022-09-30', drawdownPct: -14.92 },
  { name: '2023 초', peakDate: '2022-11-11', troughDate: '2023-01-03', drawdownPct: -10.65 },
  { name: '2023 가을', peakDate: '2023-08-01', troughDate: '2023-10-31', drawdownPct: -14.59 },
  { name: '2024 엔캐리', peakDate: '2024-07-11', troughDate: '2024-08-05', drawdownPct: -15.56 },
  { name: '2024 겨울', peakDate: '2024-08-22', troughDate: '2024-12-09', drawdownPct: -12.82 },
  { name: '2026 여름', peakDate: '2026-06-22', troughDate: '2026-07-30', drawdownPct: -38.63 },
];

/** 학습/검증 분리 경계 — 고점일이 이 날짜 미만이면 학습 구간 (설계 §8.3) */
export const TRAIN_VALID_SPLIT = '2023-01-01';
