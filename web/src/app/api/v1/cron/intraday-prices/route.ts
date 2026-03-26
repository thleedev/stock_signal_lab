import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchAllStockPrices } from '@/lib/naver-stock-api';
import { fetchBatchStockExtra } from '@/lib/naver-stock-extra';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * 장중 가격 업데이트 크론 (30분 간격, KST 09:00~16:00)
 * daily-prices 크론의 경량 버전: 네이버에서 전종목 가격만 갱신
 *
 * 추가 처리:
 * 1. 관리종목/유통주식수 갱신 (naver-stock-extra)
 * 2. stock-ranking 스냅샷 생성 (standard + short_term)
 * 3. 20:00 KST 이후 DART 재무 데이터 수집
 * 4. 30일 초과 스냅샷 삭제
 */
export async function GET() {
  // 장중(KST 08:00~20:00, 평일)에만 실행
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const kstHour = kst.getUTCHours();
  const kstDay = kst.getUTCDay(); // 0=일, 6=토
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

  // --- 가격 업서트 ---
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

  // --- 관리종목 / 유통주식수 갱신 ---
  try {
    const allSymbols = entries.map((e) => e.symbol);
    const extraMap = await fetchBatchStockExtra(allSymbols, 20);

    const extraUpdates: { symbol: string; float_shares: number | null; is_managed: boolean }[] = [];
    for (const [symbol, info] of extraMap.entries()) {
      extraUpdates.push({
        symbol,
        float_shares: info.floatShares,
        is_managed: info.isManaged,
      });
    }

    for (let i = 0; i < extraUpdates.length; i += BATCH) {
      await supabase
        .from('stock_cache')
        .upsert(extraUpdates.slice(i, i + BATCH), {
          onConflict: 'symbol',
          ignoreDuplicates: false,
        });
    }
  } catch (e) {
    console.error('네이버 추가 데이터 수집 실패:', e);
  }

  // --- 스냅샷 생성 ---
  try {
    await supabase
      .from('snapshot_update_status')
      .update({ updating: true, model: 'standard' })
      .eq('id', 1);

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const todayStr = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

    for (const model of ['standard', 'short_term']) {
      // 진행 중인 모델명 기록
      await supabase
        .from('snapshot_update_status')
        .update({ model })
        .eq('id', 1);

      // date=all로 전체 종목 스코어링 → 스냅샷에 전체 저장
      // signal_all/today 필터는 스냅샷 읽기 시 적용
      const res = await fetch(
        `${baseUrl}/api/v1/stock-ranking?date=all&model=${model}&refresh=true`,
        { signal: AbortSignal.timeout(180000) },
      );
      if (!res.ok) {
        console.error(`스냅샷 생성 실패 (${model}):`, res.status);
      }
    }

    // 30일 초과 스냅샷 삭제
    const thirtyDaysAgo = new Date(Date.now() + 9 * 3600000);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoff = thirtyDaysAgo.toISOString().slice(0, 10);

    await supabase
      .from('stock_ranking_snapshot')
      .delete()
      .lt('snapshot_date', cutoff);
  } catch (e) {
    console.error('스냅샷 생성 중 오류:', e);
  } finally {
    await supabase
      .from('snapshot_update_status')
      .update({ updating: false, last_updated: new Date().toISOString() })
      .eq('id', 1);
  }

  // --- 20:00 KST 이후 DART 데이터 수집 ---
  // kstHour는 이미 위에서 계산됨 (장외 시간 체크 통과 후이므로 08~19 범위)
  // 20:00 조건은 실질적으로 이 크론이 19:30 등 마지막 실행 시 처리될 수 있으므로
  // kstHour >= 19를 사용하여 마지막 실행 시 DART 수집을 트리거함
  if (kstHour >= 19) {
    try {
      const { fetchDartInfo } = await import('@/lib/dart-api');

      // 오늘 이미 갱신된 종목은 건너뜀 (일 1회만 갱신)
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

      // dart_corp_code가 있는 종목만 대상
      const { data: symbols } = await supabase
        .from('stock_cache')
        .select('symbol, dart_corp_code')
        .not('dart_corp_code', 'is', null);

      const targets = (symbols ?? []).filter(
        (s: { symbol: string; dart_corp_code: string }) => !alreadyUpdated.has(s.symbol),
      );

      // 10개씩 병렬 처리
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
  }

  return NextResponse.json({
    success: true,
    updated,
    total: priceMap.size,
    timestamp: now,
  });
}
