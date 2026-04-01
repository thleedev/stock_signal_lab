// web/src/lib/scoring/signal-bonus.ts
// SMS 신호 보너스 점수 모듈 — 신호는 보너스 역할만 하며 신호 없어도 A등급 달성 가능

import type { ScoreReason, NormalizedScoreBase } from '@/types/score-reason';

/** calcSignalBonus 입력 파라미터 */
export interface SignalBonusInput {
  /** 오늘 BUY 신호를 발생시킨 소스(채널) 수 */
  todaySourceCount: number;
  /** 마지막 신호로부터 경과 일수 (신호 없으면 null) */
  daysSinceLastSignal: number | null;
  /** 최근 30일 내 BUY 신호 횟수 */
  recentCount30d: number;
  /** 현재 주가 (비교 불가능하면 null) */
  currentPrice: number | null;
  /** 마지막 신호 시점의 주가 (없으면 null) */
  lastSignalPrice: number | null;
}

/** calcSignalBonus 반환 타입 */
export type SignalBonusResult = NormalizedScoreBase;

/**
 * SMS 신호 보너스 점수를 계산한다.
 *
 * 점수 기준:
 * - 오늘 2개+ 소스 동시 신호 → 60점
 * - 오늘 1개 소스 신호       → 40점
 * - 3~10일 경과 + 현재가 ≤ 신호가 → 50점 (아직 진입 기회)
 * - 3~10일 경과 + 현재가 > 신호가 → 30점 (이미 상승)
 * - 11일+ 경과 + 30일 내 3회+ 반복 → 20점 (반복 패턴)
 * - 그 외 → 0점 (보너스 없음)
 *
 * @param input - 신호 정보 입력값
 * @returns 정규화 점수 및 산출 근거
 */
export function calcSignalBonus(input: SignalBonusInput): SignalBonusResult {
  const {
    todaySourceCount,
    daysSinceLastSignal,
    recentCount30d,
    currentPrice,
    lastSignalPrice,
  } = input;

  const reasons: ScoreReason[] = [];
  let score = 0;

  if (todaySourceCount >= 2) {
    // 오늘 여러 소스에서 동시 신호 — 가장 강한 보너스
    score = 60;
    reasons.push({
      label: '오늘 신호',
      points: 60,
      detail: `오늘 ${todaySourceCount}개 소스 동시 신호`,
      met: true,
    });
  } else if (todaySourceCount === 1) {
    // 오늘 단일 소스 신호
    score = 40;
    reasons.push({
      label: '오늘 신호',
      points: 40,
      detail: '오늘 1개 소스 신호',
      met: true,
    });
  } else if (
    daysSinceLastSignal !== null &&
    daysSinceLastSignal >= 3 &&
    daysSinceLastSignal <= 10
  ) {
    // 최근 신호(3~10일 이내) — 현재가와 신호가 비교
    const belowOrAt =
      lastSignalPrice !== null &&
      currentPrice !== null &&
      currentPrice <= lastSignalPrice;
    score = belowOrAt ? 50 : 30;

    const priceComparison =
      lastSignalPrice !== null && currentPrice !== null
        ? currentPrice <= lastSignalPrice
          ? `현재가 ${currentPrice} ≤ 신호가 ${lastSignalPrice} (진입 기회)`
          : `현재가 ${currentPrice} > 신호가 ${lastSignalPrice} (이미 상승)`
        : '가격 비교 불가';

    reasons.push({
      label: '최근 신호',
      points: score,
      detail: `${daysSinceLastSignal}일 경과, ${priceComparison}`,
      met: true,
    });
  } else if (
    recentCount30d >= 3 &&
    (daysSinceLastSignal === null || daysSinceLastSignal > 10)
  ) {
    // 오래된 신호이지만 30일 내 반복 패턴 확인
    score = 20;
    reasons.push({
      label: '반복 신호',
      points: 20,
      detail: `30일 내 ${recentCount30d}회 반복 신호`,
      met: true,
    });
  } else {
    // 신호 없음 — 보너스 없음 (그래도 A등급 달성 가능)
    reasons.push({
      label: '신호 없음',
      points: 0,
      detail: '최근 30일 BUY 신호 없음',
      met: false,
    });
  }

  return {
    rawScore: score,
    normalizedScore: score,
    reasons,
  };
}
