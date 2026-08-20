import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('indicator_weights')
    .select('*')
    .order('indicator_type');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  });
}

// 가중치는 shared/market/catalog.ts 로 일원화되어 이 라우트가 더는 정본이 아니다.
// 쓰기는 막되 조회(GET)는 기존 소비처가 남아 있을 수 있어 그대로 둔다.
export async function PUT() {
  return NextResponse.json(
    { success: false, error: '가중치는 shared/market/catalog.ts 에서 관리합니다' },
    { status: 410 }
  );
}
