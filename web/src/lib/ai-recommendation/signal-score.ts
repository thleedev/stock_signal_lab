import { extractSignalPrice } from '@/lib/signal-constants';
import type { ScoreReason, NormalizedScoreBase } from '@/types/score-reason';

const MAX_SCORE = 30;

export interface SignalScoreResult extends NormalizedScoreBase {
  score: number; // 0~30 (하위 호환)
  signal_count: number;
  has_today_signal: boolean;
  has_frequent_signal: boolean;
  signal_below_price: boolean;
}

export function calcSignalScore(
  todaySignals: Array<{ source: string; raw_data: unknown }>,
  recentCount: number,
  currentPrice: number | null
): SignalScoreResult {
  const sources = new Set(todaySignals.map((s) => s.source));
  const sourceCount = sources.size;
  const hasTodaySignal = sourceCount > 0;
  const reasons: ScoreReason[] = [];

  // 다중소스 점수
  let multiSourceRaw = 0;
  if (sourceCount >= 3) multiSourceRaw = 15;
  else if (sourceCount === 2) multiSourceRaw = 10;
  else if (sourceCount === 1) multiSourceRaw = 5;

  const multiSourceMet = sourceCount > 0;
  const sourceNames = [...sources].join(', ');
  reasons.push({
    label: '다중소스',
    points: Math.round((multiSourceRaw / MAX_SCORE) * 100 * 10) / 10,
    detail: multiSourceMet
      ? `${sourceCount}개 소스 (${sourceNames})`
      : '신호 없음',
    met: multiSourceMet,
  });

  // 당일 신호 점수
  const todaySignalRaw = hasTodaySignal ? 5 : 0;
  reasons.push({
    label: '당일 신호',
    points: Math.round((todaySignalRaw / MAX_SCORE) * 100 * 10) / 10,
    detail: hasTodaySignal ? '당일 매수 신호 발생' : '당일 신호 없음',
    met: hasTodaySignal,
  });

  // 빈번 신호 점수
  const hasFrequentSignal = recentCount >= 3;
  const frequentRaw = hasFrequentSignal ? 5 : 0;
  reasons.push({
    label: '빈번 신호',
    points: Math.round((frequentRaw / MAX_SCORE) * 100 * 10) / 10,
    detail: `최근 30일 ${recentCount}회 (기준: 3회 이상)`,
    met: hasFrequentSignal,
  });

  // 신호가 하회 점수
  let signalBelowPrice = false;
  let belowRaw = 0;
  let belowDetail = '신호가 정보 없음';

  if (currentPrice && todaySignals.length > 0) {
    const signalPrice = extractSignalPrice(
      todaySignals[0].raw_data as Record<string, unknown> | null
    );
    if (signalPrice) {
      if (currentPrice <= signalPrice) {
        belowRaw = 5;
        signalBelowPrice = true;
      }
      belowDetail = `현재가 ${currentPrice.toLocaleString('ko-KR')} ≤ 신호가 ${signalPrice.toLocaleString('ko-KR')}`;
    }
  }

  reasons.push({
    label: '신호가 하회',
    points: Math.round((belowRaw / MAX_SCORE) * 100 * 10) / 10,
    detail: belowDetail,
    met: signalBelowPrice,
  });

  const rawScore = multiSourceRaw + todaySignalRaw + frequentRaw + belowRaw;
  const clampedRaw = Math.min(rawScore, MAX_SCORE);
  const normalizedScore =
    Math.round((clampedRaw / MAX_SCORE) * 100 * 10) / 10;

  return {
    score: clampedRaw,
    rawScore: clampedRaw,
    normalizedScore,
    reasons,
    signal_count: sourceCount,
    has_today_signal: hasTodaySignal,
    has_frequent_signal: hasFrequentSignal,
    signal_below_price: signalBelowPrice,
  };
}
