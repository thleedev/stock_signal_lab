// .github/scripts/batch/step8-cleanup.ts
import { supabase } from '../shared/supabase.js';
import { log } from '../shared/logger.js';

/** daily_prices에서 2년 초과 데이터 삭제 (Supabase 500MB 유지) */
export async function runStep8Cleanup(): Promise<void> {
  const cutoffDate = new Date(Date.now() - 2 * 365 * 86400000).toISOString().slice(0, 10);
  log('step8', `2년 초과 데이터 삭제 cutoff=${cutoffDate}`);

  const { error, count } = await supabase
    .from('daily_prices')
    .delete({ count: 'exact' })
    .lt('date', cutoffDate);

  if (error) {
    log('step8', `삭제 오류: ${error.message}`);
  } else {
    log('step8', `완료: ${count ?? 0}행 삭제`);
  }
}
