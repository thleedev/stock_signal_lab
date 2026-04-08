/** ISO 타임스탬프를 "N분 전", "N시간 전" 등 상대 시간으로 변환 */
export function formatTimeAgo(isoTime: string): string {
  const diff = Date.now() - new Date(isoTime).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '방금';
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}

export function getLastNWeekdays(n: number): string[] {
  const days: string[] = [];
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  let d = new Date(kst);
  while (days.length < n) {
    const dateStr = d.toISOString().slice(0, 10);
    // dateStr 자체가 KST 날짜이므로 UTC 자정으로 요일 판정 (+09:00 사용 시 UTC 날짜가 하루 밀림)
    const day = new Date(dateStr + 'T00:00:00Z').getUTCDay();
    if (day !== 0 && day !== 6) days.push(dateStr);
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

/** KST 최근 N일 범위 반환 (오늘 포함) */
export function getLastNDaysRange(n: number): { start: string; end: string } {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const from = new Date(kst.getTime() - (n - 1) * 86400000);
  return {
    start: `${from.toISOString().slice(0, 10)}T00:00:00+09:00`,
    end: `${kst.toISOString().slice(0, 10)}T23:59:59+09:00`,
  };
}

/** KST 이번주(월~오늘) 범위 반환 */
export function getKstWeekRange(): { start: string; end: string } {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getDay(); // 0=일, 1=월, ..., 6=토
  const daysFromMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(kst.getTime() - daysFromMonday * 86400000);
  return {
    start: `${monday.toISOString().slice(0, 10)}T00:00:00+09:00`,
    end: `${kst.toISOString().slice(0, 10)}T23:59:59+09:00`,
  };
}

export function formatDateLabel(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  const date = new Date(dateStr + "T00:00:00+09:00");
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
  return `${parseInt(m)}/${parseInt(d)}(${weekday})`;
}
