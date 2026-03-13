export function getLastNWeekdays(n: number): string[] {
  const days: string[] = [];
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  let d = new Date(kst);
  while (days.length < n) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) days.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() - 86400000);
  }
  return days;
}

export function getLastNDays(n: number): string[] {
  const days: string[] = [];
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  for (let i = 0; i < n; i++) {
    const d = new Date(kst.getTime() - i * 86400000);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/** KST 하루 범위 반환 — Supabase timestamptz 쿼리용 */
export function getKstDayRange(date: string): { start: string; end: string } {
  return {
    start: `${date}T00:00:00+09:00`,
    end: `${date}T23:59:59+09:00`,
  };
}

export function formatDateLabel(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  const date = new Date(dateStr + "T00:00:00+09:00");
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
  return `${parseInt(m)}/${parseInt(d)}(${weekday})`;
}
