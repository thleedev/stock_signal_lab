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

export function formatDateLabel(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  const date = new Date(dateStr + "T00:00:00+09:00");
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
  return `${parseInt(m)}/${parseInt(d)}(${weekday})`;
}
