// 스냅샷 업데이트 상태 조회 API
// snapshot_update_status 테이블에서 현재 업데이트 진행 여부 및 마지막 업데이트 시각을 반환합니다.
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('snapshot_update_status')
    .select('updating, last_updated, model')
    .single();

  return NextResponse.json(
    {
      updating: data?.updating ?? false,
      last_updated: data?.last_updated ?? null,
      model: data?.model ?? null,
    },
    {
      headers: { 'Cache-Control': 'no-cache' },
    },
  );
}
