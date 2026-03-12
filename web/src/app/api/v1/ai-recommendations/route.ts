import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { getTodayKst, fetchTodayBuySymbols } from '@/lib/ai-recommendation';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '5'), 3), 10);
    const dateParam = searchParams.get('date');

    const supabase = createServiceClient();
    const todayKst = dateParam ?? getTodayKst();

    // 기존 오늘 데이터 조회 (읽기 전용 — 생성은 POST /generate로만)
    const { data: existing } = await supabase
      .from('ai_recommendations')
      .select('*')
      .eq('date', todayKst)
      .order('rank', { ascending: true })
      .limit(limit);

    // 오늘 BUY 종목 수 조회 (needs_refresh 판단용) — 실패 시 false로 안전 fallback
    let currentCount = 0;
    try {
      const currentCandidates = await fetchTodayBuySymbols(supabase, todayKst);
      currentCount = currentCandidates.length;
    } catch {
      // 신호 수 조회 실패 시 needs_refresh false 처리
    }

    const storedCount = existing?.[0]?.total_candidates ?? 0;
    const needs_refresh = existing && existing.length > 0 ? currentCount > storedCount : false;

    return NextResponse.json({
      recommendations: existing ?? [],
      generated_at: existing?.[0]?.created_at ?? null,
      total_candidates: currentCount,
      needs_refresh,
    });
  } catch (error) {
    console.error('[ai-recommendations GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
