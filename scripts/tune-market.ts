/**
 * 시황 판정 파라미터 튜닝 — 좌표 탐색 (설계 §8.3).
 *
 * 지표 하나씩 가중치 배수 {0, 0.5, 1, 1.5, 2} 를 시도해 학습 구간
 * (고점일 < 2023-01-01) 성능이 좋아지는 값을 채택하고, 전 지표를 한 바퀴
 * 돈 뒤 개선이 없을 때까지(최대 3바퀴) 반복합니다. 격자 전수 탐색은
 * 5^14 조합이라 불가능하고, 좌표 탐색은 국소 최적에 그칠 수 있으나
 * 과최적화 위험이 낮아 이 표본 크기(학습 국면 8개)에 맞습니다.
 *
 * 목적 함수(사전식): 오경보율 15% 이하 우선 → 적중률 → 오경보율 낮음 →
 * 선행일수 중앙값 큼. 경고 임계값은 파라미터마다 25~70 격자에서 같은
 * 규칙으로 다시 고릅니다. 검증 구간은 탐색에 쓰지 않고 최종 1회만
 * 평가합니다 — 검증 성능이 학습에서 무너지면 파라미터 수를 줄여야
 * 한다는 신호입니다.
 *
 * 실행: cd .github/scripts && npx tsx ../../scripts/tune-market.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { activeIndicators } from '../shared/market/catalog.js';
import { defaultParams } from '../shared/market/verdict.js';
import type { VerdictParams } from '../shared/market/verdict.js';
import { buildScoreSeries, evaluate } from '../shared/market/backtest/engine.js';
import type { BacktestInput, SeriesPoint, InvestorDay, BacktestMetrics } from '../shared/market/backtest/engine.js';
import { DRAWDOWN_REGIMES, TRAIN_VALID_SPLIT } from '../shared/market/backtest/regimes.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FALSE_ALARM_CAP = 0.15;
const MULTIPLIERS = [0, 0.5, 1, 1.5, 2];

function loadEnv(): { url: string; key: string } {
  const env = Object.fromEntries(
    readFileSync(join(ROOT, 'web/.env.local'), 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
  );
  return { url: env.NEXT_PUBLIC_SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY };
}

async function fetchAll<T>(url: string, key: string, path: string): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${offset}-${offset + 999}` },
    });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    const rows = (await res.json()) as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

interface Objective {
  feasible: boolean;
  hitRate: number;
  falseAlarmRate: number;
  medianLead: number;
  warn: number;
}

/** a 가 b 보다 좋으면 양수 (사전식 비교) */
function better(a: Objective, b: Objective): boolean {
  if (a.feasible !== b.feasible) return a.feasible;
  if (a.hitRate !== b.hitRate) return a.hitRate > b.hitRate;
  if (a.falseAlarmRate !== b.falseAlarmRate) return a.falseAlarmRate < b.falseAlarmRate;
  return a.medianLead > b.medianLead;
}

const TRAIN_RANGE = { from: '2015-01-01', to: '2022-12-31' };
const VALID_RANGE = { from: '2023-01-01', to: '2099-12-31' };

function scoreParams(
  input: BacktestInput,
  kospi: SeriesPoint[],
  params: VerdictParams,
  regimes: typeof DRAWDOWN_REGIMES,
  range: { from: string; to: string },
): { obj: Objective; metrics: BacktestMetrics } {
  const scores = buildScoreSeries(input, params);
  let bestObj: Objective | null = null;
  let bestM: BacktestMetrics | null = null;
  for (let warn = 25; warn <= 70; warn += 5) {
    const m = evaluate(scores, kospi, regimes, warn, range);
    const obj: Objective = {
      feasible: m.falseAlarmRate <= FALSE_ALARM_CAP,
      hitRate: m.hitRate,
      falseAlarmRate: m.falseAlarmRate,
      medianLead: m.medianLeadDays ?? 0,
      warn,
    };
    if (!bestObj || better(obj, bestObj)) { bestObj = obj; bestM = m; }
  }
  if (!bestObj || !bestM) throw new Error('평가 실패');
  return { obj: bestObj, metrics: bestM };
}

