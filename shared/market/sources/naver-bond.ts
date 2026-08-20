/**
 * 네이버 금융 채권 일별 시세 — 국고채 3년(IRR_GOVT03Y) 등.
 *
 * ECOS 인증키 없이 KR_3Y 를 수집하는 경로입니다. 2026-08-20 실측으로
 * page=600 이 2009-08 을 반환해 2015년 이후 백필까지 이 소스로 가능합니다.
 * 페이지당 7행, 최신이 1페이지입니다.
 *
 * 응답은 EUC-KR HTML 이라 TextDecoder('euc-kr') 로 디코딩합니다.
 * 행 구조 (2026-08-20 실측):
 *   <td class="date"> 2026.08.19 </td>
 *   <td class="num">3.79</td>            ← 수익률(%), 이 값만 쓴다
 *   <td class="num"><img ...> 0.05</td>  ← 전일 대비, 부호가 img alt 에만 있어 버린다
 */

export interface BondPoint {
  date: string;
  value: number;
}

export function parseNaverBondQuote(html: string): BondPoint[] {
  const out: BondPoint[] = [];
  const re =
    /<td class="date">\s*(\d{4})\.(\d{2})\.(\d{2})\s*<\/td>\s*<td class="num">([\d.]+)<\/td>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const value = Number(m[4]);
    if (!Number.isFinite(value)) continue;
    out.push({ date: `${m[1]}-${m[2]}-${m[3]}`, value });
  }
  return out;
}

/**
 * fromDate(YYYY-MM-DD) 이후의 일별 수익률을 오름차순으로 반환합니다.
 * 마지막 페이지를 넘겨도 네이버가 같은 내용을 반복 반환하므로,
 * 직전 페이지와 첫 행 날짜가 같으면 끝으로 판단합니다.
 */
export async function fetchNaverBondDaily(
  code: string,
  fromDate: string,
  opts?: { maxPages?: number; delayMs?: number },
): Promise<BondPoint[]> {
  const maxPages = opts?.maxPages ?? 30;
  const delayMs = opts?.delayMs ?? 150;
  const all: BondPoint[] = [];
  let prevFirstDate = '';

  for (let page = 1; page <= maxPages; page++) {
    const url = `https://finance.naver.com/marketindex/interestDailyQuote.naver?marketindexCd=${code}&page=${page}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`네이버 채권 ${code} HTTP ${res.status}`);
    const html = new TextDecoder('euc-kr').decode(await res.arrayBuffer());
    const points = parseNaverBondQuote(html);
    if (points.length === 0 || points[0].date === prevFirstDate) break;
    prevFirstDate = points[0].date;
    all.push(...points);
    if (points[points.length - 1].date <= fromDate) break;
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  const dedup = new Map(all.map((p) => [p.date, p]));
  return [...dedup.values()]
    .filter((p) => p.date >= fromDate)
    .sort((a, b) => a.date.localeCompare(b.date));
}
