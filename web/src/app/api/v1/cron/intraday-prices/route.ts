import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchAllStockPrices } from '@/lib/naver-stock-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * 장중 가격 업데이트 크론 (30분 간격, KST 08:00~20:00)
 *
 * 매 실행:
 *   1. 네이버에서 전종목 가격 갱신 → stock_cache
 *   2. 클라이언트 폴링용 last_updated 갱신 (snapshot_update_status)
 *
 * 20시 마감 실행 (일 1회):
 *   3. 관리종목/유통주식수 갱신 (네이버, 신호 종목만)
 *   4. DART 재무 데이터 수집
 *   5. 30일 초과 스냅샷 삭제
 *
 * 참고: 랭킹 스냅샷은 daily-prices 크론에서 1일 1회 저장
 */
export async function GET() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const kstHour = kst.getUTCHours();
  const kstDay = kst.getUTCDay();
  if (kstDay === 0 || kstDay === 6 || kstHour < 8 || kstHour >= 20) {
    return NextResponse.json({ skipped: true, reason: '장외 시간' });
  }

  const supabase = createServiceClient();
  const priceMap = await fetchAllStockPrices();

  if (priceMap.size === 0) {
    return NextResponse.json({ error: '네이버 가격 조회 실패' }, { status: 502 });
  }

  const now = new Date().toISOString();
  const entries = Array.from(priceMap.values());
  const BATCH = 500;
  let updated = 0;

  // ── 1. 가격 업서트 ──
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const rows = batch.map((price) => {
      const row: Record<string, unknown> = {
        symbol: price.symbol,
        current_price: price.current_price,
        market_cap: price.market_cap,
        updated_at: now,
      };
      if (price.name) row.name = price.name;
      if (price.volume > 0) {
        row.volume = price.volume;
        row.price_change = price.price_change;
        row.price_change_pct = price.price_change_pct;
      }
      return row;
    });

    const { error } = await supabase
      .from('stock_cache')
      .upsert(rows, { onConflict: 'symbol', ignoreDuplicates: false });

    if (!error) updated += rows.length;
  }

  // ── 2. 클라이언트 폴링용 타임스탬프 갱신 ──
  await supabase
    .from('snapshot_update_status')
    .update({ last_updated: now })
    .eq('id', 1);

  // ── 3~5. 20시 마감 작업 (19시 이후 마지막 실행) ──
  if (kstHour >= 19) {
    // 3. 관리종목/유통주식수 — 신호 있는 종목만 (~900건)
    try {
      const { fetchBatchStockExtra } = await import('@/lib/naver-stock-extra');
      const { data: signalStocks } = await supabase
        .from('stock_cache')
        .select('symbol')
        .gt('signal_count_30d', 0);

      const targetSymbols = (signalStocks ?? []).map((s: { symbol: string }) => s.symbol);

      if (targetSymbols.length > 0) {
        const extraMap = await fetchBatchStockExtra(targetSymbols, 10);

        const extraUpdates: { symbol: string; float_shares: number | null; is_managed: boolean }[] = [];
        for (const [symbol, info] of extraMap.entries()) {
          extraUpdates.push({ symbol, float_shares: info.floatShares, is_managed: info.isManaged });
        }

        // upsert 대신 update — NOT NULL 컬럼 충돌 방지
        for (const u of extraUpdates) {
          await supabase
            .from('stock_cache')
            .update({ float_shares: u.float_shares, is_managed: u.is_managed })
            .eq('symbol', u.symbol);
        }
      }
    } catch (e) {
      console.error('네이버 추가 데이터 수집 실패:', e);
    }

    // 4. DART 수집
    try {
      const { fetchDartInfo } = await import('@/lib/dart-api');

      const { data: existingDart } = await supabase
        .from('stock_dart_info')
        .select('symbol, updated_at');

      const todayStart = new Date(Date.now() + 9 * 3600000);
      todayStart.setHours(0, 0, 0, 0);

      const alreadyUpdated = new Set(
        (existingDart ?? [])
          .filter((d: { symbol: string; updated_at: string | null }) =>
            d.updated_at && new Date(d.updated_at) > todayStart,
          )
          .map((d: { symbol: string; updated_at: string | null }) => d.symbol),
      );

      const { data: symbols } = await supabase
        .from('stock_cache')
        .select('symbol, dart_corp_code')
        .not('dart_corp_code', 'is', null);

      const targets = (symbols ?? []).filter(
        (s: { symbol: string; dart_corp_code: string }) => !alreadyUpdated.has(s.symbol),
      );

      for (let i = 0; i < targets.length; i += 10) {
        const batch = targets.slice(i, i + 10);
        type DartResult = { symbol: string; info: Awaited<ReturnType<typeof fetchDartInfo>> };
        const results = await Promise.allSettled(
          batch.map(async (s: { symbol: string; dart_corp_code: string }): Promise<DartResult> => ({
            symbol: s.symbol,
            info: await fetchDartInfo(s.dart_corp_code),
          })),
        );

        const dartRows = results
          .filter((r): r is PromiseFulfilledResult<DartResult> => r.status === 'fulfilled')
          .map((r) => ({
            symbol: r.value.symbol,
            ...r.value.info,
            updated_at: new Date().toISOString(),
          }));

        if (dartRows.length > 0) {
          await supabase
            .from('stock_dart_info')
            .upsert(dartRows, { onConflict: 'symbol', ignoreDuplicates: false });
        }
      }
    } catch (e) {
      console.error('DART 데이터 수집 실패:', e);
    }

    // 5. 30일 초과 스냅샷 삭제
    const thirtyDaysAgo = new Date(Date.now() + 9 * 3600000);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    await supabase
      .from('stock_ranking_snapshot')
      .delete()
      .lt('snapshot_date', thirtyDaysAgo.toISOString().slice(0, 10));
  }

  return NextResponse.json({ success: true, updated, total: priceMap.size, timestamp: now });
}
