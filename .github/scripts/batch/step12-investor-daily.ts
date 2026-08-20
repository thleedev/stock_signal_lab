// .github/scripts/batch/step12-investor-daily.ts
//
// 코스피 전체 일별 투자자 순매수 수집 (단위: 억원).
//
// 기존 step2-investor-data 는 종목별 최근 5영업일 스냅숏을 stock_cache 에
// 덮어써 일별 이력이 남지 않습니다. 시황 판정과 백테스트에는 지수 전체의
// 일별 시계열이 필요하므로 별도 테이블 market_investor_daily 에 적재합니다.
//
// 파싱·수집 로직은 shared/market/sources/naver-investor.ts 에 있습니다.
// 이 step 은 그것을 호출해 DB 적재와 오류 보고만 담당합니다 —
// shared/market/ 은 배치(ESM)와 웹(번들러)이 함께 읽는 자족 모듈이라
// vitest 로 고정 문자열 테스트를 붙일 수 있는 위치가 그쪽뿐입니다.
//
// 네이버 investorDealTrendDay 는 bizdate 파라미터로 과거 소급을 허용하며
// 호출당 최근 10영업일을 반환합니다. bizdate 에 휴장일을 넣어도 직전
// 거래일부터 채워 줍니다.
import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';
import { fetchInvestorDaily } from '../../../shared/market/sources/naver-investor.js';

/**
 * KST(UTC+9) 기준 오늘 날짜(YYYYMMDD).
 * .github/scripts/batch/step11-lassi-signals.ts 의 kstToday() 와 같은 관용구입니다.
 */
function kstTodayCompact(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '');
}

export async function runStep12InvestorDaily(
  opts: { days?: number } = {},
): Promise<{ errors: string[]; collected: number }> {
  const days = opts.days ?? 10;
  log('step12', `코스피 일별 수급 수집 시작 (최근 ${days}영업일)`);
  const errors: string[] = [];

  const bizdate = kstTodayCompact();

  let rows;
  try {
    rows = await fetchInvestorDaily(bizdate);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`step12 investorDealTrendDay(bizdate=${bizdate}): ${msg}`);
    log('step12', `수집 실패: ${msg}`);
    return { errors, collected: 0 };
  }

  const collectedAt = new Date().toISOString();
  const payload = rows.slice(0, days).map((r) => ({
    date: r.date,
    individual_net: r.individual_net,
    foreign_net: r.foreign_net,
    institution_net: r.institution_net,
    collected_at: collectedAt,
  }));

  const { error } = await supabase
    .from('market_investor_daily')
    .upsert(payload, { onConflict: 'date' });
  if (error) {
    errors.push(`step12 market_investor_daily upsert (${payload.length}건): ${error.message}`);
    log('step12', `upsert 오류: ${error.message}`);
    return { errors, collected: 0 };
  }

  log('step12', `완료: ${payload.length}일치 수급 적재`);
  return { errors, collected: payload.length };
}
