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
 * fallback 경제캘린더 로드 (정적 번들 - Vercel/Next.js 호환)
 */
export async function loadFallbackEconomicEvents(): Promise<
  Array<{ date: string; type: EventType; title: string; country: string }>
> {
  try {
    const mod = await import('@/data/economic-calendar.json');
    const data = (mod.default ?? mod) as Array<{ date: string; type: EventType; title: string; country: string }>;
    return data;
  } catch {
    return [];
  }
}

const MONTH_INDEX: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/**
 * 연준 FOMC 캘린더 HTML 에서 회의 종료일(금리 발표일)을 뽑는다.
 *
 * 이전 구현은 FRED release_id=10 을 FOMC 로 조회했는데, 그 릴리스는
 * Consumer Price Index 다(2026-08-20 실측, /fred/release 응답 name 필드).
 * FOMC 일정의 정본은 federalreserve.gov/monetarypolicy/fomccalendars.htm
 * 이고 무키로 열린다.
 *
 * 구조(2026-08-20 실측): "YYYY FOMC Meetings" 패널 아래 회의마다
 *   <div class="fomc-meeting__month ..."><strong>April/May</strong></div>
 *   <div class="fomc-meeting__date ...">28-29*</div>
 * 월은 "January" 또는 월 경계를 걸치면 "April/May", 일은 "27-28" 형태이고
 * "*"(기자회견)나 "(unscheduled)" 주석이 붙을 수 있다. 발표는 회의
 * 마지막 날이므로 범위의 끝 일을 쓰고, 끝 일이 시작 일보다 작으면
 * (예: April/May 의 "30-1") 두 번째 달로 넘어간 것이다.
 */
export function parseFomcCalendar(html: string): string[] {
  const out: string[] = [];
  // 연도 패널 단위로 자른다 — 회의 행 자체에는 연도가 없다.
  const sections = html.split(/(\d{4}) FOMC/).slice(1);
  for (let i = 0; i + 1 < sections.length; i += 2) {
    const year = Number(sections[i]);
    const body = sections[i + 1];
    const meetingRe =
      /fomc-meeting__month[^>]*>\s*(?:<strong>)?\s*([A-Za-z]+)(?:\/([A-Za-z]+))?[\s\S]*?fomc-meeting__date[^>]*>\s*(?:<strong>)?\s*(\d{1,2})(?:-(\d{1,2}))?/g;
    let m: RegExpExecArray | null;
    while ((m = meetingRe.exec(body)) !== null) {
      const firstMonth = MONTH_INDEX[m[1].toLowerCase()];
      const secondMonth = m[2] ? MONTH_INDEX[m[2].toLowerCase()] : undefined;
      if (!firstMonth) continue;
      const startDay = Number(m[3]);
      const endDay = m[4] ? Number(m[4]) : startDay;
      const month = secondMonth != null && endDay < startDay ? secondMonth : firstMonth;
      out.push(
        `${year}-${String(month).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`,
      );
    }
  }
  return out.sort();
}

/**
 * 연준 캘린더 페이지에서 해당 연도 FOMC 발표일 가져오기 (무키)
 */
export async function fetchFOMCDates(year: number): Promise<string[]> {
  try {
    const res = await fetch('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', {
      next: { revalidate: 86400 * 7 },
    });
    if (!res.ok) return [];
    const html = await res.text();
    return parseFomcCalendar(html).filter((d) => d.startsWith(String(year)));
  } catch {
    return [];
  }
}

/**
 * FRED release/dates 에서 경제지표 발표 예정일 가져오기.
 * release_id 10 = Consumer Price Index, 50 = Employment Situation
 * (2026-08-20 /fred/release 실측). include_release_dates_with_no_data=true
 * 가 있어야 아직 데이터가 없는 미래 발표일이 포함된다. FRED_API_KEY 가
 * 없으면 빈 배열 — 정적 폴백(economic-calendar.json)만 남는다.
 */
export async function fetchReleaseDates(releaseId: number, year: number): Promise<string[]> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch(
      `https://api.stlouisfed.org/fred/release/dates?release_id=${releaseId}&api_key=${apiKey}&file_type=json&include_release_dates_with_no_data=true&sort_order=desc&limit=60`,
    );
    if (!res.ok) return [];
    const data = await res.json();
    return ((data.release_dates || []) as { date: string }[])
      .map((d) => d.date)
      .filter((d) => d.startsWith(String(year)))
      .sort();
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
  source: 'rule_based' | 'nager_date' | 'fred_api' | 'fed_web' | 'manual',
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
