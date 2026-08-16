// .github/scripts/batch/step13-indicator-stats.ts
//
// 지표별 롤링 통계 선계산.
//
// 화면과 크론이 252일 분위수·52주 고점·200일 이평을 매 요청 원시 행으로
// 계산하는데, PostgREST 기본 max_rows(1000)에 잘려 실제로는 약 70~90 영업일
// 창으로 산출됩니다. 절단이 오류가 아니라 짧은 배열로 나타나 길이 가드를
// 통과하므로 조용히 틀린 값이 나옵니다. 이 step 이 배치에서 미리 계산해
// market_indicator_stats 에 저장해 두면 조회가 가벼워지고 창 길이가 정확해집니다.
//
// 정렬 규약: 이 파일의 loadSeries() 는 date 내림차순(최신 → 과거)으로 읽어
// values[0] 을 최신값으로 씁니다. shared/market/derive.ts 는 반대로 오름차순
// (과거 → 최신) 배열을 받는 규약이며, 두 규약이 섞이면 조용한 오답으로
// 이어집니다(직전 태스크에서 ma200Diff 가 이 문제로 결함이 잡힌 이력이
// 있습니다 — .superpowers/sdd/2026-08-17-market-pipeline-phase1/progress.md
// Ruling R6). 이 파일은 derive.ts 의 함수를 쓰지 않고 max/min/mean/stddev/
// pctRank 를 자체 계산하므로 어느 정렬이든 결과값 자체는 같지만, 다음
// 사람이 derive.ts 함수를 이 파일에 가져다 쓰려 하면 배열을 오름차순으로
// 뒤집어야 한다는 뜻이라 규약을 여기 명시해 둡니다.
import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';
import { activeIndicators } from '../../../shared/market/catalog.js';
import { mean, stddev, pctRank } from '../../../shared/market/stats.js';

const PAGE = 1000;

/**
 * 지표 하나의 최근 값을 페이지네이션으로 전부 읽는다.
 *
 * date 내림차순(최신 → 과거)으로 정렬해 반환한다 — values[0] 이 최신값이다.
 * (derive.ts 의 오름차순 규약과 다르다. 파일 상단 주석 참고.)
 *
 * 종료 조건: range(from, from+PAGE-1) 을 data.length < PAGE 에서 멈춘다.
 * 총 행 수가 PAGE 의 정확한 배수(예: 정확히 1000행)면 마지막 정상 페이지도
 * 길이가 PAGE 와 같아 이 조건을 만족하지 못해 한 번 더 조회하지만, 그
 * 조회는 이미 소진된 구간(offset == 총 행 수)이라 PostgREST 가 빈 배열을
 * 반환하고 `data.length === 0` 분기에서 종료한다. 존재하지 않는 범위를
 * 요청해도 PostgREST 는 오류가 아니라 빈 배열을 주므로(offset 이 count 를
 * 넘어도 200 OK + []) 무한 루프 가능성은 없다 — 정확한 배수일 때 조회가
 * 한 번 더 도는 비용만 있을 뿐이다.
 */
async function loadSeries(key: string, since: string): Promise<{ date: string; value: number }[]> {
  const out: { date: string; value: number }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('market_indicators')
      .select('date, value')
      .eq('indicator_type', key)
      .gte('date', since)
      .order('date', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${key} 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const v = Number(row.value);
      if (Number.isFinite(v)) out.push({ date: row.date as string, value: v });
    }
    if (data.length < PAGE) break;
  }
  return out;
}

/** 지표 적재가 실제로 시작된 날짜. market_indicators 최초 관측일이 이 날짜다. */
const COLLECTION_START = '2026-04-06';

/** 절단 감지 시 관측치 하한을 "기대 영업일 수"의 이 비율로 잡는다. */
const MIN_SAMPLE_RATIO = 0.8;

/** 이 배치가 실제로 쓰는 최대 창(252일 분위수) 이상은 기대치를 더 올리지 않는다. */
const MAX_EXPECTED_DAYS = 252;

/**
 * from~to(포함) 사이 월~금 일수. 공휴일은 반영하지 않아 실제 개장일보다
 * 다소 크게 나온다 — 아래 minExpectedSamples() 의 하한을 보수적으로(낮게)
 * 잡는 용도라 과대추정이 곧 오탐(false positive) 축소로 작용한다.
 */
