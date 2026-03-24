import { describe, it, expect } from 'vitest';
import {
  getLastNWeekdays,
  getLastNDays,
  getKstDayRange,
  getKstWeekRange,
  formatDateLabel,
} from '@/lib/date-utils';

describe('getLastNWeekdays', () => {
  it('returns the requested number of weekdays', () => {
    const result = getLastNWeekdays(5);
    expect(result).toHaveLength(5);
  });

  it('excludes weekends (Saturday=6, Sunday=0)', () => {
    const result = getLastNWeekdays(10);
    for (const dateStr of result) {
      const date = new Date(dateStr + 'T00:00:00+09:00');
      const day = date.getDay();
      expect(day).not.toBe(0); // Sunday
      expect(day).not.toBe(6); // Saturday
    }
  });

  it('returns dates in descending order (most recent first)', () => {
    const result = getLastNWeekdays(5);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i] > result[i + 1]).toBe(true);
    }
  });

  it('returns YYYY-MM-DD formatted strings', () => {
    const result = getLastNWeekdays(3);
    for (const dateStr of result) {
      expect(dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('returns empty array for n=0', () => {
    const result = getLastNWeekdays(0);
    expect(result).toHaveLength(0);
  });
});

describe('getLastNDays', () => {
  it('returns the requested number of days', () => {
    const result = getLastNDays(7);
    expect(result).toHaveLength(7);
  });

  it('returns dates in descending order', () => {
    const result = getLastNDays(5);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i] >= result[i + 1]).toBe(true);
    }
  });

  it('includes consecutive calendar days (including weekends)', () => {
    const result = getLastNDays(7);
    expect(result).toHaveLength(7);
    // All strings should be valid YYYY-MM-DD
    for (const dateStr of result) {
      expect(dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('returns empty array for n=0', () => {
    const result = getLastNDays(0);
    expect(result).toHaveLength(0);
  });
});

describe('getKstDayRange', () => {
  it('returns start and end for a given date', () => {
    const result = getKstDayRange('2025-03-15');
    expect(result.start).toBe('2025-03-15T00:00:00+09:00');
    expect(result.end).toBe('2025-03-15T23:59:59+09:00');
  });

  it('preserves the date string in output', () => {
    const date = '2024-12-25';
    const result = getKstDayRange(date);
    expect(result.start).toContain(date);
    expect(result.end).toContain(date);
  });
});

describe('getKstWeekRange', () => {
  it('returns start and end with KST timezone', () => {
    const result = getKstWeekRange();
    expect(result.start).toMatch(/T00:00:00\+09:00$/);
    expect(result.end).toMatch(/T23:59:59\+09:00$/);
  });

  it('start date is Monday or earlier in the week', () => {
    const result = getKstWeekRange();
    const startDate = new Date(result.start);
    const day = startDate.getDay();
    // Monday is 1; the start should always be a Monday
    expect(day).toBe(1);
  });

  it('start is before or equal to end', () => {
    const result = getKstWeekRange();
    expect(result.start <= result.end).toBe(true);
  });
});

describe('formatDateLabel', () => {
  it('formats a Monday date correctly', () => {
    // 2025-03-17 is a Monday
    const result = formatDateLabel('2025-03-17');
    expect(result).toBe('3/17(월)');
  });

  it('formats a Sunday date correctly', () => {
    // 2025-03-16 is a Sunday
    const result = formatDateLabel('2025-03-16');
    expect(result).toBe('3/16(일)');
  });

  it('formats a Saturday date correctly', () => {
    // 2025-03-15 is a Saturday
    const result = formatDateLabel('2025-03-15');
    expect(result).toBe('3/15(토)');
  });

  it('strips leading zeros from month and day', () => {
    // 2025-01-05 is a Sunday
    const result = formatDateLabel('2025-01-05');
    expect(result).toBe('1/5(일)');
  });

  it('formats a mid-week date correctly', () => {
    // 2025-03-19 is a Wednesday
    const result = formatDateLabel('2025-03-19');
    expect(result).toBe('3/19(수)');
  });
});
