import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const ids: string[] = body.ids ?? [];

  if (!ids.length) return Response.json({ error: 'ids required' }, { status: 400 });

  const supabase = createServiceClient();

  const updates = ids.map((id, index) =>
    supabase
      .from('watchlist_groups')
      .update({ sort_order: index + 1 })
      .eq('id', id)
      .eq('is_default', false)
  );

  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) return Response.json({ error: failed.error.message }, { status: 500 });

  return Response.json({ success: true });
}
