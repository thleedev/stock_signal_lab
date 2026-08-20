/**
 * 시황 위험 지수 백테스트 러너 (설계 §8, 단계 2).
 *
 * DB 의 지표 히스토리(source=backfill 포함)를 전량 읽어 일자별 위험 점수를
 * 재현하고, 하락 국면 정답지 대비 적중률·선행일수·오경보율을 계산합니다.
 * 경고 임계값은 학습 구간(고점일 < 2023-01-01) 국면으로 격자 탐색해 고르고,
 * 같은 값을 검증 구간에 적용해 성능 유지 여부를 봅니다.
 *
 * 실행:  cd .github/scripts && npx tsx ../../scripts/backtest-market.ts [--save]
 *   --save 를 주면 market_backtest_run / market_backtest_result 에 저장합니다.
 *
 * 환경: web/.env.local 의 NEXT_PUBLIC_SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY 를
 * 읽습니다 (백필 스크립트와 동일 관례).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { activeIndicators } from '../shared/market/catalog.js';
import { buildScoreSeries, evaluate } from '../shared/market/backtest/engine.js';
import type { BacktestInput, SeriesPoint, InvestorDay, BacktestMetrics } from '../shared/market/backtest/engine.js';
import { DRAWDOWN_REGIMES, TRAIN_VALID_SPLIT } from '../shared/market/backtest/regimes.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(): { url: string; key: string } {
  const env = Object.fromEntries(
    readFileSync(join(ROOT, 'web/.env.local'), 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
  );
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('web/.env.local 에서 Supabase 접속 정보를 찾지 못했습니다');
  return { url, key };
}

async function fetchAll<T>(url: string, key: string, path: string): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${offset}-${offset + 999}`,
      },
    });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
    const rows = (await res.json()) as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

function printMetrics(title: string, m: BacktestMetrics) {
  console.log(`\n== ${title} (경고 임계 ${m.warnThreshold}) ==`);
  console.log(
    `적중 ${m.regimes.filter((r) => r.warned).length}/${m.regimes.filter((r) => r.breachDate).length}` +
      ` · 선행일수 중앙값 ${m.medianLeadDays ?? '-'}거래일 · 오경보율 ${(m.falseAlarmRate * 100).toFixed(1)}%` +
      ` · 판정일 ${m.scoredDays}일`,
  );
  for (const r of m.regimes) {
    const mark = r.breachDate == null ? '제외' : r.warned ? `적중 D-${r.leadDays} (${r.firstWarnDate})` : '실기';
    console.log(`  ${r.name.padEnd(12)} 고점 ${r.peakDate} 이탈 ${r.breachDate ?? '-'}  ${mark}`);
  }
}

async function main() {
  const { url, key } = loadEnv();
  const save = process.argv.includes('--save');

  console.log('지표 히스토리 조회 중...');
  const indicatorRows = await fetchAll<{ indicator_type: string; date: string; value: string }>(
    url, key,
    'market_indicators?select=indicator_type,date,value&order=indicator_type.asc,date.asc',
  );
  const investorRows = await fetchAll<{ date: string; foreign_net: string; institution_net: string }>(
    url, key,
    'market_investor_daily?select=date,foreign_net,institution_net&order=date.asc',
  );
  console.log(`지표 ${indicatorRows.length}행, 수급 ${investorRows.length}행`);

  const series: Record<string, SeriesPoint[]> = {};
  for (const r of indicatorRows) {
    (series[r.indicator_type] ??= []).push({ date: r.date, value: Number(r.value) });
  }
  const investor: InvestorDay[] = investorRows.map((r) => ({
    date: r.date,
    foreign_net: Number(r.foreign_net),
    institution_net: Number(r.institution_net),
  }));
  const maxStaleDays = Object.fromEntries(activeIndicators().map((s) => [s.key, s.maxStaleDays]));

  const input: BacktestInput = { series, investor, maxStaleDays };
  console.log('점수 시계열 계산 중...');
  const scores = buildScoreSeries(input);
  const kospi = series.KOSPI;

  const trainRegimes = DRAWDOWN_REGIMES.filter((r) => r.peakDate < TRAIN_VALID_SPLIT);
  const validRegimes = DRAWDOWN_REGIMES.filter((r) => r.peakDate >= TRAIN_VALID_SPLIT);

  // 격자 탐색 — 학습 구간에서 적중률 우선, 동률이면 오경보율 낮은 쪽
  console.log('\n경고 임계값 격자 (학습 구간): 임계 | 적중 | 선행 중앙값 | 오경보율');
  let best: BacktestMetrics | null = null;
  for (let warn = 25; warn <= 70; warn += 5) {
    const m = evaluate(scores, kospi, trainRegimes, warn, { from: '2015-01-01', to: '2022-12-31' });
    const hit = m.regimes.filter((r) => r.warned).length;
    const n = m.regimes.filter((r) => r.breachDate).length;
    console.log(
      `  ${String(warn).padStart(2)} | ${hit}/${n} | ${String(m.medianLeadDays ?? '-').padStart(3)}일 | ${(m.falseAlarmRate * 100).toFixed(1)}%`,
    );
    // 선택 규칙: 오경보율 15% 이하인 임계값 중 적중률 최대, 동률이면
    // 오경보율 최소. 15% 제약이 없으면 격자가 항상 최저 임계값을 골라
    // 평온일 다섯에 하나가 경고인 "상시 경고" 상태가 된다 (설계 §8.2 가
    // 경계한 지점). 제약을 만족하는 임계값이 없으면 적중률만 본다.
    const ok = m.falseAlarmRate <= 0.15;
    const bestOk = best != null && best.falseAlarmRate <= 0.15;
    if (
      !best ||
      (ok && !bestOk) ||
      (ok === bestOk &&
        (m.hitRate > best.hitRate ||
          (m.hitRate === best.hitRate && m.falseAlarmRate < best.falseAlarmRate)))
    ) {
      best = m;
    }
  }
  if (!best) throw new Error('격자 탐색 결과 없음');

  printMetrics('학습 구간 (2015~2022 고점)', best);
  const validM = evaluate(scores, kospi, validRegimes, best.warnThreshold, { from: '2023-01-01', to: '2099-12-31' });
  printMetrics('검증 구간 (2023~ 고점)', validM);
  const allM = evaluate(scores, kospi, DRAWDOWN_REGIMES, best.warnThreshold);
  printMetrics('전체 국면', allM);

  if (!save) {
    console.log('\n--save 없이 실행되어 DB 에 저장하지 않았습니다.');
    return;
  }

  const runRes = await fetch(`${url}/rest/v1/market_backtest_run`, {
    method: 'POST',
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: JSON.stringify({
      warn_threshold: best.warnThreshold,
      train_hit_rate: best.hitRate,
      valid_hit_rate: validM.hitRate,
      median_lead_days: allM.medianLeadDays,
      false_alarm_rate: allM.falseAlarmRate,
      scored_days: allM.scoredDays,
      params: { note: '카탈로그 기본 가중치·임계값, 경고 임계만 격자 탐색' },
    }),
  });
  if (!runRes.ok) throw new Error(`run 저장 실패: ${await runRes.text()}`);
  const [run] = (await runRes.json()) as { id: number }[];

  const detailRes = await fetch(`${url}/rest/v1/market_backtest_result`, {
    method: 'POST',
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify(
      allM.regimes.map((r) => ({
        run_id: run.id,
        regime: r.name,
        peak_date: r.peakDate,
        trough_date: r.troughDate,
        breach_date: r.breachDate,
        warned: r.warned,
        first_warn_date: r.firstWarnDate,
        lead_days: r.leadDays,
      })),
    ),
  });
  if (!detailRes.ok) throw new Error(`result 저장 실패: ${await detailRes.text()}`);
  console.log(`\nrun_id=${run.id} 로 저장 완료`);
}

main();
