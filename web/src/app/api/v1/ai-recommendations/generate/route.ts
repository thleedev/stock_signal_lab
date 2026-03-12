import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { generateRecommendations, getTodayKst } from '@/lib/ai-recommendation';
import { AiRecommendationWeights, DEFAULT_WEIGHTS } from '@/types/ai-recommendation';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const limit = Math.min(Math.max(parseInt(body.limit ?? '5'), 3), 10);

    // 가중치 검증 (부동소수점 오차 허용)
    const rawWeights: AiRecommendationWeights = {
      signal: Number(body.weights?.signal ?? DEFAULT_WEIGHTS.signal),
      technical: Number(body.weights?.technical ?? DEFAULT_WEIGHTS.technical),
      valuation: Number(body.weights?.valuation ?? DEFAULT_WEIGHTS.valuation),
      supply: Number(body.weights?.supply ?? DEFAULT_WEIGHTS.supply),
    };
    const weightSum =
      rawWeights.signal + rawWeights.technical + rawWeights.valuation + rawWeights.supply;
    if (Math.abs(weightSum - 100) > 0.01) {
      return NextResponse.json(
        { error: `가중치 합계가 100이어야 합니다. 현재: ${weightSum}` },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    const { recommendations, total_candidates } = await generateRecommendations(
      supabase,
      rawWeights,
      limit
    );

    if (recommendations.length > 0) {
      const todayKst = getTodayKst();
      // upsert 먼저 (insert 실패 시 데이터 손실 방지)
      const { error: upsertError } = await supabase.from('ai_recommendations').upsert(
        recommendations.map((r) => ({ ...r, id: undefined })),
        { onConflict: 'date,symbol' }
      );
      if (!upsertError) {
        // 새 추천에 포함되지 않은 오늘의 이전 데이터 정리 (limit 변경 시)
        const newSymbols = recommendations.map((r) => r.symbol);
        await supabase
          .from('ai_recommendations')
          .delete()
          .eq('date', todayKst)
          .not('symbol', 'in', `(${newSymbols.join(',')})`);
      }
    }

    return NextResponse.json({
      recommendations,
      generated_at: new Date().toISOString(),
      total_candidates,
      needs_refresh: false,
    });
  } catch (error) {
    console.error('[ai-recommendations POST /generate]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
