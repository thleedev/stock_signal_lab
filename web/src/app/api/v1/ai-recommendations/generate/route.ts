import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { generateRecommendations, getTodayKst } from '@/lib/ai-recommendation';
import { AiRecommendationWeights, DEFAULT_WEIGHTS } from '@/types/ai-recommendation';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    // limit=0이면 전체 후보 저장 (기본값)
    const rawLimit = parseInt(body.limit ?? '0');
    const limit = rawLimit <= 0 ? 999 : Math.max(rawLimit, 3);

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
      // 오늘 기존 데이터 전부 삭제 후 새로 insert
      await supabase.from('ai_recommendations').delete().eq('date', todayKst);
      // id/created_at 제거 → DB default 사용, symbol null 필터
      const insertData = recommendations
        .map(({ id: _id, created_at: _ca, ...rest }) => {
          const clean = { ...rest } as Record<string, unknown>;
          delete clean.id;
          delete clean.created_at;
          return clean;
        })
        .filter((r) => r.symbol && r.date);
      await supabase.from('ai_recommendations').insert(insertData);
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
