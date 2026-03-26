import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { getTodayKst, fetchTodayBuySymbols } from '@/lib/ai-recommendation';
import type { ModelType } from '@/types/ai-recommendation';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '5'), 3), 10);
    const dateParam = searchParams.get('date');
    const model: ModelType = (searchParams.get('model') as ModelType) ?? 'standard';

    const supabase = createServiceClient();
    const todayKst = dateParam ?? getTodayKst();

    // 기존 오늘 데이터 조회 (읽기 전용 — 생성은 POST /generate로만)
    const { data: existing } = await supabase
      .from('ai_recommendations')
      .select('*')
      .eq('date', todayKst)
      .eq('model_type', model)
      .order('rank', { ascending: true })
      .limit(limit);

    // needs_refresh 판단: standard 모델만 BUY 종목 수 비교
    let needs_refresh = false;
    if (model === 'standard') {
      let currentCount = 0;
      try {
        const currentCandidates = await fetchTodayBuySymbols(supabase, todayKst);
        currentCount = currentCandidates.length;
      } catch {
        // 신호 수 조회 실패 시 needs_refresh false 처리
      }
      const storedCount = existing?.[0]?.total_candidates ?? 0;
      needs_refresh = existing && existing.length > 0 ? currentCount > storedCount : false;
    }

    return NextResponse.json({
      recommendations: existing ?? [],
      generated_at: existing?.[0]?.created_at ?? null,
      total_candidates: existing?.[0]?.total_candidates ?? 0,
      needs_refresh,
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
    });
  } catch (error) {
    console.error('[ai-recommendations GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
