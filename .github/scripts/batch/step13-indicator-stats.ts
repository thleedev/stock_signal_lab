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

/** 적재 결손 감지 시 관측치 하한을 "기대 영업일 수"의 이 비율로 잡는다. */
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
 * 적재 결손 감지 기준 — "데이터가 아직 짧은 것"과 "관측치가 비정상적으로
 * 적은 것"을 가른다.
 *
 * sample_days 가 200 미만이면 무조건 실패로 보면, 지표 적재가 시작된 지
 * 얼마 안 돼 as_of 시점 영업일 수가 아직 200에 못 미치는 정상 상태에서도
 * 이 배치가 매일 실패한다. 반대로 sample_days 가 짧을 때 로그만 남기면
 * GitHub Actions 로그 보존 기간이 지나는 순간 증거가 사라진다.
 *
 * 기준: firstObserved(이 지표의 최초 관측일) 부터 as_of 까지 지날 수 있는
 * 영업일 수(아래 함수, 과대추정)를 252일로 상한 씌운 뒤 그 80% 를 밑돌면
 * 실패로 본다. 적재가 갓 시작된 지표는 "지날 수 있는 영업일 수" 자체가
 * 작아 임계값도 함께 낮아지므로 초기 구간에서 오탐이 나지 않는다.
 *
 * **지표별 최초 관측일을 쓰는 이유(고정 COLLECTION_START 를 걷어낸 근거,
 * 최종 리뷰 C1)**. 이전 구현은 모든 지표가 같은 고정일(2026-04-06)에
 * 적재를 시작했다고 가정했다. 이 브랜치가 새로 도입한 KR_VOL_20D 나,
 * FRED_API_KEY 미설정 시 표본 0 에서 시작하는 HY_SPREAD·YIELD_CURVE 처럼
 * 실제 최초 관측일이 그보다 늦은 지표는 "경과 영업일"이 실제보다 훨씬 크게
 * 잡혀, 표본이 1건뿐인 첫날에도 하한이 76(2026-08-17 기준)에 근접해 거의
 * 영구히 실패로 잡힌다(상한 252 에 걸려서야 통과 — 약 9개월 후). 지표별
 * 최초 관측일을 쓰면 새 지표는 "관측치 1건, 경과 1영업일, 하한
 * floor(1×0.8)=0" 으로 자연히 통과하고, 기존 지표는 이전과 동일한 하한을
 * 받는다 — 하한이 지표마다 실제 적재 이력을 기준으로 움직이므로 결손
 * 감지 능력은 그대로 유지된다.
 *
 * firstObserved 는 별도 조회를 추가하지 않는다. 호출부(runStep13...)가
 * loadSeries() 로 이미 읽어 둔 series(date 내림차순)의 마지막 원소
 * (series[series.length-1].date, 즉 로드된 범위 안에서 가장 오래된 관측일)를
 * 그대로 쓴다. loadSeries() 의 since(400일 전, 호출부 참고) 창은 이 저장소의
 * 모든 지표(가장 오래된 것도 2026-04-06 개시, 400일에 한참 못 미침)를 넉넉히
 * 덮으므로 이 값은 사실상 진짜 최초 관측일과 같다. 지표가 400일보다 오래돼
 * since 경계에 걸리는 경우에도 businessDaysBetween(경계일, asOf) 는 이미
 * 252 를 넘겨 아래 Math.min 캡에 걸리므로 결과가 달라지지 않는다 — 즉 이
 * 근사는 어떤 경우에도 진짜 최초 관측일 기준과 같은 하한을 낸다. 지표별
 * 조회를 한 번 더 추가하지 않고 이미 로드한 데이터로 정확한 값을 얻으므로
 * 추가 DB 왕복 비용이 없다.
 *
 * 이 임계값이 잡는 것과 잡지 못하는 것을 분명히 해 둔다.
 *
 * 이 저장소가 겪은 "조용한 절단"(화면·크론의 원시 조회가 지표를 구분하지
 * 않고 한 번에 읽다 PostgREST max_rows(1000)에 걸려, 여러 지표가 그 상한을
 * 나눠 갖는 바람에 각 지표가 실제로는 70~90일 창만 받던 사고)은 이 임계값이
 * 막는 것이 아니다. 그 재발을 막는 것은 loadSeries() 가 지표별로
 * `indicator_type` 을 필터링해 각자 페이지네이션하는 구조 자체다 — 지표를
 * 섞지 않으므로 한 지표의 조회량이 다른 지표 때문에 잘리는 구조적 원인이
 * 애초에 없다.
 *
 * 이 임계값의 실제 역할은 그 특정 버그의 재발 감지가 아니라, 배치 중단이나
 * 소스 장애가 누적돼 특정 지표의 최근 관측치가 예상보다 훨씬 적게 쌓인
 * 일반적 적재 결손을 잡는 것이다. 80%·15~16일 마진은 그 목적에는 타당하나,
 * 기존 지표(2026-04-06 개시)의 임계값 76 은 옛 절단 버그가 냈던 70~90일
 * 구간과 겹친다 — 그 구간 안에서 새로 발생하는 절단이 있다면 이 임계값을
 * 그대로 통과하므로, 옛 버그와 같은 모양의 절단을 잡아내는 안전판으로 이
 * 임계값을 신뢰해서는 안 된다.
 */
function minExpectedSamples(firstObserved: string, asOf: string): number {
  const elapsed = businessDaysBetween(firstObserved, asOf);
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

  // FOREIGN_NET·INSTITUTION_NET(naver_investor 소스)는 market_indicators 가
  // 아니라 market_investor_daily 에 적재된다(step12-investor-daily 담당).
  // 여기서 조회하면 관측치 0건이 나오므로 대상에서 제외하고 오류로도
  // 취급하지 않는다 — step6-market-data.ts 가 같은 이유로 같은 소스를
  // 제외한 것과 동일한 근거다.
  const excludedKinds = new Set(['naver_investor']);
  const specs = activeIndicators().filter((s) => !excludedKinds.has(s.source.kind));

  for (const spec of specs) {
    try {
      const series = await loadSeries(spec.key, since);
      if (series.length === 0) {
        errors.push(`step13 ${spec.key}: 관측치 없음`);
        continue;
      }
      // date 내림차순이므로 [0] 이 최신값, [length-1] 이 이 창 안에서 가장
      // 오래된(=최초) 관측일이다 (파일 상단 정렬 규약 참고).
      const firstObserved = series[series.length - 1].date;
      const minExpected = minExpectedSamples(firstObserved, opts.date);
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
          `step13 ${spec.key}: 관측치 ${series.length}일 (기대 최소 ${minExpected}일, 최초 관측일 ${firstObserved} 기준 경과 영업일) — 적재 결손 또는 조회 절단 의심`,
        );
      } else if (series.length < 200) {
        // 기대치(minExpected) 이상이면 200일 미달이어도 "적재가 아직 짧을
        // 뿐인 정상 상태"이므로 실패로 담지 않고 로그만 남긴다.
        log(
          'step13',
          `${spec.key} 관측치 ${series.length}일 — 252일 창 미달(최초 관측일 ${firstObserved} 기준 정상, 기대 최소 ${minExpected}일 충족)`,
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
