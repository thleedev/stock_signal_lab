import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchAllStockPrices, fetchNaverBulkIntegration } from '@/lib/naver-stock-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DEBOUNCE_MINUTES = 10;

// 지표+수급 통합 조회 시간 (KST 시:분)
const INTEGRATION_TIMES = [
  { h: 7, m: 30 },   // NXT 시작 전
  { h: 8, m: 30 },   // 장 시작 전
  { h: 12, m: 0 },   // 장중
  { h: 16, m: 0 },   // 장 마감 후
  { h: 20, m: 0 },   // NXT 마감 후
];

function isIntegrationTime(kstHour: number, kstMinute: number): boolean {
  for (const t of INTEGRATION_TIMES) {
    const diff = Math.abs((kstHour * 60 + kstMinute) - (t.h * 60 + t.m));
    if (diff <= 15) return true;
  }
  return false;
}

/**
 * 장중 가격 업데이트 — 온디맨드 (크론 아님)
 *
 * 트리거:
 *   - 사용자 페이지 진입 시 호출
 *   - collector 신호 수신 시 호출
 *
 * 10분 디바운스: snapshot_update_status.last_updated 기준,
 * 마지막 갱신 후 10분 이내면 스킵.
 *
 * 5개 시점(07:30, 08:30, 12:00, 16:00, 20:00)에는
 * 전종목 지표+수급 통합 조회, 나머지는 시세만.
 */
export async function GET() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const kstHour = kst.getUTCHours();
  const kstMinute = kst.getUTCMinutes();
  const kstDay = kst.getUTCDay();
  if (kstDay === 0 || kstDay === 6 || kstHour < 7 || kstHour >= 21) {
    return NextResponse.json({ skipped: true, reason: '장외 시간' });
  }

  const supabase = createServiceClient();

  // ── 10분 디바운스 체크 ──
  const { data: statusRow } = await supabase
    .from('snapshot_update_status')
    .select('last_updated')
    .eq('id', 1)
    .single();

  if (statusRow?.last_updated) {
    const lastUpdated = new Date(statusRow.last_updated);
    const elapsed = (Date.now() - lastUpdated.getTime()) / 60000;
    if (elapsed < DEBOUNCE_MINUTES) {
      return NextResponse.json({
        skipped: true,
        reason: `${DEBOUNCE_MINUTES}분 디바운스 (${Math.ceil(DEBOUNCE_MINUTES - elapsed)}분 후 갱신 가능)`,
        last_updated: statusRow.last_updated,
      });
    }
  }

  const now = new Date().toISOString();
  const BATCH = 500;
  let updated = 0;
  const useIntegration = isIntegrationTime(kstHour, kstMinute);

  if (useIntegration) {
    // ── 통합 조회: 시세 + 지표 + 수급 ──
    const integrationMap = await fetchNaverBulkIntegration();
    if (integrationMap.size === 0) {
      return NextResponse.json({ error: '네이버 통합 조회 실패' }, { status: 502 });
    }

    const allSymbols = [...integrationMap.keys()];
    for (let i = 0; i < allSymbols.length; i += BATCH) {
      const batch = allSymbols.slice(i, i + BATCH);
      const rows = batch.map((symbol) => {
        const d = integrationMap.get(symbol)!;
        const row: Record<string, unknown> = {
          symbol, name: d.name, market: d.market,
          current_price: d.current_price, market_cap: d.market_cap, updated_at: now,
        };
        if (d.volume > 0) {
          row.volume = d.volume;
          row.price_change = d.price_change;
          row.price_change_pct = d.price_change_pct;
        }
        if (d.per !== null || d.pbr !== null) {
          row.per = d.per; row.pbr = d.pbr; row.eps = d.eps; row.bps = d.bps;
          row.dividend_yield = d.dividend_yield; row.roe = d.roe; row.roe_estimated = d.roe_estimated;
          row.high_52w = d.high_52w; row.low_52w = d.low_52w;
          row.forward_per = d.forward_per; row.forward_eps = d.forward_eps;
          row.target_price = d.target_price; row.invest_opinion = d.invest_opinion;
          row.consensus_updated_at = now;
        }
        if (d.foreign_net !== null || d.institution_net !== null) {
          row.foreign_net_qty = d.foreign_net; row.institution_net_qty = d.institution_net;
          row.foreign_net_5d = d.foreign_net_5d; row.institution_net_5d = d.institution_net_5d;
          row.foreign_streak = d.foreign_streak; row.institution_streak = d.institution_streak;
          row.investor_updated_at = now;
        }
        return row;
      });
      const { error } = await supabase
        .from('stock_cache')
        .upsert(rows, { onConflict: 'symbol', ignoreDuplicates: false });
      if (!error) updated += rows.length;
    }
  } else {
    // ── 시세만 조회 (가벼운 벌크) ──
    const priceMap = await fetchAllStockPrices();
    if (priceMap.size === 0) {
      return NextResponse.json({ error: '네이버 가격 조회 실패' }, { status: 502 });
    }

    const entries = Array.from(priceMap.values());
    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH);
      const rows = batch.map((price) => ({
        symbol: price.symbol, name: price.name, market: price.market,
        current_price: price.current_price, market_cap: price.market_cap,
        updated_at: now,
        ...(price.volume > 0 ? {
          volume: price.volume, price_change: price.price_change,
          price_change_pct: price.price_change_pct,
        } : {}),
      }));
      const { error } = await supabase
        .from('stock_cache')
        .upsert(rows, { onConflict: 'symbol', ignoreDuplicates: false });
      if (!error) updated += rows.length;
    }
  }

  // ── 클라이언트 폴링용 타임스탬프 갱신 ──
  await supabase
    .from('snapshot_update_status')
    .update({ last_updated: now })
    .eq('id', 1);

  return NextResponse.json({
    success: true, updated,
    mode: useIntegration ? 'integration' : 'price-only',
    timestamp: now,
  });
}
