import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import {
  fetchHolidays,
  generateExpiryDates,
  fetchFOMCDates,
  loadFallbackEconomicEvents,
  buildEventRow,
} from '@/lib/market-events';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();
  const year = now.getFullYear();
  const stats = { holidays: 0, expiry: 0, economic: 0, cleaned: 0 };

  // 1. 공휴일 수집
  for (const country of ['KR', 'US'] as const) {
    const holidays = await fetchHolidays(year, country);
    for (const h of holidays) {
      const row = buildEventRow(h.date, 'holiday', h.name, 'nager_date', country);
      await supabase.from('market_events').upsert(row, {
        onConflict: 'event_date,event_type,title',
      });
      stats.holidays++;
    }
  }

  // 2. 선물옵션 만기일
  const { data: krHolidayRows } = await supabase
    .from('market_events')
    .select('event_date')
    .eq('event_type', 'holiday')
    .eq('country', 'KR');

  const krHolidays = new Set((krHolidayRows || []).map((r: { event_date: string }) => r.event_date));
  const expiryDates = generateExpiryDates(now, 3, krHolidays);

  for (const exp of expiryDates) {
    const row = buildEventRow(exp.date, exp.type, exp.title, 'rule_based', 'KR');
    await supabase.from('market_events').upsert(row, {
      onConflict: 'event_date,event_type,title',
    });
    stats.expiry++;
  }

  // 3. 경제이벤트 (FRED → fallback)
  const fomcDates = await fetchFOMCDates(year);
  if (fomcDates.length > 0) {
    for (const date of fomcDates) {
      const month = new Date(date).getMonth() + 1;
      const row = buildEventRow(date, 'fomc', `FOMC 금리결정 (${month}월)`, 'fred_api', 'US');
      await supabase.from('market_events').upsert(row, {
        onConflict: 'event_date,event_type,title',
      });
      stats.economic++;
    }
  }

  const fallbackEvents = await loadFallbackEconomicEvents();
  for (const evt of fallbackEvents) {
    const row = buildEventRow(evt.date, evt.type, evt.title, 'manual', evt.country);
    await supabase.from('market_events').upsert(row, {
      onConflict: 'event_date,event_type,title',
      ignoreDuplicates: true,
    });
    stats.economic++;
  }

  // 4. 1년 이상 오래된 이벤트 정리
  const oneYearAgo = new Date(year - 1, now.getMonth(), now.getDate())
    .toISOString().slice(0, 10);
  const { count } = await supabase
    .from('market_events')
    .delete()
    .lt('event_date', oneYearAgo)
    .select('*', { count: 'exact', head: true });
  stats.cleaned = count ?? 0;

  return NextResponse.json({ success: true, stats });
}
