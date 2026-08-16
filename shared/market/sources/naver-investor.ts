/**
 * 코스피 전체 일별 투자자 순매수 수집 — 네이버 investorDealTrendDay.
 *
 * https://finance.naver.com/sise/investorDealTrendDay.naver?bizdate=YYYYMMDD
 *
 * 이 파일은 다른 파일을 import 하지 않습니다 (배치·웹 공유 제약).
 *
 * 2026-08-17 bizdate=20260814 실측 확인 결과, 계획 브리프의 가정과 실제 마크업이
 * 다음 세 가지 지점에서 어긋났습니다.
 *
 * 1. 클래스명이 `tb_status2` 가 아니라 `type_1` 이며, 데이터 행을 식별할 앵커는
 *    날짜 셀의 `class="date2"` 입니다.
 * 2. 날짜가 4자리 연도(`2026.08.14`)가 아니라 2자리 연도(`26.08.14`)로 옵니다.
 *    앞에 "20"을 붙여 복원합니다.
 * 3. 열 순서는 브리프 가정과 같습니다 — 날짜, 개인, 외국인, 기관계 순이고
 *    이어서 기관 세부 6열(금융투자·보험·투신·은행·기타금융기관·연기금등)과
 *    기타법인 1열이 더 옵니다. 실측 행(2026-08-04)에서
 *    개인(8,187) + 외국인(-3,716) + 기관계(-5,385) + 기타법인(914) = 0 이 되는 것으로
 *    개인·외국인·기관계 순서를 확인했습니다. 카탈로그가 쓰지 않는 기관 세부·기타법인
 *    열은 파싱하지 않습니다.
 *
 * 페이지 상단에 "(단위:억원)" 이 명시되어 있어 shared/market/catalog.ts 의
 * FOREIGN_NET·INSTITUTION_NET 저장 단위(won_100m, 억원)와 일치합니다. 값을
 * 변환하지 않고 소스가 주는 그대로 저장합니다.
 *
 * bizdate 에 휴장일(주말·공휴일)을 넣어도 오류 없이 직전 거래일부터 10영업일을
 * 채워 줍니다 (bizdate=20260816 일요일로 실측 확인, 26.08.14 금요일부터 반환).
 */

export interface InvestorRow {
  date: string;
  individual_net: number;
  foreign_net: number;
  institution_net: number;
}

/** 숫자 문자열을 억원 단위 숫자로. 쉼표와 부호를 처리한다. */
function toNum(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, '').replace(/&minus;|−/g, '-');
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : null;
}

/**
 * 네이버 응답 HTML 에서 일자별 순매수를 뽑는다.
 *
 * 날짜 셀(`<td class="date2">26.08.14</td>`)을 앵커로 삼아 바로 뒤이은
 * 개인·외국인·기관계 3개 `<td>` 값만 읽는다. 헤더 행은 `<th>` 태그이고
 * `date2` 클래스를 갖지 않으므로 이 정규식에 걸리지 않는다.
 */
export function parseInvestorHtml(html: string): InvestorRow[] {
  const out: InvestorRow[] = [];
  const rowRe =
    /<td class="date2">(\d{2})\.(\d{2})\.(\d{2})<\/td>\s*<td[^>]*>([-\d,]+)<\/td>\s*<td[^>]*>([-\d,]+)<\/td>\s*<td[^>]*>([-\d,]+)<\/td>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const date = `20${m[1]}-${m[2]}-${m[3]}`;
    const individual = toNum(m[4]);
    const foreign = toNum(m[5]);
    const institution = toNum(m[6]);
    if (individual === null || foreign === null || institution === null) continue;
    out.push({
      date,
      individual_net: individual,
      foreign_net: foreign,
      institution_net: institution,
    });
  }
  return out;
}

/**
 * bizdate(YYYYMMDD) 기준 최근 10영업일 수급을 가져온다.
 *
 * 파싱 결과가 0건이면 차단이나 마크업 변경으로 조용히 데이터가 끊긴 것일 수
 * 있으므로 예외를 던진다 — 0건을 정상 완료로 삼키면 이 저장소에 이미 있었던
 * "크롤러가 차단과 정상 파싱 0건을 구분하지 못해 멈춘" 사고가 반복된다.
 */
export async function fetchInvestorDaily(bizdate: string): Promise<InvestorRow[]> {
  const url = `https://finance.naver.com/sise/investorDealTrendDay.naver?bizdate=${bizdate}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://finance.naver.com/' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`네이버 수급 HTTP ${res.status} (bizdate=${bizdate})`);
  const buf = await res.arrayBuffer();
  const html = new TextDecoder('euc-kr').decode(buf);
  const rows = parseInvestorHtml(html);
  if (rows.length === 0) throw new Error(`네이버 수급 파싱 0건 (bizdate=${bizdate})`);
  return rows;
}
