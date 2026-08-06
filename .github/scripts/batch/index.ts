import { startBatchRun, finishBatchRun, log } from '../shared/logger.js';
import { runPricesOnly } from './prices-only.js';
import { runStep1DailyPrices } from './step1-daily-prices.js';
import { runStep2InvestorData } from './step2-investor-data.js';
import { runStep3Shortsell } from './step3-shortsell.js';
import { runStep4Scoring } from './step4-scoring.js';
import { runStep5AiReport } from './step5-ai-report.js';
import { runStep6MarketData } from './step6-market-data.js';
import { runStep7Events } from './step7-events.js';
import { runStep8Cleanup } from './step8-cleanup.js';
import { crawlSectors } from './step9-crawl-sectors.js';
import { crawlThemes } from './step10-crawl-themes.js';
import { runStep11LassiSignals } from './step11-lassi-signals.js';
import { supabase } from '../shared/supabase.js';

type BatchMode = 'full' | 'repair' | 'prices-only';

const mode = (process.env.BATCH_MODE ?? 'full') as BatchMode;
// TARGET_DATE 미지정 시 폴백은 UTC 날짜라 KST 와 하루 어긋날 수 있습니다.
// 어긋나는 구간과 그 처리 근거는 step11-lassi-signals.ts 상단 주석에 정리했습니다.
const targetDate = process.env.TARGET_DATE || new Date().toISOString().slice(0, 10);
const triggeredBy = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' ? 'manual' : 'schedule';

async function main() {
  const summary = { collected: 0, scored: 0, errors: [] as string[] };
  const runId = await startBatchRun(mode, triggeredBy);

  try {
    if (mode === 'prices-only') {
      log('main', '장중 현재가 수집 모드');
      const result = await runPricesOnly();
      summary.collected = result.collected;

      // 라씨 신호를 스코어링보다 먼저 적재해야 직전 사이클 신호가 이번 채점에 반영됩니다.
      // 뒤에 두면 신호 소스 가점이 한 사이클(15분) 늦게 붙습니다.
      // 장중 여부는 서버 라우트가 판정하고, 기준일 판정은 step11 이 KST 오늘과 비교합니다.
      const s11 = await runStep11LassiSignals({ date: targetDate });
      summary.errors.push(...s11.errors);

      const s4 = await runStep4Scoring({ date: targetDate });
      summary.scored = s4.scored;
      summary.errors.push(...s4.errors);

    } else if (mode === 'repair') {
      log('main', `누락 보정 모드 date=${targetDate}`);
      const result = await runStep1DailyPrices({ mode: 'repair', date: targetDate });
      summary.collected = result.collected;
      summary.errors.push(...result.errors);

    } else {
      log('main', `전체 배치 모드 date=${targetDate}`);

      const s1 = await runStep1DailyPrices({ mode: 'full', date: targetDate });
      summary.collected += s1.collected;
      summary.errors.push(...s1.errors);

      const s2 = await runStep2InvestorData({ date: targetDate });
      summary.errors.push(...s2.errors);

      const s3 = await runStep3Shortsell({ date: targetDate });
      summary.errors.push(...s3.errors);

      // 라씨 신호를 먼저 적재해야 이후 스코어링·AI 리포트가 당일 신호를 반영합니다.
      // targetDate 를 넘겨 과거 일자 재실행에서는 step11 이 스스로 생략하게 합니다.
      // force 는 서버의 수집 시간대 가드만 건너뛰며 날짜 가드에는 영향이 없습니다.
      const s11 = await runStep11LassiSignals({ force: true, date: targetDate });
      summary.errors.push(...s11.errors);

      const s4 = await runStep4Scoring({ date: targetDate });
      summary.scored = s4.scored;
      summary.errors.push(...s4.errors);

      await runStep5AiReport({ date: targetDate }).catch(e => {
        summary.errors.push(`step5: ${(e as Error).message}`);
      });

      await runStep6MarketData().catch(e => {
        summary.errors.push(`step6: ${(e as Error).message}`);
      });

      await runStep7Events().catch(e => {
        summary.errors.push(`step7: ${(e as Error).message}`);
      });

      await runStep8Cleanup();

      // 테마/섹터 크롤링 (full 모드에서만)
      await crawlSectors(supabase).catch(e => {
        summary.errors.push(`step9: ${(e as Error).message}`);
      });

      await crawlThemes(supabase).catch(e => {
        summary.errors.push(`step10: ${(e as Error).message}`);
      });
    }

    await finishBatchRun(runId, 'done', summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push(msg);
    await finishBatchRun(runId, 'failed', summary);
    process.exit(1);
  }
}

main();
