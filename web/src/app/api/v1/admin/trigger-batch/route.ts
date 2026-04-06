import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/admin/trigger-batch
 * GitHub Actions workflow_dispatch를 트리거하고, batch_runs에 pending 레코드를 삽입합니다.
 * 인증: Authorization: Bearer {CRON_SECRET}
 */
export async function POST(request: NextRequest) {
  // 내부 인증 (CRON_SECRET 재사용)
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as { date?: string; mode?: string };
  const mode = body.mode ?? 'full';
  const date = body.date ?? '';

  // GitHub API로 workflow_dispatch 트리거
  const ghToken = process.env.GH_PAT;
  const ghRepo = process.env.GH_REPO; // 예: "username/DashboardStock"

  if (!ghToken || !ghRepo) {
    return NextResponse.json({ error: 'GH_PAT 또는 GH_REPO 환경변수 없음' }, { status: 500 });
  }

  const ghRes = await fetch(
    `https://api.github.com/repos/${ghRepo}/actions/workflows/daily-batch.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: { mode, date },
      }),
    }
  );

  if (!ghRes.ok) {
    const text = await ghRes.text();
    return NextResponse.json({ error: `GHA dispatch 실패: ${text}` }, { status: 500 });
  }

  // batch_runs에 pending 레코드 삽입 (프론트엔드 Realtime 구독용)
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('batch_runs')
    .insert({
      workflow: 'daily-batch',
      mode,
      status: 'pending',
      triggered_by: 'manual',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    console.error('batch_runs 삽입 실패:', error.message);
  }

  return NextResponse.json({
    ok: true,
    runId: data?.id ?? null,
    mode,
    date: date || '(오늘)',
  });
}
