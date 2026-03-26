/**
 * 시가총액 티어 분류
 *
 * 대형주/중형주/소형주를 구분하여 스코어링 로직을 차등 적용한다.
 * market_cap 단위: 억원 (stock_cache 기준)
 */

export type MarketCapTier = 'large' | 'mid' | 'small';

/** 시총 티어 기준 (억원) */
const LARGE_CAP_THRESHOLD = 50_000;  // 5조원 이상
const MID_CAP_THRESHOLD = 5_000;     // 5천억원 이상

export function getMarketCapTier(marketCap: number | null): MarketCapTier {
  if (!marketCap || marketCap <= 0) return 'small';
  if (marketCap >= LARGE_CAP_THRESHOLD) return 'large';
  if (marketCap >= MID_CAP_THRESHOLD) return 'mid';
  return 'small';
}
