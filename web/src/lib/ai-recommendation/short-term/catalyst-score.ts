/**
 * 초단기 촉매 스코어
 *
 * 원점수 범위: -10 ~ 70 -> 정규화: (raw + 10) / 80 * 100
 *
 * 구성 요소:
 *   A. 신호 신선도 (최대 25점, 하나만 적용)
 *   B. 섹터/테마 모멘텀 (최대 25점, 하나만 적용)
 *   C. 신호가 대비 현재 위치 (최대 20점) — 아직 안 오른 종목을 강하게 우대
 */

// ---------------------------------------------------------------------------
// 인터페이스 정의
// ---------------------------------------------------------------------------

export interface CatalystInput {
  /** 오늘 BUY 소스 수 (0~3) */
  todayBuySources: number;
  /** 마지막 BUY로부터 경과일 (0=오늘) */
  daysSinceLastBuy: number;
  /** 섹터 상승률 순위 (1=최상), null이면 정보 없음 */
  sectorRank: number | null;
  /** 총 섹터 수 */
  sectorCount: number;
  /** 해당 섹터 평균 등락률 (%) */
  sectorAvgChangePct: number;
  /** 해당 종목 등락률 (%) */
  stockChangePct: number;
  /** 섹터 내 종목 등락률 순위, null이면 정보 없음 */
  stockRankInSector: number | null;
  /** 해당 섹터 내 종목 수 */
  sectorStockCount: number;
  /** (현재가-신호가)/신호가 * 100, null이면 신호가 없음 */
  signalPriceGapPct: number | null;
}

export interface CatalystResult {
  /** 원점수 (-10 ~ 60) */
  raw: number;
  /** 정규화 점수 (0 ~ 100) */
  normalized: number;
}

// ---------------------------------------------------------------------------
// A. 신호 신선도 (최대 25점, 하나만 적용)
// ---------------------------------------------------------------------------

/**
 * 신호 신선도 점수를 계산한다.
 *
 * 오늘 신규 BUY 소스 수와 경과일에 따라 하나의 조건만 적용한다.
 * - 오늘 BUY 3소스 동시: +25
 * - 오늘 BUY 2소스: +20
 * - 오늘 BUY 1소스: +15
 * - 어제 BUY 발생 (daysSinceLastBuy === 1): +10
 * - 최근 3일 내 첫 신호 (daysSinceLastBuy <= 3): +5
 * - 5일 이상 지난 신호: 0
 */
function calcSignalFreshnessScore(
  todayBuySources: number,
  daysSinceLastBuy: number,
): number {
  // 오늘 BUY가 있으면 소스 수에 따라 점수 부여
  if (todayBuySources >= 3) return 25;
  if (todayBuySources === 2) return 20;
  if (todayBuySources === 1) return 15;

  // 오늘 BUY가 없으면 경과일 기준
  if (daysSinceLastBuy === 1) return 10;
  if (daysSinceLastBuy <= 3) return 5;

  return 0;
}

// ---------------------------------------------------------------------------
// B. 섹터/테마 모멘텀 (최대 25점, 하나만 적용)
// ---------------------------------------------------------------------------

/**
 * 섹터/테마 모멘텀 점수를 계산한다.
 *
 * 섹터 약세 조건을 먼저 평가하고, 이후 강세 조건을 순서대로 확인한다.
 * - 섹터 전체 약세 (sectorAvgChangePct < -1): -10
 * - 섹터 약한데 종목만 단독 상승 (sectorAvg < 0 AND stockChange > 0): +3
 * - 당일 해당 섹터 상승률 상위 3 (sectorRank <= 3): +20
 * - 섹터 내 상승률 상위 30%: +15
 * - 섹터 평균 이상 상승: +8
 */
function calcSectorMomentumScore(
  sectorRank: number | null,
  sectorCount: number,
  sectorAvgChangePct: number,
  stockChangePct: number,
  stockRankInSector: number | null,
  sectorStockCount: number,
): number {
  // 섹터 전체 약세 (가장 부정적 조건 우선)
  if (sectorAvgChangePct < -1) return -10;

  // 섹터 약한데 종목만 단독 상승
  if (sectorAvgChangePct < 0 && stockChangePct > 0) return 3;

  // 당일 해당 섹터 상승률 상위 3
  if (sectorRank !== null && sectorRank <= 3) return 20;

  // 섹터 내 상승률 상위 30%
  if (
    stockRankInSector !== null &&
    sectorStockCount > 0 &&
    stockRankInSector <= sectorStockCount * 0.3
  ) {
    return 15;
  }

  // 섹터 평균 이상 상승
  if (stockChangePct > sectorAvgChangePct) return 8;

  return 0;
}

// ---------------------------------------------------------------------------
// C. 신호가 대비 현재 위치 (최대 20점)
// ---------------------------------------------------------------------------

/**
 * 신호가 대비 현재 위치 점수를 계산한다.
 *
 * 핵심 설계 원칙: "신호 받고 아직 안 오른 종목 = 1-2일 내 상승 최고 후보"
 *
 * - 신호가 대비 -3% 이상 저평가: +20 (시장이 아직 미반응 = 최고 진입 기회)
 * - 현재가 <= 신호가 (≤0%): +15 (신호 후 미반응 = 진입 적기)
 * - 신호가 대비 [0%, +3%): +8 (신호 후 소폭 상승 = 진입 가능)
 * - 신호가 대비 [+3%, +7%): +3 (이미 어느 정도 상승, 추격 주의)
 * - 신호가 대비 >= +7%: 0 (이미 상승 → 리스크 패널티 별도 적용)
 * - signalPriceGapPct null: +5 (데이터 없으면 중립)
 */
function calcSignalPricePositionScore(
  signalPriceGapPct: number | null,
): number {
  if (signalPriceGapPct === null) return 5;
  if (signalPriceGapPct <= -3) return 20;
  if (signalPriceGapPct <= 0) return 15;
  if (signalPriceGapPct < 3) return 8;
  if (signalPriceGapPct < 7) return 3;
  return 0;
}

// ---------------------------------------------------------------------------
// 메인 함수
// ---------------------------------------------------------------------------

/**
 * 초단기 촉매 스코어를 계산한다.
 *
 * 원점수 범위: -10 ~ 70
 * 정규화: (raw + 10) / 80 * 100 -> 0 ~ 100
 */
export function calcCatalystScore(input: CatalystInput): CatalystResult {
  const a = calcSignalFreshnessScore(input.todayBuySources, input.daysSinceLastBuy);
  const b = calcSectorMomentumScore(
    input.sectorRank,
    input.sectorCount,
    input.sectorAvgChangePct,
    input.stockChangePct,
    input.stockRankInSector,
    input.sectorStockCount,
  );
  const c = calcSignalPricePositionScore(input.signalPriceGapPct);

  // 원점수 합산 후 범위 clamp
  const rawUnclamped = a + b + c;
  const raw = Math.max(-10, Math.min(70, rawUnclamped));

  // 정규화: (raw + 10) / 80 * 100
  const normalized = Math.max(0, Math.min(100, ((raw + 10) / 80) * 100));

  return { raw, normalized };
}
