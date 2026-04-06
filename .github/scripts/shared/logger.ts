import { supabase } from './supabase.js';

export type BatchStatus = 'pending' | 'running' | 'done' | 'failed';

export async function startBatchRun(mode: string, triggeredBy: 'schedule' | 'manual'): Promise<string> {
  const { data, error } = await supabase
    .from('batch_runs')
    .insert({
      workflow: 'daily-batch',
      mode,
      status: 'running',
      triggered_by: triggeredBy,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`batch_runs 삽입 실패: ${error?.message}`);
  const runId = data.id as string;
  console.log(`[batch] 시작 runId=${runId} mode=${mode}`);
  return runId;
}

export async function finishBatchRun(
  runId: string,
  status: 'done' | 'failed',
  summary: { collected: number; scored: number; errors: string[] },
): Promise<void> {
  await supabase
    .from('batch_runs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      summary,
    })
    .eq('id', runId);

  console.log(`[batch] 완료 runId=${runId} status=${status}`, summary);
}

export function log(step: string, msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}][${step}] ${msg}`);
}
