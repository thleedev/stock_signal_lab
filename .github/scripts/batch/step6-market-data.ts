// .github/scripts/batch/step6-market-data.ts
//
// 시황 지표 수집. 지표 정의는 shared/market/catalog.ts 가 단일 출처이며
// 이 파일은 소스 종류별 수집만 담당합니다.
//
// 기존 구현은 date/indicator_type/value 세 컬럼만 upsert 해 prev_value 와
// change_pct 가 서비스 시작 이래 NULL 이었습니다. 두 컬럼을 계산하던 코드는
// web/scripts/fetch-market-indicators.ts 에 있었으나 호출자가 없었습니다.
import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';
import { activeIndicators, type IndicatorSpec } from '../../../shared/market/catalog.js';
import { fetchFredSeries, latestOf } from '../../../shared/market/sources/fred.js';
import { fetchYahooDaily, fetchNaverIndexDaily } from '../../../shared/market/sources/quotes.js';
import { changePct, realizedVol20d } from '../../../shared/market/derive.js';

interface IndicatorRow {
  date: string;
  indicator_type: string;
  value: number;
  prev_value: number | null;
  change_pct: number | null;
  source: string;
  collected_at: string;
}

/** 수집 결과: 최근 두 관측치와 출처 */
interface Collected {
  date: string;
  value: number;
  prev: number | null;
  source: string;
  /** 실현변동성 계산에 쓸 종가 시계열 (KOSPI 만 채운다) */
  series?: number[];
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

async function collectOne(spec: IndicatorSpec, source = spec.source): Promise<Collected> {
  const to = new Date().toISOString().slice(0, 10);

  if (source.kind === 'fred') {
    const points = await fetchFredSeries(source.seriesId, daysAgo(40), to);
    points.sort((a, b) => a.date.localeCompare(b.date));
    const last = latestOf(points);
    if (!last) throw new Error(`${spec.key}: FRED 관측치 없음`);
    const prev = points.length >= 2 ? points[points.length - 2].value : null;
    return { date: last.date, value: last.value, prev, source: 'fred' };
  }

  if (source.kind === 'yahoo') {
    const points = await fetchYahooDaily(source.ticker, daysAgo(400), to);
    points.sort((a, b) => a.date.localeCompare(b.date));
    const last = points[points.length - 1];
    const prev = points.length >= 2 ? points[points.length - 2].close : null;
    return {
      date: last.date,
      value: last.close,
      prev,
      source: 'yahoo',
      series: points.map((p) => p.close),
    };
  }

  if (source.kind === 'naver_index') {
    const points = await fetchNaverIndexDaily(source.symbol, daysAgo(400), to);
    points.sort((a, b) => a.date.localeCompare(b.date));
    const last = points[points.length - 1];
    const prev = points.length >= 2 ? points[points.length - 2].close : null;
    return {
      date: last.date,
      value: last.close,
      prev,
      source: 'naver',
      series: points.map((p) => p.close),
    };
  }

  throw new Error(`${spec.key}: 이 step 이 다루지 않는 소스 ${source.kind}`);
}

export async function runStep6MarketData(): Promise<{ errors: string[]; collected: number }> {
  log('step6', '시황 지표 수집 시작');
  const errors: string[] = [];
  const rows: IndicatorRow[] = [];
  const collectedAt = new Date().toISOString();
  const seriesByKey: Record<string, number[]> = {};

  // 파생 지표(derived)는 원본 수집 후 계산하므로 뒤로 미룬다.
  // naver_investor(FOREIGN_NET, INSTITUTION_NET)는 market_indicators 대상이 아니다 —
  // 수급은 별도 테이블 market_investor_daily 에 step12-investor-daily 가 일별로 적재하고,
  // 화면 조회 시점에 최근 5행을 합산해 판정한다. 이 step 이 다루지 않으므로 수집도,
  // 실패 취급도 하지 않는다.
  // ecos(KR_3Y)는 인증키 미발급으로 카탈로그에서 이미 enabled:false 라
  // activeIndicators() 에 안 잡히지만, 카탈로그 변경에 대비해 방어적으로 함께 제외한다.
  const excludedKinds = new Set(['derived', 'naver_investor', 'ecos']);
  const specs = activeIndicators().filter((s) => !excludedKinds.has(s.source.kind));
  const derivedSpecs = activeIndicators().filter((s) => s.source.kind === 'derived');

  const settled = await Promise.allSettled(
    specs.map(async (spec) => {
      try {
        return { spec, got: await collectOne(spec) };
      } catch (primaryErr) {
        if (!spec.fallback) throw primaryErr;
        log('step6', `${spec.key} 주 소스 실패, 폴백 시도: ${(primaryErr as Error).message}`);
        const got = await collectOne(spec, spec.fallback);
        return { spec, got };
      }
    }),
  );

  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === 'rejected') {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      errors.push(`step6 ${specs[i].key}: ${msg}`);
      log('step6', `${specs[i].key} 수집 실패: ${msg}`);
      continue;
    }
    const { spec, got } = r.value;
    if (got.series) seriesByKey[spec.key] = got.series;
    rows.push({
      date: got.date,
      indicator_type: spec.key,
      value: got.value,
      prev_value: got.prev,
      change_pct: changePct(got.value, got.prev),
      source: got.source,
      collected_at: collectedAt,
    });
  }

  // 파생 지표
  for (const spec of derivedSpecs) {
    if (spec.source.kind !== 'derived') continue;
    // spec.source.from 을 지역 변수로 분리한다. 클로저 안에서는 위 타입
    // 좁히기가 전파되지 않아 spec.source.from 을 직접 참조하면 tsc 가
    // SourceSpec 유니온 전체를 대상으로 검사해 컴파일 오류가 난다.
    const fromKey = spec.source.from;
    const series = seriesByKey[fromKey];
    if (!series) {
      errors.push(`step6 ${spec.key}: 원본 ${fromKey} 시계열 없음`);
      continue;
    }
    if (spec.key === 'KR_VOL_20D') {
      const value = realizedVol20d(series);
      if (value === null) {
        errors.push(`step6 ${spec.key}: 실현변동성 계산 불가 (종가 ${series.length}건)`);
        continue;
      }
      const prevValue = realizedVol20d(series.slice(0, -1));
      const baseRow = rows.find((r) => r.indicator_type === fromKey);
      rows.push({
        date: baseRow?.date ?? new Date().toISOString().slice(0, 10),
        indicator_type: spec.key,
        value,
        prev_value: prevValue,
        change_pct: changePct(value, prevValue),
        source: 'derived',
        collected_at: collectedAt,
      });
    }
  }

  log('step6', `수집 ${rows.length}건 / 실패 ${errors.length}건`);

  if (rows.length > 0) {
    const { error } = await supabase
      .from('market_indicators')
      .upsert(rows, { onConflict: 'date,indicator_type' });
    if (error) {
      errors.push(`step6 upsert: ${error.message}`);
      log('step6', `upsert 오류: ${error.message}`);
    }
  }

  // 이 step 이 실제로 다루는 지표의 절반 미만만 모이면 파이프라인 이상으로 본다.
  // 분모를 activeIndicators().length 그대로 쓰면 naver_investor 두 종이 항상
  // 빠지면서 분모만 부풀어 상시 오탐이 나므로, specs·derivedSpecs 합계로 삼는다.
  const target = specs.length + derivedSpecs.length;
  if (rows.length * 2 < target) {
    errors.push(`step6: 대상 지표 ${target}개 중 ${rows.length}개만 수집됨`);
  }

  log('step6', `완료: ${rows.length}개 지표 갱신`);
  return { errors, collected: rows.length };
}
