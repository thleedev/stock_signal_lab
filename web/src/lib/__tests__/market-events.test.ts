import { describe, it, expect } from 'vitest';
import { parseFomcCalendar } from '../market-events';

// federalreserve.gov/monetarypolicy/fomccalendars.htm 2026-08-20 실측 구조 발췌
const SAMPLE = `
<div class="panel-heading"><h4>2026 FOMC Meetings</h4></div>
<div class="row fomc-meeting">
  <div class="fomc-meeting__month col-xs-5"><strong>January</strong></div>
  <div class="fomc-meeting__date col-xs-4">27-28</div>
</div>
<div class="fomc-meeting--shaded row fomc-meeting">
  <div class="fomc-meeting__month col-xs-5"><strong>March</strong></div>
  <div class="fomc-meeting__date col-xs-4">17-18*</div>
</div>
<div class="panel-heading"><h4>2025 FOMC Meetings</h4></div>
<div class="row fomc-meeting">
  <div class="fomc-meeting__month col-xs-5"><strong>April/May</strong></div>
  <div class="fomc-meeting__date col-xs-4">30-1</div>
</div>
<div class="row fomc-meeting">
  <div class="fomc-meeting__month col-xs-5"><strong>August</strong></div>
  <div class="fomc-meeting__date col-xs-4">22 (notation vote)</div>
</div>`;

describe('parseFomcCalendar', () => {
  it('회의 종료일(발표일)을 연도별로 뽑는다', () => {
    const dates = parseFomcCalendar(SAMPLE);
    expect(dates).toContain('2026-01-28');
    // "*"(기자회견 표시)는 무시하고 날짜만 읽는다
    expect(dates).toContain('2026-03-18');
  });

  it('월 경계를 걸치는 회의(April/May 30-1)는 두 번째 달로 판정한다', () => {
    expect(parseFomcCalendar(SAMPLE)).toContain('2025-05-01');
  });

  it('단일일 항목(notation vote)도 그 날짜로 읽는다', () => {
    expect(parseFomcCalendar(SAMPLE)).toContain('2025-08-22');
  });

  it('빈 HTML 이면 빈 배열을 반환한다', () => {
    expect(parseFomcCalendar('<html></html>')).toEqual([]);
  });
});
