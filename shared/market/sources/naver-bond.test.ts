import { describe, it, expect } from 'vitest';
import { parseNaverBondQuote } from './naver-bond';

// 2026-08-20 실제 응답에서 발췌한 구조 (EUC-KR 디코딩 후)
const SAMPLE = `
	<tbody>
		<tr class="down">
		<td class="date">

		2026.08.19
		</td>
		<td class="num">3.79</td>
		<td class="num"><img src="https://ssl.pstatic.net/static/nfinance/ico_down.gif" width="7" height="6" alt="하락"> 0.05</td>
		<td class="num">
			-1.30%</td>
		</tr>

		<tr class="up">
		<td class="date">

		2026.08.18
		</td>
		<td class="num">3.84</td>
		<td class="num"><img src="https://ssl.pstatic.net/static/nfinance/ico_up.gif" width="7" height="6" alt="상승"> 0.05</td>
		<td class="num">
			 + 1.32%</td>
		</tr>
	</tbody>`;

describe('parseNaverBondQuote', () => {
  it('날짜와 수익률을 뽑고 전일 대비 열은 무시한다', () => {
    const points = parseNaverBondQuote(SAMPLE);
    expect(points).toEqual([
      { date: '2026-08-19', value: 3.79 },
      { date: '2026-08-18', value: 3.84 },
    ]);
  });

  it('행이 없으면 빈 배열을 반환한다', () => {
    expect(parseNaverBondQuote('<html><body>없음</body></html>')).toEqual([]);
  });

  it('숫자가 아닌 값이 든 행은 건너뛴다', () => {
    const broken = SAMPLE.replace('>3.79<', '>—<');
    const points = parseNaverBondQuote(broken);
    expect(points).toEqual([{ date: '2026-08-18', value: 3.84 }]);
  });
});
