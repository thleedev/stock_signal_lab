import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createServiceClient();

  const { data } = await supabase
    .from('batch_runs')
    .select('id, status, mode, triggered_by, started_at')
    .in('status', ['pending', 'running'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    collecting: !!data,
    status: data?.status ?? null,
    mode: data?.mode ?? null,
    triggered_by: data?.triggered_by ?? null,
    started_at: data?.started_at ?? null,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
