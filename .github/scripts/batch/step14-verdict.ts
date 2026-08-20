// .github/scripts/batch/step14-verdict.ts
//
// 위험 판정 계산·저장 (설계 §4.3, 단계 2).
//
// step6(지표)·step12(수급)·step13(통계)이 적재한 당일 데이터를 읽어
// shared/market/verdict.ts 의 calculateVerdict 를 실행하고, 결과를
// market_verdict 에 (date, kind) 로 upsert 한다. kind 는 배치 모드에서
// 온다 — market-open=open, market-intraday=intraday, market-close=close.
// 화면(단계 3)은 이 행을 읽기만 하고 재계산하지 않는다.
//
// 결손 처리: status=insufficient 도 그대로 저장한다. 저장을 건너뛰면
// "판정이 없는 날"과 "판정 불가로 확정된 날"이 구분되지 않는다.
import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';
import { activeIndicators } from '../../../shared/market/catalog.js';
import { calculateVerdict } from '../../../shared/market/verdict.js';
import type { VerdictStats } from '../../../shared/market/verdict.js';

export type VerdictKind = 'open' | 'intraday' | 'close';

function kstNow(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

export async function runStep14Verdict(opts: { kind: VerdictKind }): Promise<{ errors: string[] }> {
  log('step14', `위험 판정 계산 (kind=${opts.kind})`);
  const errors: string[] = [];
  const today = kstNow().toISOString().slice(0, 10);

  try {
    const specs = activeIndicators();
    const maxLookback = Math.max(...specs.map((s) => s.maxStaleDays));
    const since = new Date(kstNow().getTime() - maxLookback * 86400000).toISOString().slice(0, 10);

    // 지표 값 — 지표별 최신 행. 허용 지연(maxStaleDays)을 넘긴 값은 결손 처리.
    const { data: indRows, error: indErr } = await supabase
      .from('market_indicators')
      .select('indicator_type, date, value')
      .gte('date', since)
      .order('date', { ascending: false });
    if (indErr) throw new Error(`지표 조회 실패: ${indErr.message}`);

    const values: Record<string, number | null> = {};
    for (const spec of specs) {
      const row = (indRows ?? []).find((r) => r.indicator_type === spec.key);
      if (!row) { values[spec.key] = null; continue; }
      const staleDays = (Date.parse(today) - Date.parse(row.date as string)) / 86400000;
      values[spec.key] = staleDays <= spec.maxStaleDays ? Number(row.value) : null;
    }

    // 수급 5일 누적 — market_investor_daily 최근 5행 (지연 5일 이내일 때만)
    const { data: invRows, error: invErr } = await supabase
      .from('market_investor_daily')
      .select('date, foreign_net, institution_net')
      .order('date', { ascending: false })
      .limit(5);
    if (invErr) throw new Error(`수급 조회 실패: ${invErr.message}`);
    if (invRows && invRows.length === 5
      && (Date.parse(today) - Date.parse(invRows[0].date as string)) / 86400000 <= 5) {
      values.FOREIGN_NET = invRows.reduce((s, r) => s + Number(r.foreign_net), 0);
      values.INSTITUTION_NET = invRows.reduce((s, r) => s + Number(r.institution_net), 0);
    } else {
      values.FOREIGN_NET = null;
      values.INSTITUTION_NET = null;
    }

    // 롤링 통계 — 지표별 최신 as_of 행
    const { data: statRows, error: statErr } = await supabase
      .from('market_indicator_stats')
      .select('indicator_key, as_of, high_52w, ma_200d, pct_rank_252d, sample_days')
      .gte('as_of', since)
      .order('as_of', { ascending: false });
    if (statErr) throw new Error(`통계 조회 실패: ${statErr.message}`);
    const stats: Record<string, VerdictStats | undefined> = {};
    for (const spec of specs) {
      const row = (statRows ?? []).find((r) => r.indicator_key === spec.key);
      if (!row) continue;
      stats[spec.key] = {
        high_52w: row.high_52w == null ? null : Number(row.high_52w),
        ma_200d: row.ma_200d == null ? null : Number(row.ma_200d),
        pct_rank_252d: row.pct_rank_252d == null ? null : Number(row.pct_rank_252d),
        sample_days: Number(row.sample_days),
      };
    }

    const asOf = new Date().toISOString();
    const v = calculateVerdict(values, stats, asOf);

    const { error: upErr } = await supabase.from('market_verdict').upsert(
      {
        date: today,
        kind: opts.kind,
        status: v.status,
        score: v.status === 'ok' ? v.score : null,
        action: v.status === 'ok' ? v.action : null,
        coverage: v.coverage,
        contributions: v.status === 'ok' ? v.contributions : null,
        missing: v.missing,
        as_of: asOf,
      },
      { onConflict: 'date,kind' },
    );
    if (upErr) throw new Error(`판정 저장 실패: ${upErr.message}`);

    if (v.status === 'ok') {
      log('step14', `판정 저장: ${today}/${opts.kind} score=${v.score} action=${v.action} coverage=${v.coverage.toFixed(3)}`);
    } else {
      log('step14', `판정 저장: ${today}/${opts.kind} 산출 불가 coverage=${v.coverage.toFixed(3)} 결측=${v.missing.join(',')}`);
    }
  } catch (e) {
    errors.push(`step14: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { errors };
}
