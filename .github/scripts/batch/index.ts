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

type BatchMode = 'full' | 'repair' | 'prices-only';

const mode = (process.env.BATCH_MODE ?? 'full') as BatchMode;
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
