/**
 * 백테스트 엔진 — 지표 히스토리에서 일자별 위험 점수 시계열을 만들고
 * 하락 국면 정답지 대비 적중률·선행일수·오경보율을 계산합니다 (설계 §8.2).
 *
 * 데이터 적재(DB 조회)는 하지 않습니다 — 순수 계산만 담당하고,
 * scripts/backtest-market.ts 러너가 데이터를 넣습니다.
 */

import { calculateVerdict, defaultParams } from '../verdict.js';
import type { VerdictParams, VerdictStats } from '../verdict.js';
import { realizedVol20d } from '../derive.js';
import { pctRank } from '../stats.js';
import type { DrawdownRegime } from './regimes.js';

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface InvestorDay {
  date: string;
  foreign_net: number;
  institution_net: number;
}

export interface BacktestInput {
  /** 지표 키 → 오름차순 일별 시계열. KOSPI 는 필수(거래일 달력 겸용) */
  series: Record<string, SeriesPoint[]>;
  investor: InvestorDay[];
  /** 지표 키 → 허용 지연(달력일). LOCF 가 이 이상 오래된 값은 결측 처리 */
  maxStaleDays: Record<string, number>;
}

export interface DailyScore {
  date: string;
  score: number | null; // null = insufficient
  coverage: number;
}

/** KOSPI 거래일마다 판정을 실행해 점수 시계열을 만든다 */
export function buildScoreSeries(
  input: BacktestInput,
  params: VerdictParams = defaultParams(),
): DailyScore[] {
  const kospi = input.series.KOSPI;
  if (!kospi || kospi.length === 0) throw new Error('KOSPI 시계열이 필요합니다');

  // 지표별 커서 — 거래일을 오름차순으로 훑으므로 매일 앞으로만 이동한다
  const keys = Object.keys(params.indicators).filter((k) => k !== 'KR_VOL_20D'
    && k !== 'FOREIGN_NET' && k !== 'INSTITUTION_NET');
  const cursors: Record<string, number> = Object.fromEntries(keys.map((k) => [k, -1]));
  const investorCursor = { i: -1 };
  const kospiCloses: number[] = [];

  const out: DailyScore[] = [];

  for (let d = 0; d < kospi.length; d++) {
    const today = kospi[d].date;
    kospiCloses.push(kospi[d].value);

    const values: Record<string, number | null> = {};
    const stats: Record<string, VerdictStats | undefined> = {};

    for (const key of keys) {
      const series = input.series[key];
      if (!series || series.length === 0) {
        values[key] = null;
        continue;
      }
      let c = cursors[key];
      while (c + 1 < series.length && series[c + 1].date <= today) c++;
      cursors[key] = c;
      if (c < 0) {
        values[key] = null;
        continue;
      }
      const last = series[c];
      const staleDays =
        (Date.parse(today) - Date.parse(last.date)) / 86400000;
      const maxStale = Math.max(input.maxStaleDays[key] ?? 5, 5);
      if (staleDays > maxStale) {
        values[key] = null;
        continue;
      }
      values[key] = last.value;

      // 롤링 통계 — 시계열의 최근 252관측(오늘 포함) 창
      const from = Math.max(0, c - 251);
      const window: number[] = [];
      for (let i = from; i <= c; i++) window.push(series[i].value);
      const ma200win = window.slice(-200);
      stats[key] = {
        high_52w: Math.max(...window),
        ma_200d: ma200win.reduce((a, b) => a + b, 0) / ma200win.length,
        pct_rank_252d: pctRank(last.value, window),
        sample_days: window.length,
      };
    }

    // KR_VOL_20D — KOSPI 종가에서 파생
    if (params.indicators.KR_VOL_20D) {
      values.KR_VOL_20D = realizedVol20d(kospiCloses);
      // 분위수 보강은 생략(파생 시계열의 자체 이력 유지 비용 대비 효과 작음).
      // 절대 임계값(18/25/35%)만으로 판정된다.
    }

    // 수급 5일 누적
    if (params.indicators.FOREIGN_NET || params.indicators.INSTITUTION_NET) {
      let i = investorCursor.i;
      while (i + 1 < input.investor.length && input.investor[i + 1].date <= today) i++;
      investorCursor.i = i;
      if (i >= 4 && (Date.parse(today) - Date.parse(input.investor[i].date)) / 86400000 <= 5) {
        let f = 0, inst = 0;
        for (let j = i - 4; j <= i; j++) {
          f += input.investor[j].foreign_net;
          inst += input.investor[j].institution_net;
        }
        values.FOREIGN_NET = f;
        values.INSTITUTION_NET = inst;
      } else {
        values.FOREIGN_NET = null;
        values.INSTITUTION_NET = null;
      }
    }

    const v = calculateVerdict(values, stats, today, params);
    out.push({
      date: today,
      score: v.status === 'ok' ? v.score : null,
      coverage: v.coverage,
    });
  }
  return out;
}

