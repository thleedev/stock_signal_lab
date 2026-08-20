/**
 * FRED 시계열 수집 — API 키 없는 공개 CSV 경로를 쓴다.
 *
 * https://fred.stlouisfed.org/graph/fredgraph.csv?id=<SERIES>&cosd=&coed=
 *
 * 기존 코드는 api.stlouisfed.org 의 JSON API 를 써서 FRED_API_KEY 가 없으면
 * 지표가 통째로 빠졌습니다. CSV 경로는 키를 요구하지 않습니다.
 *
 * 결측 표기가 JSON API 의 마침표가 아니라 빈 문자열이므로 양쪽을 모두 걸러냅니다.
 *
 * BAMLH0A0HYM2 는 ICE 저작권 제한으로 이 경로에서 최근 3년치만 반환됩니다.
 */

export interface FredPoint {
  date: string;
  value: number;
}

/** CSV 본문을 파싱한다. 결측 행은 제외한다. */
export function parseFredCsv(csv: string): FredPoint[] {
  const out: FredPoint[] = [];
  const lines = csv.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const comma = line.indexOf(',');
    if (comma < 0) continue;
    const date = line.slice(0, comma).trim();
    const raw = line.slice(comma + 1).trim();
    if (!raw || raw === '.') continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    out.push({ date, value });
  }
  return out;
}

/** 날짜가 가장 늦은 관측치 */
export function latestOf(points: FredPoint[]): FredPoint | null {
  let best: FredPoint | null = null;
  for (const p of points) {
    if (!best || p.date > best.date) best = p;
  }
  return best;
}

/** 시계열을 받아 파싱한다. 실패 시 예외를 던진다. */
export async function fetchFredSeries(
  seriesId: string,
  from: string,
  to: string,
): Promise<FredPoint[]> {
  const url =
    `https://fred.stlouisfed.org/graph/fredgraph.csv` +
    `?id=${encodeURIComponent(seriesId)}&cosd=${from}&coed=${to}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new Error(`FRED ${seriesId} HTTP ${res.status}`);
  }
  const text = await res.text();
  const points = parseFredCsv(text);
  if (points.length === 0) {
    throw new Error(`FRED ${seriesId} 관측치 0건 (${from}~${to})`);
  }
  return points;
}
