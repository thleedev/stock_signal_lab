import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

// GET — 그룹 목록 (sort_order 순)
export async function GET() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('watchlist_groups')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ groups: data });
}

// POST — 그룹 생성
export async function POST(request: NextRequest) {
  const body = await request.json();
  const name = (body.name ?? '').trim();

  if (!name) return Response.json({ error: 'name is required' }, { status: 400 });

  const supabase = createServiceClient();

  // 최대 20개 체크 (기본 포함)
  const { count } = await supabase
    .from('watchlist_groups')
    .select('*', { count: 'exact', head: true });
  if ((count ?? 0) >= 20) {
    return Response.json({ error: '그룹은 최대 20개까지 만들 수 있습니다.' }, { status: 400 });
  }

  // sort_order: 현재 최대값 + 1
  const { data: maxRow } = await supabase
    .from('watchlist_groups')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .single();
  const sortOrder = (maxRow?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from('watchlist_groups')
    .insert({ name, sort_order: sortOrder })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return Response.json({ error: '이미 존재하는 그룹명입니다.' }, { status: 409 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ group: data }, { status: 201 });
}

// PUT — 그룹 순서 일괄 변경 { ids: string[] }
// URL: PUT /api/v1/watchlist-groups (body: { ids: string[] })
// Note: The plan uses /reorder path but this handler serves PUT on the base route
export async function PUT(request: NextRequest) {
  const body = await request.json();
  const ids: string[] = body.ids ?? [];

  if (!ids.length) return Response.json({ error: 'ids required' }, { status: 400 });

  const supabase = createServiceClient();

  // ids는 커스텀 그룹만 순서대로 전달 (기본 그룹 제외)
  const updates = ids.map((id, index) =>
    supabase
      .from('watchlist_groups')
      .update({ sort_order: index + 1 })  // 기본은 0이므로 +1부터
      .eq('id', id)
      .eq('is_default', false)            // 기본 그룹은 수정 불가
  );

  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) return Response.json({ error: failed.error.message }, { status: 500 });

  return Response.json({ success: true });
}
