// web/src/app/api/v1/hot-themes/route.ts
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

function getTodayKst(): string {
  return new Date(new Date().getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function GET() {
  const supabase = createServiceClient();
  const today = getTodayKst();

  const { data, error } = await supabase
    .from('stock_themes')
    .select('theme_id, theme_name, avg_change_pct, momentum_score, stock_count, is_hot')
    .eq('date', today)
    .order('momentum_score', { ascending: false })
    .limit(10);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ themes: data ?? [], date: today });
}
