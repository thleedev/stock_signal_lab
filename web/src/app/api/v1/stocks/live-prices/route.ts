import { NextResponse } from 'next/server';
import { fetchAllStockPrices } from '@/lib/naver-stock-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** 장중(KST 평일 08~20시) 여부 */
function isMarketHours(): boolean {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const hour = kst.getUTCHours();
  const day = kst.getUTCDay();
  return day >= 1 && day <= 5 && hour >= 8 && hour < 20;
}

/**
 * GET /api/v1/stocks/live-prices
 * 네이버 전종목 현재가를 반환합니다.
 * /stocks 가 마운트 후 호출해 stock_cache 가격 위에 덮어씁니다.
 * 장중이 아니면 빈 응답을 즉시 돌려줍니다.
 */
export async function GET() {
  if (!isMarketHours()) {
    return NextResponse.json({ prices: {}, marketOpen: false });
  }

  try {
    const priceMap = await fetchAllStockPrices();
    const prices: Record<string, unknown> = {};
    for (const [symbol, p] of priceMap) {
      prices[symbol] = {
        current_price: p.current_price,
        price_change: p.price_change,
        price_change_pct: p.price_change_pct,
        volume: p.volume,
        market_cap: p.market_cap,
      };
    }
    return NextResponse.json({ prices, marketOpen: true });
  } catch (e) {
    console.error('[live-prices] 네이버 시세 조회 실패:', e);
    return NextResponse.json({ prices: {}, marketOpen: true });
  }
}