export interface RegimeResult {
  name: string;
  peakDate: string;
  troughDate: string;
  /** 고점 대비 -10% 최초 이탈일. 이탈이 없으면 null (국면 부적격) */
  breachDate: string | null;
  warned: boolean;
  firstWarnDate: string | null;
  /** 경고일 → 이탈일 거래일 간격 */
  leadDays: number | null;
}

export interface BacktestMetrics {
  warnThreshold: number;
  regimes: RegimeResult[];
  hitRate: number;
  medianLeadDays: number | null;
  /** 하락 국면(고점~저점) 밖에서 경고 수준을 넘긴 날의 비율 */
  falseAlarmRate: number;
  scoredDays: number;
}

export function evaluate(
  scores: DailyScore[],
  kospi: SeriesPoint[],
  regimes: DrawdownRegime[],
  warnThreshold: number,
): BacktestMetrics {
  const dateIdx = new Map(kospi.map((p, i) => [p.date, i]));
  const scoreByDate = new Map(scores.map((s) => [s.date, s.score]));

  const results: RegimeResult[] = regimes.map((r) => {
    const peakI = dateIdx.get(r.peakDate);
    if (peakI == null) {
      return { name: r.name, peakDate: r.peakDate, troughDate: r.troughDate,
        breachDate: null, warned: false, firstWarnDate: null, leadDays: null };
    }
    const peak = kospi[peakI].value;
    let breachI: number | null = null;
    for (let i = peakI + 1; i < kospi.length && kospi[i].date <= r.troughDate; i++) {
      if (kospi[i].value <= peak * 0.9) { breachI = i; break; }
    }
    // 낙폭 10~16% 국면은 이탈일이 저점 근처라 정상. 이탈이 아예 없으면
    // (낙폭 10% 미만으로 재계산된 경우) 국면 부적격으로 제외한다.
    if (breachI == null) {
      return { name: r.name, peakDate: r.peakDate, troughDate: r.troughDate,
        breachDate: null, warned: false, firstWarnDate: null, leadDays: null };
    }
    let firstWarnI: number | null = null;
    for (let i = peakI; i < breachI; i++) {
      const s = scoreByDate.get(kospi[i].date);
      if (s != null && s >= warnThreshold) { firstWarnI = i; break; }
    }
    return {
      name: r.name,
      peakDate: r.peakDate,
      troughDate: r.troughDate,
      breachDate: kospi[breachI].date,
      warned: firstWarnI != null,
      firstWarnDate: firstWarnI != null ? kospi[firstWarnI].date : null,
      leadDays: firstWarnI != null ? breachI - firstWarnI : null,
    };
  });

  const eligible = results.filter((r) => r.breachDate != null);
  const hits = eligible.filter((r) => r.warned);
  const leads = hits.map((r) => r.leadDays as number).sort((a, b) => a - b);
  const medianLead = leads.length
    ? leads[Math.floor(leads.length / 2)]
    : null;

  // 오경보: 어느 국면(고점~저점)에도 속하지 않는 날 중 경고 수준 이상인 날
  const inRegime = (date: string) =>
    regimes.some((r) => date >= r.peakDate && date <= r.troughDate);
  let outsideDays = 0;
  let falseAlarms = 0;
  for (const s of scores) {
    if (s.score == null || inRegime(s.date)) continue;
    outsideDays++;
    if (s.score >= warnThreshold) falseAlarms++;
  }

  return {
    warnThreshold,
    regimes: results,
    hitRate: eligible.length ? hits.length / eligible.length : 0,
    medianLeadDays: medianLead,
    falseAlarmRate: outsideDays ? falseAlarms / outsideDays : 0,
    scoredDays: scores.filter((s) => s.score != null).length,
  };
}
