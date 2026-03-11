import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import type { SignalSource, ExecutionType } from '@/types/signal';
import { getPortfolioValue } from '@/lib/strategy-engine/portfolio';

/**
 * GET /api/v1/portfolio
 *
 * 통합 또는 소스별 포트폴리오 현황
 * Query: source (lassi/stockbot/quant), execution_type (lump/split)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get('source') as SignalSource | null;
  const execType = (searchParams.get('execution_type') ?? 'lump') as ExecutionType;

  const supabase = createServiceClient();

  try {
    if (source) {
      // 단일 소스 포트폴리오
      const pv = await getPortfolioValue(supabase, source, execType);
      return NextResponse.json({ source, execution_type: execType, ...pv });
    }

    // 통합 포트폴리오 (3개 소스 합산)
    const sources: SignalSource[] = ['lassi', 'stockbot', 'quant'];
    const combined = {
      execution_type: execType,
      total_cash: 0,
      total_value: 0,
      portfolios: [] as Array<{
        source: string;
        cash: number;
        total_value: number;
        holdings_count: number;
      }>,
    };

    for (const s of sources) {
      const pv = await getPortfolioValue(supabase, s, execType);
      combined.total_cash += pv.cash;
      combined.total_value += pv.total_value;
      combined.portfolios.push({
        source: s,
        cash: pv.cash,
        total_value: pv.total_value,
        holdings_count: pv.holdings.length,
      });
    }

    return NextResponse.json(combined);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
