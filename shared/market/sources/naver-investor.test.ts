import { describe, it, expect } from 'vitest';
import { parseInvestorHtml, toNum } from './naver-investor';

// 2026-08-17 curl -s --max-time 20 -H "User-Agent: Mozilla/5.0"
//   "https://finance.naver.com/sise/investorDealTrendDay.naver?bizdate=20260814"
//   | iconv -f EUC-KR -t UTF-8
// 로 받은 실제 응답의 대표 구간(헤더 2행 + 데이터 2행)을 그대로 옮겼다.
// 브리프 예시가 아니라 실측 원문이며, 클래스명(type_1/date2)과 2자리 연도
// 표기(26.08.14)를 포함해 마크업을 손대지 않았다.
const SAMPLE = `
<table summary="일자별 순매수에 관한 표 입니다." cellpadding="0" cellspacing="0" class="type_1">
<caption>일자별 순매수</caption>
	<tr class="udline">
		<th rowspan="2" class="noln">날짜</th>
		<th rowspan="2">개인</th>
		<th rowspan="2">외국인</th>
		<th rowspan="2">기관계</th>
		<th colspan="6" class="eb">기관</th>
		<th rowspan="2">기타법인</th>
	</tr>
	<tr class="udline">
		<th class="sub">금융투자</th>
		<th class="sub">보험</th>
		<th class="sub">투신<br>(사모)</th>
		<th class="sub">은행</th>
		<th class="sub">기타금융기관</th>
		<th class="sub">연기금등</th>
	</tr>
	<tr>
		<td colspan="11" class="blank_07"></td>
	</tr>
	<tr>
		<td class="date2">26.08.14</td>
		<td class="rate_down3">-19,820</td>
		<td class="rate_up3">30,387</td>
		<td class="rate_down3">-10,298</td>
		<td class="rate_down3">-11,634</td>
		<td class="rate_down3">-142</td>
		<td class="rate_up3">1,011</td>
		<td class="rate_down3">-115</td>
		<td class="rate_up3">192</td>
		<td class="rate_up3">391</td>
		<td class="rate_down3">-269</td>
	</tr>
	<tr>
		<td class="date2">26.08.13</td>
		<td class="rate_down3">-27,410</td>
		<td class="rate_up3">21,102</td>
		<td class="rate_up3">6,834</td>
		<td class="rate_up3">20</td>
		<td class="rate_down3">-76</td>
		<td class="rate_up3">7,385</td>
		<td class="rate_down3">-21</td>
		<td class="rate_up3">166</td>
		<td class="rate_down3">-641</td>
		<td class="rate_down3">-526</td>
	</tr>
</table>
`;

describe('네이버 수급 HTML 파싱', () => {
  it('날짜와 개인·외국인·기관계 세 값을 파싱한다', () => {
    const rows = parseInvestorHtml(SAMPLE);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      date: '2026-08-14',
      individual_net: -19820,
      foreign_net: 30387,
      institution_net: -10298,
    });
  });

  it('개인·외국인·기관계 열이 뒤바뀌지 않고 올바르게 매핑된다', () => {
    // 실측 행에서 세 값은 서로 다른 숫자이므로 열이 바뀌면 이 검증이 깨진다.
    // 열 순서 확정 근거는 SAMPLE 상단 헤더 행(<th>날짜/개인/외국인/기관계/...)과
    // 데이터 행(<td>)의 위치 대응이다 — n 번째 헤더와 n 번째 셀은 같은 열이므로
    // parseInvestorHtml 이 잡는 4~6번째 <td>가 각각 개인·외국인·기관계다.
    // (개인+외국인+기관계+기타법인)=0 항등식은 덧셈 교환법칙 때문에 세 열이
    // 순환 치환돼도 성립해 열 순서를 확정하지 못하므로 이 근거로 쓰지 않는다.
    const rows = parseInvestorHtml(SAMPLE);
    const [d0814, d0813] = rows;
    expect(d0814.individual_net).toBe(-19820);
    expect(d0814.foreign_net).toBe(30387);
    expect(d0814.institution_net).toBe(-10298);
    expect(d0813.individual_net).toBe(-27410);
    expect(d0813.foreign_net).toBe(21102);
    expect(d0813.institution_net).toBe(6834);
  });

  it('2자리 연도 날짜를 YYYY-MM-DD 로 복원한다', () => {
    const rows = parseInvestorHtml(SAMPLE);
    expect(rows[1].date).toBe('2026-08-13');
  });

  it('쉼표 섞인 음수·양수 숫자를 정확히 변환한다', () => {
    const rows = parseInvestorHtml(SAMPLE);
    // -19,820 → -19820 (음수+쉼표), 30,387 → 30387 (양수+쉼표)
    expect(rows[0].individual_net).toBe(-19820);
    expect(rows[0].foreign_net).toBe(30387);
  });

  it('헤더 행(th)을 데이터로 잘못 잡지 않는다', () => {
    // SAMPLE 에는 "날짜/개인/외국인/기관계" 헤더 행 2개가 앞에 있으나
    // <th> 이고 class="date2" 가 아니므로 매칭되지 않아야 한다.
    const rows = parseInvestorHtml(SAMPLE);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date))).toBe(true);
  });

  it('빈 문자열에서 빈 배열을 낸다', () => {
    expect(parseInvestorHtml('')).toEqual([]);
  });

  it('차단 응답(마크업이 다른 오류 페이지)에서 빈 배열을 낸다', () => {
    // 이번 조사에서는 네이버가 실제로 차단 응답을 준 사례를 재현하지 못했다.
    // date2 앵커가 없는 페이지는 어떤 형태든 파싱 대상이 아니므로 이 케이스로
    // 대표한다.
    expect(parseInvestorHtml('<html><body>일시적인 오류입니다.</body></html>')).toEqual([]);
  });
});

describe('toNum 부호 변환', () => {
  // 2026-08-17 실측 응답은 ASCII 하이픈만 썼다. 아래 두 케이스는 실측에서
  // 나오지 않은 방어 분기(&minus;·유니코드 마이너스)를 직접 검증한다.
  it('HTML 엔티티 &minus; 를 음수로 변환한다', () => {
    expect(toNum('&minus;19,820')).toBe(-19820);
  });

  it('유니코드 마이너스(U+2212)를 음수로 변환한다', () => {
    expect(toNum('−19,820')).toBe(-19820);
  });

  it('ASCII 하이픈과 쉼표가 섞인 값을 변환한다', () => {
    expect(toNum('-19,820')).toBe(-19820);
    expect(toNum('30,387')).toBe(30387);
  });

  it('숫자로 변환할 수 없으면 null 을 낸다', () => {
    expect(toNum('-')).toBeNull();
    expect(toNum('N/A')).toBeNull();
  });
});
