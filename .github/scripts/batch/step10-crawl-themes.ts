// .github/scripts/batch/step10-crawl-themes.ts
import { SupabaseClient } from '@supabase/supabase-js';

interface NaverTheme {
  theme_id: string;
  theme_name: string;
  avg_change_pct: number;
}

interface NaverThemeStock {
  theme_id: string;
  symbol: string;
  name: string;
  change_pct: number;
  change_5d_pct: number | null;
}

/**
 * 네이버 증권 테마 페이지에서 테마 목록과 종목을 수집한다.
 * HTML 파싱 기반 (공식 API 없음).
 */
export async function crawlThemes(supabase: SupabaseClient): Promise<void> {
  console.log('[step10] 네이버 테마 크롤 시작');

  const today = new Date(
    new Date().getTime() + 9 * 60 * 60 * 1000
  ).toISOString().slice(0, 10);

  // Step A: 테마 목록 수집
  const themes = await fetchThemeList();
  if (themes.length === 0) {
    console.warn('[step10] 테마 목록 없음');
    return;
  }
  console.log(`[step10] 테마 ${themes.length}개 수집`);

  // Step B: 테마별 종목 수집 (동시성 제한: 5개씩)
  const allStocks: NaverThemeStock[] = [];
  const CHUNK = 5;
  for (let i = 0; i < themes.length; i += CHUNK) {
    const chunk = themes.slice(i, i + CHUNK);
    const results = await Promise.allSettled(
      chunk.map((t) => fetchThemeStocks(t.theme_id))
    );
    for (let j = 0; j < results.length; j++) {
      const res = results[j];
      if (res.status === 'fulfilled') {
        allStocks.push(...res.value.map((s) => ({
          ...s,
          theme_id: chunk[j].theme_id,
        })));
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // Step C: momentum_score 정규화 (min-max)
  const changePcts = themes.map((t) => t.avg_change_pct);
  const minPct = Math.min(...changePcts);
  const maxPct = Math.max(...changePcts);
  const span = maxPct - minPct || 1;

  const themeRows = themes.map((t) => {
    const momentum_score = Math.round(((t.avg_change_pct - minPct) / span) * 100 * 10) / 10;
    return {
      theme_id: t.theme_id,
      theme_name: t.theme_name,
      avg_change_pct: t.avg_change_pct,
      top_change_pct: null as number | null,
      stock_count: allStocks.filter((s) => s.theme_id === t.theme_id).length,
      momentum_score,
      is_hot: false,
      date: today,
      updated_at: new Date().toISOString(),
    };
  });

  // 상위 10% = is_hot
  const sortedScores = [...themeRows].sort((a, b) => (b.momentum_score ?? 0) - (a.momentum_score ?? 0));
  const hotCount = Math.max(1, Math.ceil(sortedScores.length * 0.1));
  const hotIds = new Set(sortedScores.slice(0, hotCount).map((t) => t.theme_id));
  themeRows.forEach((t) => { if (hotIds.has(t.theme_id)) t.is_hot = true; });

  // Step D: 주도주 판별 (stock_cache 데이터 활용)
  const symbols = [...new Set(allStocks.map((s) => s.symbol))];
  const { data: cacheData } = await supabase
    .from('stock_cache')
    .select('symbol, volume, current_price, foreign_net_qty, institution_net_qty')
    .in('symbol', symbols);

  const cacheMap = new Map((cacheData ?? []).map((c) => [c.symbol as string, c]));

  const { data: allCache } = await supabase
    .from('stock_cache')
    .select('volume, current_price');
  const avgTurnover = (allCache ?? []).reduce((sum, c) => {
    return sum + (c.volume ?? 0) * (c.current_price ?? 0);
  }, 0) / Math.max(allCache?.length ?? 1, 1);

  const leaderSymbols = new Set<string>();
  const themeGrouped = new Map<string, NaverThemeStock[]>();
  for (const s of allStocks) {
    if (!themeGrouped.has(s.theme_id)) themeGrouped.set(s.theme_id, []);
    themeGrouped.get(s.theme_id)!.push(s);
  }

  for (const [, stocks] of themeGrouped) {
    const sorted = [...stocks].sort((a, b) =>
      ((b.change_5d_pct ?? b.change_pct) - (a.change_5d_pct ?? a.change_pct))
    );
    const top30Count = Math.max(1, Math.ceil(sorted.length * 0.3));
    const top30 = new Set(sorted.slice(0, top30Count).map((s) => s.symbol));

    for (const stock of stocks) {
      const cache = cacheMap.get(stock.symbol);
      const myTurnover = (cache?.volume ?? 0) * (cache?.current_price ?? 0);
      const volumeSurge = myTurnover > avgTurnover * 1.5;
      const smartMoney =
        (cache?.foreign_net_qty ?? 0) > 0 || (cache?.institution_net_qty ?? 0) > 0;
      const priceTop = top30.has(stock.symbol);

      const conditionsMet = [priceTop, volumeSurge, smartMoney].filter(Boolean).length;
      if (conditionsMet >= 2) leaderSymbols.add(stock.symbol);
    }
  }

  // Step E: DB 저장
  const { error: themeErr } = await supabase
    .from('stock_themes')
    .upsert(themeRows, { onConflict: 'theme_id,date' });
  if (themeErr) console.error('[step10] stock_themes 오류:', themeErr.message);

  const stockRows = allStocks.map((s) => ({
    theme_id: s.theme_id,
    symbol: s.symbol,
    name: s.name,
    change_pct: s.change_pct,
    is_leader: leaderSymbols.has(s.symbol),
    date: today,
  }));

  const BATCH = 500;
  for (let i = 0; i < stockRows.length; i += BATCH) {
    const { error } = await supabase
      .from('theme_stocks')
      .upsert(stockRows.slice(i, i + BATCH), { onConflict: 'theme_id,symbol,date' });
    if (error) console.error('[step10] theme_stocks 오류:', error.message);
  }

  console.log(
    `[step10] 완료 — 테마 ${themeRows.length}개, 종목 ${stockRows.length}건, 주도주 ${leaderSymbols.size}개`
  );
}

/** 네이버 테마 목록 페이지 파싱 */
async function fetchThemeList(): Promise<NaverTheme[]> {
  const resp = await fetch('https://finance.naver.com/sise/theme.naver', {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ko-KR' },
  });
  const buffer = await resp.arrayBuffer();
  const html = new TextDecoder('euc-kr').decode(buffer);
  const themes: NaverTheme[] = [];

  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  const linkRe = /sise_group_detail\.naver\?type=theme&no=(\d+)/;
  const nameRe = />([^<]+)<\/a>/;
  const changeRe = /([+-]?\d+\.\d+)/;

  let rowMatch: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const row = rowMatch[1];
    const linkMatch = linkRe.exec(row);
    if (!linkMatch) continue;
    const theme_id = linkMatch[1];
    if (seen.has(theme_id)) continue;
    seen.add(theme_id);

    const nameMatch = nameRe.exec(row);
    const theme_name = nameMatch ? nameMatch[1].trim() : theme_id;
    const changeMatch = changeRe.exec(row);
    const avg_change_pct = changeMatch ? parseFloat(changeMatch[1]) : 0;
    themes.push({ theme_id, theme_name, avg_change_pct });
  }

  return themes;
}

/** 네이버 테마 상세 페이지에서 종목 목록 파싱 */
async function fetchThemeStocks(theme_id: string): Promise<Omit<NaverThemeStock, 'theme_id'>[]> {
  const url = `https://finance.naver.com/sise/sise_group_detail.naver?type=theme&no=${theme_id}`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ko-KR' },
  });
  const buffer = await resp.arrayBuffer();
  const html = new TextDecoder('euc-kr').decode(buffer);
  const stocks: Omit<NaverThemeStock, 'theme_id'>[] = [];

  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  const codeRe = /code=(\d{6})/;
  const nameRe = /title="([^"]+)"/;
  const changeRe = /([+-]?\d+\.\d+)/g;

  const seen = new Set<string>();
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const row = rowMatch[1];
    const codeMatch = codeRe.exec(row);
    if (!codeMatch) continue;
    const symbol = codeMatch[1];
    if (seen.has(symbol)) continue;
    seen.add(symbol);

    const nameMatch = nameRe.exec(row);
    const name = nameMatch ? nameMatch[1].trim() : symbol;
    const changes: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = changeRe.exec(row)) !== null) {
      changes.push(parseFloat(m[1]));
    }
    stocks.push({
      symbol,
      name,
      change_pct: changes[0] ?? 0,
      change_5d_pct: changes[1] ?? null,
    });
  }

  return stocks;
}
