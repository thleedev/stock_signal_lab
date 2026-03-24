/**
 * 네이버 전종목 투자지표 벌크 조회
 *
 * 개별 종목 API(fetchStockIndicators)를 고병렬로 호출하여
 * 전종목 PER/PBR/EPS/BPS/52주최고최저/배당수익률을 빠르게 조회
 *
 * 성능: 50종목 150ms, 200종목 ~0.6초, 3000종목 ~10초
 * (기존: 5병렬 × 200ms 딜레이 → 200종목 40~60초)
 */

const NAVER_API = 'https://m.stock.naver.com/api';

export interface BulkIndicatorData {
  per: number;
  pbr: number;
  eps: number;
  bps: number;
  roe: number;
  high_52w: number;
  low_52w: number;
  dividend_yield: number;
  // Forward valuation (컨센서스)
  forward_per: number | null;
  forward_eps: number | null;
  target_price: number | null;
  invest_opinion: number | null;  // 1~5 (5=강력매수)
}

interface NaverIntegrationInfo {
  code: string;
  value: string;
}

function parseIndicatorValue(str: string | undefined): number {
  if (!str) return 0;
  return parseFloat(str.replace(/[,배원%조억백만]/g, '')) || 0;
}

async function fetchSingleIndicator(symbol: string): Promise<BulkIndicatorData | null> {
  try {
    const res = await fetch(`${NAVER_API}/stock/${symbol}/integration`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const infos = data.totalInfos as NaverIntegrationInfo[] | undefined;
    if (!infos) return null;

    const getValue = (code: string): number => {
      const info = infos.find((i) => i.code === code);
      return parseIndicatorValue(info?.value);
    };
    const getValueOrNull = (code: string): number | null => {
      const info = infos.find((i) => i.code === code);
      if (!info?.value) return null;
      const v = parseIndicatorValue(info.value);
      return v > 0 ? v : null;
    };

    // 컨센서스 데이터 (없을 수 있음)
    const consensus = data.consensusInfo as { priceTargetMean?: string; recommMean?: string } | undefined;
    const targetPrice = consensus?.priceTargetMean
      ? parseInt(consensus.priceTargetMean.replace(/,/g, ''), 10) || null
      : null;
    const investOpinion = consensus?.recommMean
      ? parseFloat(consensus.recommMean) || null
      : null;

    return {
      per: getValue('per'),
      pbr: getValue('pbr'),
      eps: getValue('eps'),
      bps: getValue('bps'),
      roe: getValue('roe'),
      high_52w: getValue('highPriceOf52Weeks'),
      low_52w: getValue('lowPriceOf52Weeks'),
      dividend_yield: getValue('dividendYield'),
      forward_per: getValueOrNull('cnsPer'),
      forward_eps: getValueOrNull('cnsEps'),
      target_price: targetPrice,
      invest_opinion: investOpinion,
    };
  } catch {
    return null;
  }
}

/**
 * 네이버 투자지표 벌크 조회 (고병렬)
 *
 * @param symbols 조회할 종목 코드 배열
 * @param concurrency 동시 요청 수 (기본 30)
 * @returns Map<symbol, BulkIndicatorData>
 */
export async function fetchBulkIndicators(
  symbols: string[],
  concurrency = 30
): Promise<Map<string, BulkIndicatorData>> {
  const result = new Map<string, BulkIndicatorData>();
  if (symbols.length === 0) return result;

  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (symbol) => {
        const data = await fetchSingleIndicator(symbol);
        if (data) result.set(symbol, data);
      })
    );

    // 실패율이 높으면 잠시 대기 (rate limit 방어)
    const failures = results.filter((r) => r.status === 'rejected').length;
    if (failures > batch.length * 0.5) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return result;
}
