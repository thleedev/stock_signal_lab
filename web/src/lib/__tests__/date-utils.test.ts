import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  formatTimeAgo,
  getLastNWeekdays,
  getLastNDays,
  getKstDayRange,
  getLastNDaysRange,
  getKstWeekRange,
  formatDateLabel,
} from '@/lib/date-utils';

/**
 * ┌─ 이 파일은 여러 타임존에서 돌려야 의미가 있습니다 ─────────────────────────┐
 *
 * date-utils 에는 실행 머신 타임존에 좌우되던 회귀가 두 건 있었습니다.
 *
 *   R1. formatDateLabel — 구버전: `new Date(dateStr + 'T00:00:00+09:00').getDay()`
 *       KST 자정은 UTC 기준 전날 15:00 이므로 로컬 오프셋이 +09:00 미만인 머신에서
 *       요일이 하루 밀립니다.
 *       검출 O: TZ=UTC, TZ=America/Los_Angeles
 *       검출 X: TZ=Asia/Seoul  ← KST 머신에서는 구·신 구현 결과가 완전히 같습니다.
 *
 *   R2. getKstWeekRange — 구버전: `kst.getDay()` (kst = now + 9h)
 *       kst 는 UTC 필드로 읽어야 KST 시각인데 getDay 가 로컬 오프셋을 한 번 더
 *       적용해 요일이 어긋납니다.
 *       검출 O: TZ=Asia/Seoul, TZ=America/Los_Angeles
 *       검출 X: TZ=UTC  ← UTC 에서는 getDay() === getUTCDay() 입니다.
 *
 * 즉 **단일 타임존 실행으로는 두 회귀를 모두 잡을 수 없습니다.**
 * `npm test` 는 vitest.config.ts 가 고정한 TZ=UTC 로만 돌므로 R2 를 놓칩니다.
 * 반드시 `npm run test:tz` (UTC / Asia/Seoul / America/Los_Angeles 3회) 로 검증하십시오.
 *
 * 아래 테스트의 기대값은 전부 달력에서 확인한 **리터럴 상수**입니다.
 * 구현과 같은 방식(UTC 자정 파싱 + getUTCDay)으로 기대값을 계산하는 헬퍼를 다시
 * 도입하면 자기참조가 되어 구버전 구현도 그대로 통과합니다. 절대 되돌리지 마십시오.
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/** 달력에서 확인한 요일 상수표 — 계산이 아니라 리터럴입니다. */
const WEEKDAY: Record<string, string> = {
  '2024-02-29': '목', // 윤일
  '2025-01-05': '일',
  '2025-03-15': '토',
  '2025-03-16': '일',
  '2025-03-17': '월',
  '2025-03-18': '화',
  '2025-03-19': '수',
  '2025-03-20': '목',
  '2025-03-21': '금',
  '2025-03-22': '토',
  '2025-12-31': '수', // 연말
};

/**
 * 구현과 독립적인 요일 판정 오라클.
 * 구현은 `+9h 산술 보정 + getUTCDay` 를 쓰지만, 여기서는 Intl 의 IANA 타임존
 * 데이터베이스로 Asia/Seoul 요일을 직접 읽습니다. 계산 경로가 겹치지 않으므로
 * 자기참조가 아닙니다. 고정 시각을 쓸 수 없는 "현재 시각" 테스트에만 씁니다.
 */
const EN_TO_KO: Record<string, string> = {
  Sun: '일',
  Mon: '월',
  Tue: '화',
  Wed: '수',
  Thu: '목',
  Fri: '금',
  Sat: '토',
};

function kstWeekdayViaIntl(kstDate: string): string {
  const en = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    weekday: 'short',
  }).format(new Date(`${kstDate}T12:00:00+09:00`));
  return EN_TO_KO[en];
}

