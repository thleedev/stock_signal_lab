/**
 * 지표 파생 계산.
 *
 * 이 파일은 다른 파일을 import 하지 않습니다 (배치·웹 공유 제약).
 *
 * 시계열 정렬 규약: 이 파일의 모든 함수는 입력 배열이 시간 오름차순
 * (오래된 값 → 최신값)이라고 가정합니다. sources/ 의 parseYahooChart·
 * parseNaverSiseJson·parseFredCsv 가 모두 이 순서로 값을 쌓으므로,
 * "최근 N개"는 항상 배열의 끝(slice(-N))에서 가져옵니다.
 */

const TRADING_DAYS_PER_YEAR = 252;

/** 직전값 대비 등락률(%). 계산 불가면 null. */
export function changePct(current: number, prev: number | null | undefined): number | null {
  if (prev == null || prev === 0) return null;
  if (!Number.isFinite(current) || !Number.isFinite(prev)) return null;
  return ((current - prev) / prev) * 100;
}

/**
 * 20일 실현변동성 — 일간 로그수익률 표준편차를 연율화한 퍼센트.
 * VKOSPI 대용으로 쓰며, 내재변동성과 수준은 다르나 방향성은 같이 움직입니다.
 *
 * closes 는 시간 오름차순이며 최소 21개가 필요합니다(수익률 20개).
 */
export function realizedVol20d(closes: number[]): number | null {
  if (closes.length < 21) return null;
  const window = closes.slice(-21);
  const returns: number[] = [];
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1];
    const cur = window[i];
    if (!(prev > 0) || !(cur > 0)) return null;
    returns.push(Math.log(cur / prev));
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100;
}

/**
 * 52주 고점 대비 낙폭(%). 음수일수록 깊은 조정.
 *
 * history 는 시간 오름차순(오래된 값 → 최신값)이며 최근 252거래일(52주)만 봅니다.
 */
export function drawdown52w(current: number, history: number[]): number | null {
  if (history.length < 50) return null;
  const window = history.slice(-252);
  let max = current;
  for (const v of window) if (v > max) max = v;
  if (max <= 0) return null;
  return ((current - max) / max) * 100;
}

/**
 * 200일 이동평균 대비 이격도(%).
 *
 * history 는 시간 오름차순(오래된 값 → 최신값)이며 최근 200개를 봅니다.
 */
export function ma200Diff(current: number, history: number[]): number | null {
  if (history.length < 50) return null;
  const window = history.slice(-200);
  const sum = window.reduce((a, b) => a + b, 0);
  const ma = sum / window.length;
  if (ma === 0) return null;
  return ((current - ma) / ma) * 100;
}
