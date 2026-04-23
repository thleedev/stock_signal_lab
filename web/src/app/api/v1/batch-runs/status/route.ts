import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const STALE_MINUTES: Record<string, number> = {
  'prices-only': 10,
  repair: 30,
  full: 60,
};
const DEFAULT_STALE_MINUTES = 30;

export async function GET() {
  const supabase = createServiceClient();

  const { data: rows } = await supabase
    .from('batch_runs')
    .select('id, status, mode, triggered_by, started_at')
    .in('status', ['pending', 'running'])
    .order('started_at', { ascending: false })
    .limit(50);

  const now = Date.now();
  const isStale = (r: { mode: string | null; started_at: string | null }) => {
    if (!r.started_at) return false;
    const ageMin = (now - new Date(r.started_at).getTime()) / 60_000;
    const limit = STALE_MINUTES[r.mode ?? ''] ?? DEFAULT_STALE_MINUTES;
    return ageMin > limit;
  };

  const staleIds = (rows ?? []).filter(isStale).map((r) => r.id);
  if (staleIds.length > 0) {
    await supabase
      .from('batch_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        summary: { stale_timeout: true },
      })
      .in('id', staleIds);
  }

  const active = (rows ?? []).find((r) => !isStale(r));

  return NextResponse.json({
    collecting: !!active,
    status: active?.status ?? null,
    mode: active?.mode ?? null,
    triggered_by: active?.triggered_by ?? null,
    started_at: active?.started_at ?? null,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