/** 'YYYY-MM-DDT00:00:00+09:00' 형태 범위 문자열에서 날짜 부분만 잘라냅니다. */
function datePartOf(rangeStr: string): string {
  return rangeStr.slice(0, 10);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('getLastNWeekdays', () => {
  // 회귀 감시 대상 아님 (구현이 이미 toISOString 기반이라 타임존 독립적).
  // 다만 기대값은 리터럴로 고정해 두어야 이후 리팩터링 때 주말 판정이 깨지는 것을 잡습니다.
  it('returns the requested number of weekdays', () => {
    expect(getLastNWeekdays(5)).toHaveLength(5);
  });

  it('excludes weekends over a fixed two-week window', () => {
    // 2025-03-24T07:00:00Z = KST 월 16:00. 3/22(토)·3/23(일)·3/15(토)·3/16(일) 이 빠져야 합니다.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-24T07:00:00Z'));
    expect(getLastNWeekdays(10)).toEqual([
      '2025-03-24',
      '2025-03-21',
      '2025-03-20',
      '2025-03-19',
      '2025-03-18',
      '2025-03-17',
      '2025-03-14',
      '2025-03-13',
      '2025-03-12',
      '2025-03-11',
    ]);
  });

  it('returns dates in descending order (most recent first)', () => {
    const result = getLastNWeekdays(5);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i] > result[i + 1]).toBe(true);
    }
  });

  it('returns YYYY-MM-DD formatted strings', () => {
    for (const dateStr of getLastNWeekdays(3)) {
      expect(dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('returns empty array for n=0', () => {
    expect(getLastNWeekdays(0)).toHaveLength(0);
  });

  it('skips the weekend when run on a KST Saturday afternoon', () => {
    // 2025-03-22T07:00:00Z = KST 토 16:00
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-22T07:00:00Z'));
    expect(getLastNWeekdays(3)).toEqual(['2025-03-21', '2025-03-20', '2025-03-19']);
  });
});

describe('getLastNDays', () => {
  it('returns the requested number of days', () => {
    expect(getLastNDays(7)).toHaveLength(7);
  });

  it('returns dates in descending order', () => {
    const result = getLastNDays(5);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i] >= result[i + 1]).toBe(true);
    }
  });

  it('returns consecutive calendar days including the weekend', () => {
    // 2025-03-18T07:00:00Z = KST 화 16:00 — 주말(3/15, 3/16)도 그대로 포함되어야 합니다.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-18T07:00:00Z'));
    expect(getLastNDays(7)).toEqual([
      '2025-03-18',
      '2025-03-17',
      '2025-03-16',
      '2025-03-15',
      '2025-03-14',
      '2025-03-13',
      '2025-03-12',
    ]);
  });

  it('returns empty array for n=0', () => {
    expect(getLastNDays(0)).toHaveLength(0);
  });

  it('uses the KST calendar date just after KST midnight', () => {
    // 2025-03-17T15:30:00Z = KST 2025-03-18 00:30 (UTC 기준으로는 아직 3/17)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-17T15:30:00Z'));
    expect(getLastNDays(3)).toEqual(['2025-03-18', '2025-03-17', '2025-03-16']);
  });
});

describe('getKstDayRange', () => {
  it('returns start and end for a given date', () => {
    const result = getKstDayRange('2025-03-15');
    expect(result.start).toBe('2025-03-15T00:00:00+09:00');
    expect(result.end).toBe('2025-03-15T23:59:59+09:00');
  });

  it('preserves the date string in output', () => {
    const result = getKstDayRange('2024-12-25');
    expect(result.start).toBe('2024-12-25T00:00:00+09:00');
    expect(result.end).toBe('2024-12-25T23:59:59+09:00');
  });
});

describe('getLastNDaysRange', () => {
  it('spans n KST days inclusive of today', () => {
    // 2025-03-18T07:00:00Z = KST 화 16:00
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-18T07:00:00Z'));
    const result = getLastNDaysRange(7);
    expect(result.start).toBe('2025-03-12T00:00:00+09:00');
    expect(result.end).toBe('2025-03-18T23:59:59+09:00');
  });

  it('rolls over to the next KST date after KST midnight', () => {
    // 2025-03-17T15:30:00Z = KST 2025-03-18 00:30
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-17T15:30:00Z'));
    const result = getLastNDaysRange(1);
    expect(result.start).toBe('2025-03-18T00:00:00+09:00');
    expect(result.end).toBe('2025-03-18T23:59:59+09:00');
  });
});

describe('getKstWeekRange', () => {
  // ▼ R2 회귀 감시 블록 ▼
  // 구버전은 `kst.getDay()` 로 요일을 판정해 로컬 오프셋을 이중 적용했습니다.
  // 검출 O: TZ=Asia/Seoul, TZ=America/Los_Angeles / 검출 X: TZ=UTC.
  // `npm test`(TZ=UTC) 만으로는 절대 잡히지 않으므로 `npm run test:tz` 가 필요합니다.
  it('returns start and end with KST timezone', () => {
    const result = getKstWeekRange();
    expect(result.start).toMatch(/T00:00:00\+09:00$/);
    expect(result.end).toMatch(/T23:59:59\+09:00$/);
  });

  it('start date is always a Monday in KST', () => {
    // 현재 시각 기준이라 리터럴을 쓸 수 없으므로 Intl 오라클로 판정합니다 (구현과 계산 경로가 다름).
    const result = getKstWeekRange();
    expect(kstWeekdayViaIntl(datePartOf(result.start))).toBe('월');
  });

  it('start is before or equal to end', () => {
    const result = getKstWeekRange();
    expect(result.start <= result.end).toBe(true);
  });

  /**
   * 고정 시각 케이스 — 기대값은 전부 리터럴입니다.
   * catchesIn 은 "구버전 구현을 되돌렸을 때 실제로 실패하는 타임존"이며,
   * 3개 타임존 실행이 왜 필요한지에 대한 근거이기도 합니다. 케이스를 지우지 마십시오.
   */
  const weekCases: Array<{
    label: string;
    now: string;
    monday: string;
    today: string;
    catchesIn: string;
  }> = [
    {
      label: 'KST 화 16:00',
      now: '2025-03-18T07:00:00Z',
      monday: '2025-03-17',
      today: '2025-03-18',
      catchesIn: 'Asia/Seoul',
    },
    {
      label: 'KST 화 11:00',
      now: '2025-03-18T02:00:00Z',
      monday: '2025-03-17',
      today: '2025-03-18',
      catchesIn: '없음(정상 동작 확인용)',
    },
    {
      label: 'KST 월 00:10',
      now: '2025-03-16T15:10:00Z',
      monday: '2025-03-17',
      today: '2025-03-17',
      catchesIn: 'America/Los_Angeles',
    },
    {
      label: 'KST 토 15:00',
      now: '2025-03-22T06:00:00Z',
      monday: '2025-03-17',
      today: '2025-03-22',
      catchesIn: 'Asia/Seoul, America/Los_Angeles',
    },
    {
      label: 'KST 일 23:30',
      now: '2025-03-23T14:30:00Z',
      monday: '2025-03-17',
      today: '2025-03-23',
      catchesIn: 'Asia/Seoul',
    },
  ];

  for (const { label, now, monday, today, catchesIn } of weekCases) {
    it(`starts on Monday at ${label} (구버전 검출: ${catchesIn})`, () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(now));
      const result = getKstWeekRange();
      expect(result.start).toBe(`${monday}T00:00:00+09:00`);
      expect(result.end).toBe(`${today}T23:59:59+09:00`);
      expect(WEEKDAY[monday]).toBe('월'); // 상수표 자체의 오타 방지
    });
  }
});

