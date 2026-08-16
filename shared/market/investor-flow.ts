/**
 * 외국인·기관 5일 누적 순매수(수급) 합산 규칙.
 *
 * market_investor_daily 는 날짜별 원시 적재이고, 카탈로그(shared/market/
 * catalog.ts) 의 FOREIGN_NET/INSTITUTION_NET 임계값은 5일 누적 기준으로
 * 잡혀 있다. Supabase 조회는 호출부(웹 web/src/app/market/page.tsx, 배치
 * web/src/app/api/v1/cron/market-score/route.ts)가 각자 한다 — 이 폴더는
 * Supabase 클라이언트를 import 할 수 없는 자족 모듈 제약이 있다. 대신
 * "합산·판정 가능 여부" 규칙만 이 파일 하나로 공유해 두 경로가 서로 다른
 * 계산을 하지 않게 한다.
 *
 * 실제로 이 규칙이 카탈로그 전환 이전에는 화면(page.tsx)에만 있었고
 * 크론에는 아예 없었다. RISK_THRESHOLDS 가 하드코딩이던 시절에는 두
 * 지표가 판정 대상이 아니어서 이 누락이 드러나지 않았지만, 카탈로그
 * 전환으로 두 지표(가중치 3+2)가 판정에 들어오면서 화면과 크론이 같은
 * 날 다른 위험 지수를 내는 결함으로 나타났다.
 *
 * 이 파일은 다른 파일을 import 하지 않는다(shared/market/ 공통 제약 —
 * 배치·웹 양쪽에서 모듈 해석 규칙이 달라서다).
 */

export interface InvestorDailyRow {
  date: string;
  foreign_net: number | null;
  institution_net: number | null;
}

export interface InvestorFlow5d {
  /** 합산에 쓰인 최신 행의 날짜(가장 최근 거래일) */
  date: string;
  foreignNet: number;
  institutionNet: number;
}

/**
 * rows 는 date 내림차순(최신이 [0])이어야 한다.
 *
 * 5행 미만이면 null 을 반환해 판정 대상에서 제외한다 — 3일치만으로 5일
 * 누적 임계값과 비교하면 위험을 과소평가하기 때문이다. 5행을 초과해
 * 넘어와도 최신 5행만 합산한다(호출부가 limit 을 걸지 않고 더 많이
 * 넘기더라도 규칙이 흔들리지 않도록).
 */
export function sumInvestorFlow5d(rows: InvestorDailyRow[]): InvestorFlow5d | null {
  if (rows.length < 5) return null;
  const window = rows.slice(0, 5);
  return {
    date: window[0].date,
    foreignNet: window.reduce((sum, r) => sum + Number(r.foreign_net ?? 0), 0),
    institutionNet: window.reduce((sum, r) => sum + Number(r.institution_net ?? 0), 0),
  };
}
