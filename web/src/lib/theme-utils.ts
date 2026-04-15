// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = { from: (table: string) => any };

/**
 * theme_stocks/stock_themes에서 유효한 날짜를 반환합니다.
 * 오늘(KST) 데이터가 없으면 가장 최근 날짜로 fallback합니다.
 */
export async function getEffectiveThemeDate(
  supabase: AnySupabase,
  todayKst: string
): Promise<string> {
  const { data } = await supabase
    .from('stock_themes')
    .select('date')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.date ?? todayKst;
}

/**
 * 주어진 심볼 목록의 테마 정보를 조회합니다.
 * theme_stocks + stock_themes를 합쳐 symbol → { is_leader, theme_tags } 맵 반환.
 */
export async function fetchThemeMap(
  supabase: AnySupabase,
  symbols: string[],
  date: string
): Promise<Map<string, { is_leader: boolean; theme_tags: { theme_id: string; theme_name: string; momentum_score: number; is_hot: boolean }[] }>> {
  if (symbols.length === 0) return new Map();

  type ThemeStock = { symbol: string; theme_id: string; is_leader: boolean };
  type ThemeMeta = { theme_id: string; theme_name: string; momentum_score: number | null; is_hot: boolean | null };

  const [{ data: rawStocks }, { data: rawMeta }] = await Promise.all([
    supabase.from('theme_stocks').select('symbol, theme_id, is_leader').eq('date', date).in('symbol', symbols),
    supabase.from('stock_themes').select('theme_id, theme_name, momentum_score, is_hot').eq('date', date),
  ]);
  const themeStocksRows = (rawStocks ?? []) as ThemeStock[];
  const themeMetaRows = (rawMeta ?? []) as ThemeMeta[];

  const metaMap = new Map(themeMetaRows.map(t => [t.theme_id, t]));
  const result = new Map<string, { is_leader: boolean; theme_tags: { theme_id: string; theme_name: string; momentum_score: number; is_hot: boolean }[] }>();

  for (const r of themeStocksRows) {
    if (!result.has(r.symbol)) result.set(r.symbol, { is_leader: false, theme_tags: [] });
    const entry = result.get(r.symbol)!;
    if (r.is_leader) entry.is_leader = true;
    const meta = metaMap.get(r.theme_id);
    if (meta) {
      entry.theme_tags.push({
        theme_id: r.theme_id,
        theme_name: meta.theme_name,
        momentum_score: meta.momentum_score ?? 0,
        is_hot: meta.is_hot ?? false,
      });
    }
  }

  // 강도 순 정렬, 최대 2개
  for (const entry of result.values()) {
    entry.theme_tags.sort((a, b) => b.momentum_score - a.momentum_score);
    entry.theme_tags = entry.theme_tags.slice(0, 2);
  }

  return result;
}
