import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import {
  isEtf, classifyEtfType, extractSector,
  calculateSectorSentiments,
  type ClassifiedEtf,
} from '@/lib/etf-sentiment';

export const dynamic = 'force-dynamic';

const BUY_TYPES = ['BUY'];
const SELL_TYPES = ['SELL', 'SELL_COMPLETE'];

export async function GET() {
  try {
    const supabase = createServiceClient();

    const { data: signals, error } = await supabase
      .from('signals')
      .select('name, symbol, signal_type, timestamp')
      .eq('source', 'lassi')
      .in('signal_type', [...BUY_TYPES, ...SELL_TYPES])
      .order('timestamp', { ascending: false });

    if (error || !signals) {
      return NextResponse.json({
        success: true,
        sectors: {},
        overallSentiment: 0,
        overallLabel: 'neutral',
        updatedAt: new Date().toISOString(),
      });
    }

    const latestByName = new Map<string, {
      symbol: string | null;
      signalType: string;
      timestamp: string;
    }>();

    // symbol 기준 dedup (잘린 신호명이 다르지만 같은 종목인 경우 방지)
    const seenSymbols = new Set<string>();
    for (const sig of signals) {
      if (!isEtf(sig.name)) continue;
      const key = sig.symbol ?? sig.name; // symbol 없으면 name으로 폴백
      if (seenSymbols.has(key)) continue;
      seenSymbols.add(key);
      latestByName.set(sig.name, {
        symbol: sig.symbol,
        signalType: sig.signal_type,
        timestamp: sig.timestamp,
      });
    }

    if (latestByName.size === 0) {
      return NextResponse.json({
        success: true,
        sectors: {},
        overallSentiment: 0,
        overallLabel: 'neutral',
        updatedAt: new Date().toISOString(),
      });
    }

    const symbols = [...latestByName.values()]
      .map((v) => v.symbol)
      .filter((s): s is string => s != null);

    // stock_cache에서 실제 종목명 + 시가총액 조회 (신호 종목명은 …으로 잘려있음)
    const marketCapMap = new Map<string, number>();
    const realNameMap = new Map<string, string>();
    if (symbols.length > 0) {
      const { data: caches } = await supabase
        .from('stock_cache')
        .select('symbol, name, market_cap')
        .in('symbol', symbols);

      if (caches) {
        for (const c of caches) {
          if (c.market_cap != null) marketCapMap.set(c.symbol, c.market_cap);
          if (c.name) realNameMap.set(c.symbol, c.name);
        }
      }
    }

    // 카테고리 매핑 (DB 기반 보정 - 정규식 fallback 보다 우선)
    const categoryMap = new Map<string, { sector: string; side: 'bull' | 'bear' | null; excluded: boolean }>();
    if (symbols.length > 0) {
      const { data: maps } = await supabase
        .from('etf_category_map')
        .select('symbol, sector, side, excluded')
        .in('symbol', symbols);
      if (maps) {
        for (const m of maps) {
          categoryMap.set(m.symbol, {
            sector: m.sector,
            side: (m.side as 'bull' | 'bear' | null) ?? null,
            excluded: !!m.excluded,
          });
        }
      }
    }

    // realName 변환 후 중복 제거 (잘린 이름 + 전체 이름이 같은 종목으로 매핑되는 경우)
    const classifiedEtfs: ClassifiedEtf[] = [];
    const seenRealNames = new Set<string>();
    for (const [signalName, info] of latestByName) {
      const realName = (info.symbol ? realNameMap.get(info.symbol) : null) ?? signalName.replace(/…/g, '');
      if (seenRealNames.has(realName)) continue;
      seenRealNames.add(realName);

      const override = info.symbol ? categoryMap.get(info.symbol) : undefined;
      if (override?.excluded) continue;

      const { type, side: detectedSide, typeWeight } = classifyEtfType(realName);
      const side = override?.side ?? detectedSide;
      const sector = override?.sector ?? extractSector(realName);
      const held = BUY_TYPES.includes(info.signalType);
      const marketCap = info.symbol ? (marketCapMap.get(info.symbol) ?? null) : null;

      classifiedEtfs.push({
        name: realName,
        symbol: info.symbol,
        brand: '',
        type,
        typeWeight,
        side,
        sector,
        held,
        marketCap,
        lastSignalDate: info.timestamp,
        lastSignalType: info.signalType,
      });
    }

    const result = calculateSectorSentiments(classifiedEtfs);

    const response = NextResponse.json({
      success: true,
      ...result,
      rawEtfs: classifiedEtfs,
      updatedAt: new Date().toISOString(),
    });

    response.headers.set('Cache-Control', 'public, max-age=300');
    return response;
  } catch (e) {
    console.error('[etf-sentiment] error:', e);
    return NextResponse.json({
      success: false,
      sectors: {},
      overallSentiment: 0,
      overallLabel: 'neutral',
      updatedAt: new Date().toISOString(),
    }, { status: 500 });
  }
}