async function main() {
  const { url, key } = loadEnv();
  console.log('데이터 조회 중...');
  const indicatorRows = await fetchAll<{ indicator_type: string; date: string; value: string }>(
    url, key, 'market_indicators?select=indicator_type,date,value&order=indicator_type.asc,date.asc');
  const investorRows = await fetchAll<{ date: string; foreign_net: string; institution_net: string }>(
    url, key, 'market_investor_daily?select=date,foreign_net,institution_net&order=date.asc');

  const series: Record<string, SeriesPoint[]> = {};
  for (const r of indicatorRows) {
    (series[r.indicator_type] ??= []).push({ date: r.date, value: Number(r.value) });
  }
  const investor: InvestorDay[] = investorRows.map((r) => ({
    date: r.date, foreign_net: Number(r.foreign_net), institution_net: Number(r.institution_net),
  }));
  const maxStaleDays = Object.fromEntries(activeIndicators().map((s) => [s.key, s.maxStaleDays]));
  const input: BacktestInput = { series, investor, maxStaleDays };
  const kospi = series.KOSPI;

  const trainRegimes = DRAWDOWN_REGIMES.filter((r) => r.peakDate < TRAIN_VALID_SPLIT);
  const validRegimes = DRAWDOWN_REGIMES.filter((r) => r.peakDate >= TRAIN_VALID_SPLIT);

  const params = defaultParams();
  const baseWeights = Object.fromEntries(
    Object.entries(params.indicators).map(([k, p]) => [k, p.weight]),
  );

  let current = scoreParams(input, kospi, params, trainRegimes, TRAIN_RANGE);
  console.log(`기준선: 적중 ${(current.obj.hitRate * 100).toFixed(0)}% · 오경보 ${(current.obj.falseAlarmRate * 100).toFixed(1)}% · 임계 ${current.obj.warn}`);

  const keys = Object.keys(params.indicators);
  for (let pass = 1; pass <= 3; pass++) {
    let improved = false;
    for (const keyName of keys) {
      const original = params.indicators[keyName].weight;
      let bestMult = original / baseWeights[keyName];
      for (const mult of MULTIPLIERS) {
        const w = baseWeights[keyName] * mult;
        if (w === original) continue;
        params.indicators[keyName].weight = w;
        const trial = scoreParams(input, kospi, params, trainRegimes, TRAIN_RANGE);
        if (better(trial.obj, current.obj)) {
          current = trial;
          bestMult = mult;
          improved = true;
          console.log(
            `  ${keyName} weight ${original} → ${w}: 적중 ${(trial.obj.hitRate * 100).toFixed(0)}% · 오경보 ${(trial.obj.falseAlarmRate * 100).toFixed(1)}% · 임계 ${trial.obj.warn}`,
          );
        }
      }
      params.indicators[keyName].weight = baseWeights[keyName] * bestMult;
    }
    console.log(`-- ${pass}바퀴 완료 (개선 ${improved ? '있음' : '없음'})`);
    if (!improved) break;
  }

  console.log('\n최종 가중치 (기본값과 다른 것만):');
  for (const k of keys) {
    const w = params.indicators[k].weight;
    if (w !== baseWeights[k]) console.log(`  ${k}: ${baseWeights[k]} → ${w}`);
  }
  console.log(`\n학습 최종: 적중 ${(current.obj.hitRate * 100).toFixed(0)}% · 선행 ${current.metrics.medianLeadDays}일 · 오경보 ${(current.obj.falseAlarmRate * 100).toFixed(1)}% · 경고 임계 ${current.obj.warn}`);

  const validScores = buildScoreSeries(input, params);
  const validM = evaluate(validScores, kospi, validRegimes, current.obj.warn, VALID_RANGE);
  console.log(`검증(2023~): 적중 ${validM.regimes.filter((r) => r.warned).length}/${validM.regimes.filter((r) => r.breachDate).length} · 선행 ${validM.medianLeadDays ?? '-'}일 · 오경보 ${(validM.falseAlarmRate * 100).toFixed(1)}%`);
  for (const r of validM.regimes) {
    const mark = r.breachDate == null ? '제외' : r.warned ? `적중 D-${r.leadDays}` : '실기';
    console.log(`  ${r.name.padEnd(12)} ${mark}`);
  }
}

main();