function businessDaysBetween(fromISO: string, toISO: string): number {
  const from = new Date(`${fromISO}T00:00:00Z`).getTime();
  const to = new Date(`${toISO}T00:00:00Z`).getTime();
  let count = 0;
  for (let t = from; t <= to; t += 86400000) {
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

/**
 * 절단 감지 기준 — "데이터가 아직 짧은 것"과 "조회가 잘린 것"을 가른다.
 *
 * sample_days 가 200 미만이면 무조건 실패로 보면, 지표 적재가
 * COLLECTION_START(2026-04-06)에 시작돼 as_of 시점 영업일 수가 아직 200에
 * 못 미치는 정상 상태(2026-08-17 기준 약 96 영업일, 즉 "100 영업일 안팎")
 * 에서도 이 배치가 매일 실패한다. 반대로 sample_days 가 짧을 때 로그만
 * 남기면 GitHub Actions 로그 보존 기간이 지나는 순간 증거가 사라져, 이
 * 저장소가 겪은 "조용한 절단"(화면·크론의 원시 조회가 PostgREST
 * max_rows(1000)에 잘려 70~90일 창으로 산출되었으나 오류 없이 짧은 배열만
 * 나오던 사고)을 다시 못 잡는다.
 *
 * 기준: COLLECTION_START 부터 as_of 까지 지날 수 있는 영업일 수(위 함수,
 * 과대추정)를 252일로 상한 씌운 뒤 그 80% 를 밑돌면 실패로 본다. 적재가
 * 갓 시작된 지표는 "지날 수 있는 영업일 수" 자체가 작아 임계값도 함께
 * 낮아지므로 초기 구간에서 오탐이 나지 않고, 적재가 쌓여 기대치가 올라간
 * 지표에서 실제 관측치가 그 80% 밑으로 떨어지면 적재 결손이나 조회 절단일
 * 가능성이 크다고 본다. 80% 라는 비율 자체는 임의 값이나, 이미 알려진
 * 절단 결과(기대 창의 약 30~50%인 70~90일)와는 확실히 구분되는 여유를
 * 두려는 목적이다.
 */
function minExpectedSamples(asOf: string): number {
  const elapsed = businessDaysBetween(COLLECTION_START, asOf);
  const expected = Math.min(elapsed, MAX_EXPECTED_DAYS);
  return Math.floor(expected * MIN_SAMPLE_RATIO);
}

interface StatsRow {
  indicator_key: string;
  as_of: string;
  high_52w: number;
  low_52w: number;
  ma_200d: number | null;
  ma_20d: number | null;
  pct_rank_252d: number | null;
  stddev_20d: number | null;
  sample_days: number;
  updated_at: string;
}

export async function runStep13IndicatorStats(
  opts: { date: string },
): Promise<{ errors: string[]; collected: number }> {
  log('step13', '지표 롤링 통계 계산 시작');
  const errors: string[] = [];
  const since = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  const rows: StatsRow[] = [];
  const minExpected = minExpectedSamples(opts.date);

  // FOREIGN_NET·INSTITUTION_NET(naver_investor 소스)는 market_indicators 가
  // 아니라 market_investor_daily 에 적재된다(step12-investor-daily 담당).
  // 여기서 조회하면 관측치 0건이 나오므로 대상에서 제외하고 오류로도
  // 취급하지 않는다 — step6-market-data.ts 가 같은 이유로 같은 소스를
  // 제외한 것과 동일한 근거다. ecos(KR_3Y)는 카탈로그에서 이미
  // enabled:false 라 activeIndicators() 에 안 잡히지만 방어적으로 함께
  // 제외해 둔다(카탈로그가 나중에 바뀌어 활성화되어도 안전하도록).
  const excludedKinds = new Set(['naver_investor', 'ecos']);
  const specs = activeIndicators().filter((s) => !excludedKinds.has(s.source.kind));

  for (const spec of specs) {
    try {
      const series = await loadSeries(spec.key, since);
      if (series.length === 0) {
        errors.push(`step13 ${spec.key}: 관측치 없음`);
        continue;
      }
      // date 내림차순이므로 [0] 이 최신값이다 (파일 상단 정렬 규약 참고).
      const values = series.map((s) => s.value);
      const current = values[0];
      const window252 = values.slice(0, 252);
      const window200 = values.slice(0, 200);
      const window20 = values.slice(0, 20);

      rows.push({
        indicator_key: spec.key,
        as_of: opts.date,
        high_52w: Math.max(...window252),
        low_52w: Math.min(...window252),
        ma_200d: window200.length >= 50 ? mean(window200) : null,
        ma_20d: window20.length >= 10 ? mean(window20) : null,
        pct_rank_252d: window252.length >= 30 ? pctRank(current, window252) : null,
        stddev_20d: window20.length >= 10 ? stddev(window20) : null,
        sample_days: series.length,
        updated_at: new Date().toISOString(),
      });

      if (series.length < minExpected) {
        // 데이터가 아직 짧은 것이 아니라(경과 영업일 대비 기대치 이하이므로),
        // 적재 결손이나 조회 절단일 가능성이 커 배치 실패로 드러낸다.
        errors.push(
          `step13 ${spec.key}: 관측치 ${series.length}일 (기대 최소 ${minExpected}일, 경과 영업일 기준) — 적재 결손 또는 조회 절단 의심`,
        );
      } else if (series.length < 200) {
        // 기대치(minExpected) 이상이면 200일 미달이어도 "적재가 아직 짧을
        // 뿐인 정상 상태"이므로 실패로 담지 않고 로그만 남긴다.
        log(
          'step13',
          `${spec.key} 관측치 ${series.length}일 — 252일 창 미달(적재 개시 이후 경과일 기준 정상, 기대 최소 ${minExpected}일 충족)`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`step13 ${spec.key}: ${msg}`);
    }
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from('market_indicator_stats')
      .upsert(rows, { onConflict: 'indicator_key,as_of' });
    if (error) {
      errors.push(`step13 upsert: ${error.message}`);
    }
  }

  log('step13', `완료: ${rows.length}개 지표 통계 갱신`);
  return { errors, collected: rows.length };
}
