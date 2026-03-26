/**
 * 네이버 증권 종목 상세 페이지 — 추가 정보 크롤러
 *
 * 제공 데이터:
 * - 유통주식수 (floatShares): 종목 상세 테이블에서 파싱
 * - 관리종목 여부 (isManaged): "관리종목" 텍스트 감지
 *
 * parseStockExtra: 순수 HTML 파서 (테스트 가능)
 * fetchStockExtra: 네트워크 요청 포함 (개별 종목)
 * fetchBatchStockExtra: 병렬 배치 조회
 */

export interface StockExtraInfo {
  floatShares: number | null
  isManaged: boolean
}

/**
 * 네이버 증권 종목 페이지 HTML에서 유통주식수와 관리종목 여부를 파싱한다.
 *
 * @param html 네이버 증권 종목 페이지 HTML 문자열
 * @returns 유통주식수(없으면 null)와 관리종목 여부
 */
export function parseStockExtra(html: string): StockExtraInfo {
  let floatShares: number | null = null
  let isManaged = false

  // 상장주식수 파싱: <th ...>상장주식수</th><td><em>5,919,637,922</em></td>
  const floatMatch = html.match(/상장주식수<\/th>\s*<td>\s*<em>([\d,]+)<\/em>/)
  if (floatMatch) {
    floatShares = parseInt(floatMatch[1].replace(/,/g, ''), 10)
  }

  // 관리종목 여부 감지: "관리종목" 텍스트 포함 여부로 판단
  if (html.includes('관리종목')) {
    isManaged = true
  }

  return { floatShares, isManaged }
}

/**
 * 네이버 증권 종목 상세 페이지를 크롤링하여 추가 정보를 반환한다.
 * 요청 타임아웃 4초 적용, 실패 시 기본값 반환.
 *
 * @param symbol 종목 코드 (6자리)
 */
export async function fetchStockExtra(symbol: string): Promise<StockExtraInfo> {
  try {
    const url = `https://finance.naver.com/item/main.naver?code=${symbol}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return { floatShares: null, isManaged: false }
    const html = await res.text()
    return parseStockExtra(html)
  } catch {
    return { floatShares: null, isManaged: false }
  }
}

/**
 * 여러 종목의 추가 정보를 병렬로 배치 조회한다.
 * 실패한 종목은 결과 Map에서 제외된다.
 *
 * @param symbols 종목 코드 배열
 * @param concurrency 동시 요청 수 (기본 10)
 */
export async function fetchBatchStockExtra(
  symbols: string[],
  concurrency = 10,
): Promise<Map<string, StockExtraInfo>> {
  const results = new Map<string, StockExtraInfo>()

  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency)
    const settled = await Promise.allSettled(
      batch.map(async (sym) => ({ sym, info: await fetchStockExtra(sym) })),
    )
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        results.set(r.value.sym, r.value.info)
      }
    }
  }

  return results
}
