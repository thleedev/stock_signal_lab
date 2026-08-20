/**
 * 금융투자협회 FreeSIS 신용공여 잔고 추이 — CREDIT_BALANCE.
 *
 * 2026-08-20 Playwright 로 실제 화면 요청을 캡처해 확보한 스펙이다.
 * POST /meta/getMetaDataList.do 에 JSON 을 보내면 무키·무세션으로 응답한다
 * (curl 재현 확인). tmpV45/46 은 YYYYMMDD 조회 구간, tmpV1 "D"=일간,
 * tmpV40 "1000000"=백만원 단위, OBJ_NM 이 화면 serviceId+BO 다.
 * 2015-01-02 부터 전 구간이 한 요청으로 반환된다(실측 2,865행).
 *
 * 응답 ds1 필드 (화면 컬럼 대조):
 *   TMPV1 일자, TMPV2 신용거래융자 전체(백만원), TMPV3 유가, TMPV4 코스닥,
 *   TMPV5~7 신용거래대주, TMPV8 청약자금대출, TMPV9 예탁증권 담보융자.
 * 지표값은 TMPV2(신용거래융자 전체)를 억원으로 환산해(/100) 쓴다 —
 * 카탈로그 저장 단위 won_100m 과 맞춘다.
 */

export interface CreditPoint {
  date: string;
  /** 신용거래융자 전체, 억원 */
  value: number;
}

interface FreesisRow {
  TMPV1: string;
  TMPV2: number;
}

export function parseCreditResponse(json: unknown): CreditPoint[] {
  const rows = (json as { ds1?: FreesisRow[] } | null)?.ds1;
  if (!Array.isArray(rows)) return [];
  const out: CreditPoint[] = [];
  for (const r of rows) {
    if (typeof r?.TMPV1 !== 'string' || r.TMPV1.length !== 8) continue;
    if (typeof r.TMPV2 !== 'number' || !Number.isFinite(r.TMPV2)) continue;
    out.push({
      date: `${r.TMPV1.slice(0, 4)}-${r.TMPV1.slice(4, 6)}-${r.TMPV1.slice(6, 8)}`,
      value: r.TMPV2 / 100,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchCreditBalance(fromDate: string, toDate: string): Promise<CreditPoint[]> {
  const res = await fetch('https://freesis.kofia.or.kr/meta/getMetaDataList.do', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: 'https://freesis.kofia.or.kr/stat/FreeSIS.do',
      'User-Agent': 'Mozilla/5.0',
    },
    body: JSON.stringify({
      dmSearch: {
        tmpV40: '1000000',
        tmpV41: '1',
        tmpV1: 'D',
        tmpV45: fromDate.replace(/-/g, ''),
        tmpV46: toDate.replace(/-/g, ''),
        OBJ_NM: 'STATSCU0100000070BO',
      },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`FreeSIS 신용잔고 HTTP ${res.status}`);
  const points = parseCreditResponse(await res.json());
  // 0건은 차단·스펙 변경이 화면에서 빈 데이터로 위장하는 경로다 — 예외로 드러낸다.
  if (points.length === 0) throw new Error('FreeSIS 신용잔고 파싱 0건');
  return points;
}
