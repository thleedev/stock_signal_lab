import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 활성 신호에 업종을 채웁니다.
 *
 * stock_cache 에는 업종 컬럼이 없어 date=all 모드의 신호는 sector 가 빈
 * 문자열로 나왔고, 그 결과 업종 뷰가 "기타" 한 덩어리로만 표시됐습니다.
 * 업종은 stock_info 에 있으므로 심볼로 조회해 채웁니다. 날짜 범위 모드가
 * 이미 같은 테이블을 조인하고 있어 검증된 경로입니다.
 *
 * 페이지의 최초 200행과 /api/v1/signals/active 의 이어받기가 모두 이 함수를
 * 써야 이어 붙인 행의 업종이 어긋나지 않습니다.
 */

/** 업종을 채울 대상. 최소한 symbol 과 sector 를 가집니다. */
type SectorTarget = { symbol: string; sector: string };

/**
 * 심볼 → 업종 매핑을 신호 목록에 적용합니다.
 *
 * 이미 값이 있는 항목은 건드리지 않습니다. 날짜 범위 모드가 채워 넘긴 값을
 * 덮어쓰지 않기 위함입니다. 매핑에 없거나 빈 값이면 "기타"로 둡니다.
 */
export function mergeSectors<T extends SectorTarget>(
  signals: T[],
  sectorMap: Record<string, string>
): T[] {
  return signals.map((s) => {
    if (s.sector) return s;
    return { ...s, sector: sectorMap[s.symbol] || '기타' };
  });
}

/**
 * stock_info 에서 심볼별 업종을 조회합니다.
 *
 * 조회에 실패해도 예외를 던지지 않고 빈 매핑을 돌려줍니다. 업종은 부가
 * 정보이므로 이것 때문에 신호 목록 전체가 실패하면 안 됩니다.
 */
export async function fetchSectorMap(
  supabase: SupabaseClient,
  symbols: string[]
): Promise<Record<string, string>> {
  if (symbols.length === 0) return {};

  const { data, error } = await supabase
    .from('stock_info')
    .select('symbol, sector')
    .in('symbol', symbols)
    .not('sector', 'is', null);

  if (error) {
    console.error('[signal-sector] 업종 조회 실패:', error.message);
    return {};
  }

  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.sector) map[row.symbol] = row.sector;
  }
  return map;
}
