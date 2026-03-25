import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { generateRecommendations, getTodayKst } from '@/lib/ai-recommendation';
import { generateShortTermRecommendations } from '@/lib/ai-recommendation/short-term-momentum';
import {
  AiRecommendationWeights,
  DEFAULT_WEIGHTS,
  DEFAULT_SHORT_TERM_WEIGHTS,
  ShortTermWeights,
  ModelType,
} from '@/types/ai-recommendation';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const model: ModelType = body.model ?? 'standard';

    // limit=0이면 전체 후보 저장 (기본값)
    const rawLimit = parseInt(body.limit ?? '0');
    const limit = rawLimit <= 0 ? 999 : Math.max(rawLimit, 3);

    const supabase = createServiceClient();
    const todayKst = getTodayKst();

    // --- 초단기 모멘텀 모델 ---
    if (model === 'short_term') {
      // 가중치 검증 (momentum + supply + catalyst + valuation 합계 ≈ 100)
      const weights: ShortTermWeights = {
        momentum: Number(body.weights?.momentum ?? DEFAULT_SHORT_TERM_WEIGHTS.momentum),
        supply: Number(body.weights?.supply ?? DEFAULT_SHORT_TERM_WEIGHTS.supply),
        catalyst: Number(body.weights?.catalyst ?? DEFAULT_SHORT_TERM_WEIGHTS.catalyst),
        valuation: Number(body.weights?.valuation ?? DEFAULT_SHORT_TERM_WEIGHTS.valuation),
        risk: Number(body.weights?.risk ?? DEFAULT_SHORT_TERM_WEIGHTS.risk),
      };
      const coreSum = weights.momentum + weights.supply + weights.catalyst + weights.valuation;
      if (Math.abs(coreSum - 100) > 1) {
        return NextResponse.json(
          { error: `가중치 합계(momentum+supply+catalyst+valuation)가 100이어야 합니다. 현재: ${coreSum}` },
          { status: 400 },
        );
      }

      const { recommendations, total_candidates, filtered_out } = await generateShortTermRecommendations(
        supabase,
        weights,
        limit,
      );

      if (recommendations.length > 0) {
        // 오늘 short_term 데이터만 삭제 (standard 모델 보존)
        await supabase
          .from('ai_recommendations')
          .delete()
          .eq('date', todayKst)
          .eq('model_type', 'short_term');

        const insertData = recommendations.map((rec) => ({
          symbol: rec.symbol,
          name: rec.name,
          rank: rec.rank,
          total_score: rec.totalScore,
          date: todayKst,
          model_type: 'short_term' as const,
          score_breakdown: rec.breakdown,
          total_candidates,
          // standard 모델 전용 컬럼 — NOT NULL 제약이 있으므로 기본값 0
          signal_score: 0,
          trend_score: 0,
          valuation_score: 0,
          supply_score: 0,
          risk_score: 0,
          trend_days: 0,
          weight_signal: 0,
          weight_trend: 0,
          weight_valuation: 0,
          weight_supply: 0,
          weight_risk: 0,
        }));

        const { error: insertErr } = await supabase.from('ai_recommendations').insert(insertData);
        if (insertErr) console.error('[short_term insert error]', insertErr);
      }

      return NextResponse.json({
        recommendations,
        generated_at: new Date().toISOString(),
        total_candidates,
        needs_refresh: false,
        filtered_out,
      });
    }

    // --- 기존 standard 모델 ---
    const rawWeights: AiRecommendationWeights = {
      signal: Number(body.weights?.signal ?? DEFAULT_WEIGHTS.signal),
      trend: Number(body.weights?.trend ?? DEFAULT_WEIGHTS.trend),
      valuation: Number(body.weights?.valuation ?? DEFAULT_WEIGHTS.valuation),
      supply: Number(body.weights?.supply ?? DEFAULT_WEIGHTS.supply),
      risk: Number(body.weights?.risk ?? DEFAULT_WEIGHTS.risk),
    };
    // 핵심 4개 가중치 합계 검증 (signal + trend + valuation + supply = 100)
    const weightSum =
      rawWeights.signal + rawWeights.trend + rawWeights.valuation + rawWeights.supply;
    if (Math.abs(weightSum - 100) > 0.01) {
      return NextResponse.json(
        { error: `가중치 합계(signal+trend+valuation+supply)가 100이어야 합니다. 현재: ${weightSum}` },
        { status: 400 },
      );
    }
    // risk 가중치는 별도 0~100 범위 검증
    if (rawWeights.risk < 0 || rawWeights.risk > 100) {
      return NextResponse.json(
        { error: `risk 가중치는 0~100 범위여야 합니다. 현재: ${rawWeights.risk}` },
        { status: 400 },
      );
    }

    const { recommendations, total_candidates } = await generateRecommendations(
      supabase,
      rawWeights,
      limit,
    );

    if (recommendations.length > 0) {
      // 오늘 standard 데이터만 삭제 (short_term 모델 보존)
      await supabase
        .from('ai_recommendations')
        .delete()
        .eq('date', todayKst)
        .eq('model_type', 'standard');

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
