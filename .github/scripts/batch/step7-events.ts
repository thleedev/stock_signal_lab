// .github/scripts/batch/step7-events.ts
import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';

/** FOMC 날짜를 FRED API에서 조회 */
async function fetchFomcDates(year: number): Promise<string[]> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return [];
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=FEDFUNDS&api_key=${apiKey}&file_type=json&observation_start=${year}-01-01&observation_end=${year}-12-31&frequency=m`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const json = await res.json() as { observations?: { date: string }[] };
    return (json.observations ?? []).map(o => o.date);
  } catch {
    return [];
  }
}

export async function runStep7Events(): Promise<void> {
  log('step7', '이벤트 캘린더 갱신 시작');
  const now = new Date();
  const year = now.getFullYear();

  // FOMC 날짜 갱신
  const fomcDates = await fetchFomcDates(year);
  for (const date of fomcDates) {
    const month = new Date(date).getMonth() + 1;
    await supabase.from('market_events').upsert({
      event_date: date,
      event_type: 'fomc',
      title: `FOMC 금리결정 (${month}월)`,
      source: 'fred_api',
      country: 'US',
    }, { onConflict: 'event_date,event_type,title' });
  }

  // 선물옵션 만기일 (매달 2번째 목요일)
  for (let month = 1; month <= 12; month++) {
    const d = new Date(year, month - 1, 1);
    let thursdays = 0;
    while (thursdays < 2) {
      if (d.getDay() === 4) thursdays++;
      if (thursdays < 2) d.setDate(d.getDate() + 1);
    }
    const expiryDate = d.toISOString().slice(0, 10);
    await supabase.from('market_events').upsert({
      event_date: expiryDate,
      event_type: 'expiry',
      title: `선물옵션 만기일 (${month}월)`,
      source: 'rule_based',
      country: 'KR',
    }, { onConflict: 'event_date,event_type,title' });
  }

  log('step7', `완료: FOMC ${fomcDates.length}건 + 선물만기 12건`);
}
