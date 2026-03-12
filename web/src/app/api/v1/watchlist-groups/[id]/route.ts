// web/src/app/api/v1/watchlist-groups/[id]/route.ts
import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

type Params = { params: { id: string } };

// PATCH — 그룹명 변경
export async function PATCH(request: NextRequest, { params }: Params) {
  const body = await request.json();
  const name = (body.name ?? '').trim();
  if (!name) return Response.json({ error: 'name is required' }, { status: 400 });

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('watchlist_groups')
    .update({ name })
    .eq('id', params.id)
    .eq('is_default', false)  // 기본 그룹 이름 변경 불가
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return Response.json({ error: '이미 존재하는 그룹명입니다.' }, { status: 409 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }
  if (!data) return Response.json({ error: 'not found or protected' }, { status: 404 });

  return Response.json({ group: data });
}

// DELETE — 그룹 삭제 (종목 정리 포함)
export async function DELETE(_: NextRequest, { params }: Params) {
  const supabase = createServiceClient();

  // 기본 그룹 삭제 불가
  const { data: group } = await supabase
    .from('watchlist_groups')
    .select('is_default')
    .eq('id', params.id)
    .single();

  if (!group) return Response.json({ error: 'not found' }, { status: 404 });
  if (group.is_default) return Response.json({ error: '기본 그룹은 삭제할 수 없습니다.' }, { status: 400 });

  // 이 그룹에 속한 종목 목록
  const { data: groupStocks } = await supabase
    .from('watchlist_group_stocks')
    .select('symbol')
    .eq('group_id', params.id);

  const symbols = (groupStocks ?? []).map((s) => s.symbol);

  // ON DELETE CASCADE로 watchlist_group_stocks는 자동 삭제
  const { error: delError } = await supabase
    .from('watchlist_groups')
    .delete()
    .eq('id', params.id);

  if (delError) return Response.json({ error: delError.message }, { status: 500 });

  // 다른 그룹에도 없는 종목 → favorite_stocks 삭제 + stock_cache 갱신
  if (symbols.length > 0) {
    const { data: stillInGroup } = await supabase
      .from('watchlist_group_stocks')
      .select('symbol')
      .in('symbol', symbols);

    const stillSymbols = new Set((stillInGroup ?? []).map((s) => s.symbol));
    const orphaned = symbols.filter((s) => !stillSymbols.has(s));

    if (orphaned.length > 0) {
      await Promise.all([
        supabase.from('favorite_stocks').delete().in('symbol', orphaned),
        supabase.from('stock_cache').update({ is_favorite: false }).in('symbol', orphaned),
      ]);
    }
  }

  return Response.json({ success: true });
}