describe('formatDateLabel', () => {
  // ▼ R1 회귀 감시 블록 ▼
  // 구버전은 `new Date(dateStr + 'T00:00:00+09:00').getDay()` 로 로컬 요일을 읽었습니다.
  // 검출 O: TZ=UTC, TZ=America/Los_Angeles / 검출 X: TZ=Asia/Seoul.
  // 개발 머신이 KST 이므로 로컬에서 `npm test` 만 돌리면 이 회귀는 영원히 보이지 않습니다.
  it('formats a Monday date correctly', () => {
    expect(formatDateLabel('2025-03-17')).toBe('3/17(월)');
  });

  it('formats a Sunday date correctly', () => {
    expect(formatDateLabel('2025-03-16')).toBe('3/16(일)');
  });

  it('formats a Saturday date correctly', () => {
    expect(formatDateLabel('2025-03-15')).toBe('3/15(토)');
  });

  it('strips leading zeros from month and day', () => {
    expect(formatDateLabel('2025-01-05')).toBe('1/5(일)');
  });

  it('formats a mid-week date correctly', () => {
    expect(formatDateLabel('2025-03-19')).toBe('3/19(수)');
  });

  it('formats a leap day correctly', () => {
    expect(formatDateLabel('2024-02-29')).toBe('2/29(목)');
  });

  it('formats a year-end date correctly', () => {
    expect(formatDateLabel('2025-12-31')).toBe('12/31(수)');
  });

  it('maps a full consecutive week to 일~토 in order', () => {
    const labels = [
      '2025-03-16',
      '2025-03-17',
      '2025-03-18',
      '2025-03-19',
      '2025-03-20',
      '2025-03-21',
      '2025-03-22',
    ].map((d) => formatDateLabel(d));
    expect(labels).toEqual([
      '3/16(일)',
      '3/17(월)',
      '3/18(화)',
      '3/19(수)',
      '3/20(목)',
      '3/21(금)',
      '3/22(토)',
    ]);
  });

  it('matches the hardcoded calendar table for every sampled date', () => {
    // 기대값은 상수표 리터럴입니다. 구현과 같은 식으로 계산해서는 안 됩니다.
    for (const [dateStr, weekday] of Object.entries(WEEKDAY)) {
      expect(formatDateLabel(dateStr)).toBe(
        `${parseInt(dateStr.slice(5, 7), 10)}/${parseInt(dateStr.slice(8, 10), 10)}(${weekday})`
      );
    }
  });
});

describe('formatTimeAgo', () => {
  // 절대 시각 차이만 다루므로 타임존과 무관합니다 (3개 타임존 모두 동일 결과).
  it('formats elapsed time from an absolute instant', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-18T07:00:00Z'));
    expect(formatTimeAgo('2025-03-18T06:59:30Z')).toBe('방금');
    expect(formatTimeAgo('2025-03-18T06:30:00Z')).toBe('30분 전');
    expect(formatTimeAgo('2025-03-18T04:00:00Z')).toBe('3시간 전');
    expect(formatTimeAgo('2025-03-16T07:00:00Z')).toBe('2일 전');
  });

  it('accepts KST-offset timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-18T07:00:00Z'));
    // 2025-03-18T15:30:00+09:00 = 2025-03-18T06:30:00Z
    expect(formatTimeAgo('2025-03-18T15:30:00+09:00')).toBe('30분 전');
  });
});
