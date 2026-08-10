/**
 * 이어받은 신호를 기존 목록 뒤에 붙이되 symbol 중복을 제거합니다.
 * 자동 새로고침과 이어받기가 겹치면 같은 종목이 두 번 들어올 수 있어
 * 먼저 들어온 행을 유지합니다.
 */
export function mergeSignals<T extends { symbol: string }>(existing: T[], incoming: T[]): T[] {
  const seen = new Set(existing.map((s) => s.symbol));
  const merged = [...existing];
  for (const item of incoming) {
    if (seen.has(item.symbol)) continue;
    seen.add(item.symbol);
    merged.push(item);
  }
  return merged;
}
