import { EVENT_RISK_DEFAULTS, type EventType, type MarketEvent } from '@/types/market-event';

/**
 * 특정 월의 둘째 목요일 계산
 */
export function getSecondThursday(year: number, month: number): Date {
  const firstDay = new Date(year, month, 1);
  const dayOfWeek = firstDay.getDay();
  const firstThursday = 1 + ((4 - dayOfWeek + 7) % 7);
  const secondThursday = firstThursday + 7;
  return new Date(year, month, secondThursday);
}

/**
 * 공휴일이면 직전 영업일로 이동
 */
export function adjustForHoliday(date: Date, holidays: Set<string>): Date {
  const d = new Date(date);
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10);

  while (holidays.has(fmt(d)) || d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

/**
 * 향후 N개월의 선물옵션 만기일 생성
 */
export function generateExpiryDates(
  fromDate: Date,
  monthsAhead: number,
  holidays: Set<string>
): Array<{ date: string; type: EventType; title: string }> {
  const results: Array<{ date: string; type: EventType; title: string }> = [];
  const simultaneousMonths = new Set([2, 5, 8, 11]);

  for (let i = 0; i < monthsAhead; i++) {
    const targetDate = new Date(fromDate.getFullYear(), fromDate.getMonth() + i, 1);
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth();

    const secondThursday = getSecondThursday(year, month);
    const adjustedDate = adjustForHoliday(secondThursday, holidays);
    const dateStr = adjustedDate.toISOString().slice(0, 10);

    const isSimultaneous = simultaneousMonths.has(month);
    const monthLabel = `${month + 1}월`;

    if (isSimultaneous) {
      results.push({
        date: dateStr,
        type: 'simultaneous_expiry',
        title: `${monthLabel} 선물옵션 동시만기일`,
      });
    } else {
      results.push({
        date: dateStr,
        type: 'futures_expiry',
        title: `${monthLabel} 선물만기일`,
      });
    }
  }

  return results;
}

/**
 * Nager.Date API에서 공휴일 가져오기
 */
export async function fetchHolidays(
  year: number,
  countryCode: 'KR' | 'US'
): Promise<Array<{ date: string; name: string }>> {
  try {
    const res = await fetch(
      `https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`,
      { next: { revalidate: 86400 * 30 } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((h: { date: string; localName: string }) => ({
      date: h.date,
      name: h.localName,
    }));
  } catch {
    return [];
  }
}

/**
 * fallback 경제캘린더 로드
 */
export async function loadFallbackEconomicEvents(): Promise<
  Array<{ date: string; type: EventType; title: string; country: string }>
> {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const filePath = path.join(process.cwd(), '..', 'data', 'economic-calendar.json');
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

/**
 * FRED API에서 FOMC 일정 가져오기
 */
export async function fetchFOMCDates(year: number): Promise<string[]> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch(
      `https://api.stlouisfed.org/fred/release/dates?release_id=10&api_key=${apiKey}&file_type=json&include_release_dates_with_no_data=true&sort_order=asc`,
    );
    if (!res.ok) return [];
    const data = await res.json();
    const dates: string[] = (data.release_dates || [])
      .map((d: { date: string }) => d.date)
      .filter((d: string) => d.startsWith(String(year)));
    return dates;
  } catch {
    return [];
  }
}

/**
 * MarketEvent 행 빌드 헬퍼
 */
export function buildEventRow(
  date: string,
  eventType: EventType,
  title: string,
  source: 'rule_based' | 'nager_date' | 'fred_api' | 'manual',
  country: string = 'KR',
  description: string | null = null,
  metadata: Record<string, unknown> = {}
): Omit<MarketEvent, 'id' | 'created_at' | 'updated_at'> {
  const defaults = EVENT_RISK_DEFAULTS[eventType];
  return {
    event_date: date,
    event_type: eventType,
    event_category: defaults.category,
    title,
    description,
    country,
    impact_level: defaults.impact_level,
    risk_score: defaults.risk_score,
    source,
    metadata,
  };
}
