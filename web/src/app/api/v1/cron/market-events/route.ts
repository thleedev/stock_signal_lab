import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import {
  fetchHolidays,
  fetchFOMCDates,
  generateExpiryDates,
  loadFallbackEconomicEvents,
  buildEventRow,
} from '@/lib/market-events';
import type { EventType } from '@/types/market-event';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 시장 이벤트 적재 cron
 * - 한/미 공휴일 (Nager.Date)
 * - 한국 선물옵션 만기일 (룰 기반, 향후 12개월)
 * - 미국 FOMC (FRED API → 폴백 정적 JSON)
 * - 기타 경제지표 (정적 폴백 JSON)
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  // CRON_SECRET 미설정 시 인증 생략 (수동 호출 가능). 운영 환경은 반드시 설정 필요.
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const today = new Date();
  const thisYear = today.getFullYear();
  const nextYear = thisYear + 1;

  type EventRow = ReturnType<typeof buildEventRow>;
  const rows: EventRow[] = [];

  // 1) 한국 공휴일 (수집 후 만기일 계산에 활용)
  const krHolidaysSet = new Set<string>();
  for (const year of [thisYear, nextYear]) {
    const krHols = await fetchHolidays(year, 'KR');
    for (const h of krHols) {
      krHolidaysSet.add(h.date);
      rows.push(buildEventRow(h.date, 'holiday', h.name, 'nager_date', 'KR', null, {}));
    }
    const usHols = await fetchHolidays(year, 'US');
    for (const h of usHols) {
      rows.push(buildEventRow(h.date, 'holiday', h.name, 'nager_date', 'US', null, {}));
    }
  }

  // 2) 향후 12개월 선물옵션 만기일 (한국)
  const expiries = generateExpiryDates(today, 12, krHolidaysSet);
  for (const e of expiries) {
    rows.push(buildEventRow(e.date, e.type, e.title, 'rule_based', 'KR', null, {}));
  }

  // 3) FOMC (FRED → 폴백)
  const fomcDates = new Set<string>();
  for (const year of [thisYear, nextYear]) {
    const dates = await fetchFOMCDates(year);
    for (const d of dates) fomcDates.add(d);
  }
  for (const date of fomcDates) {
    const month = parseInt(date.slice(5, 7), 10);
    rows.push(
      buildEventRow(date, 'fomc', `FOMC 금리결정 (${month}월)`, 'fred_api', 'US', null, {})
    );
  }

  // 4) 정적 폴백 경제 이벤트 (FOMC + CPI + 고용)
  const fallback = await loadFallbackEconomicEvents();
  for (const e of fallback) {
    // FOMC는 이미 FRED에서 가져온 경우 중복이지만 upsert로 안전하게 머지
    rows.push(
      buildEventRow(e.date, e.type as EventType, e.title, 'manual', e.country ?? 'US', null, {})
    );
  }

  // 5) Upsert (event_date, event_type, title 유니크)
  let inserted = 0;
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from('market_events')
      .upsert(batch, { onConflict: 'event_date,event_type,title' });
    if (error) {
      console.error('[cron/market-events] upsert error:', error.message);
    } else {
      inserted += batch.length;
    }
  }

  return NextResponse.json({
    success: true,
    total: rows.length,
    inserted,
    breakdown: {
      kr_holidays: krHolidaysSet.size,
      expiries: expiries.length,
      fomc: fomcDates.size,
      fallback: fallback.length,
    },
  });
}
