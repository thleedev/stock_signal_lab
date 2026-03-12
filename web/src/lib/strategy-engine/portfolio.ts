import { SupabaseClient } from '@supabase/supabase-js';
import type { SignalSource, ExecutionType, PortfolioHolding } from '@/types/signal';
import { PORTFOLIO_CONFIG } from './index';

/**
 * 포트폴리오 유틸리티
 *
 * 가상 거래 기록으로부터 현금/보유/수익률 계산
 */

/**
 * 현재 가용 현금 계산
 * = 초기 자금 - 매수 총액 + 매도 총액
 */
export async function getPortfolioCash(
  supabase: SupabaseClient,
  source: string,
  execType: string
): Promise<number> {
  const { data: trades } = await supabase
    .from('virtual_trades')
    .select('side, price, quantity')
    .eq('source', source)
    .eq('execution_type', execType);

  if (!trades || trades.length === 0) {
    return PORTFOLIO_CONFIG.CASH_PER_STRATEGY;
  }

  let cash = PORTFOLIO_CONFIG.CASH_PER_STRATEGY;
  for (const t of trades) {
    const amount = t.price * t.quantity;
    if (t.side === 'BUY') {
      cash -= amount;
    } else {
      cash += amount;
    }
  }

  return cash;
}

/**
 * 특정 종목 보유 여부 확인
 */
export async function hasOpenPosition(
  supabase: SupabaseClient,
  source: string,
  execType: string,
  symbol: string
): Promise<boolean> {
  const { data: buys } = await supabase
    .from('virtual_trades')
    .select('quantity')
    .eq('source', source)
    .eq('execution_type', execType)
    .eq('symbol', symbol)
    .eq('side', 'BUY');

  const { data: sells } = await supabase
    .from('virtual_trades')
    .select('quantity')
    .eq('source', source)
    .eq('execution_type', execType)
    .eq('symbol', symbol)
    .eq('side', 'SELL');

  const buyQty = buys?.reduce((s, b) => s + b.quantity, 0) ?? 0;
  const sellQty = sells?.reduce((s, b) => s + b.quantity, 0) ?? 0;
  return (buyQty - sellQty) > 0;
}

/**
 * 전체 보유 종목 현황
 */
export async function getHoldings(
  supabase: SupabaseClient,
  source: string,
  execType: string
): Promise<PortfolioHolding[]> {
  const { data: trades } = await supabase
    .from('virtual_trades')
    .select('symbol, name, side, price, quantity')
    .eq('source', source)
    .eq('execution_type', execType)
    .order('created_at', { ascending: true });

  if (!trades) return [];

  // 종목별 집계
  const holdings = new Map<string, {
    name: string;
    buyQty: number;
    buyAmount: number;
    sellQty: number;
  }>();

  for (const t of trades) {
    const h = holdings.get(t.symbol) ?? {
      name: t.name ?? t.symbol,
      buyQty: 0,
      buyAmount: 0,
      sellQty: 0,
    };

    if (t.side === 'BUY') {
      h.buyQty += t.quantity;
      h.buyAmount += t.price * t.quantity;
    } else {
      h.sellQty += t.quantity;
    }

    holdings.set(t.symbol, h);
  }

  const result: PortfolioHolding[] = [];
  for (const [symbol, h] of holdings) {
    const netQty = h.buyQty - h.sellQty;
    if (netQty > 0) {
      result.push({
        symbol,
        name: h.name,
        quantity: netQty,
        avg_price: Math.round(h.buyAmount / h.buyQty),
      });
    }
  }

  return result;
}

/**
 * 포트폴리오 총 가치 계산
 */
export async function getPortfolioValue(
  supabase: SupabaseClient,
  source: SignalSource,
  execType: ExecutionType
): Promise<{
  cash: number;
  holdings: PortfolioHolding[];
  total_value: number;
}> {
  const [cash, holdings] = await Promise.all([
    getPortfolioCash(supabase, source, execType),
    getHoldings(supabase, source, execType),
  ]);

  // 보유 종목의 현재 가격 일괄 조회 (stock_cache 현재가 우선, fallback: daily_prices 최신 종가)
  let holdingsValue = 0;
  if (holdings.length > 0) {
    const symbols = holdings.map((h) => h.symbol);

    // stock_cache에서 현재가 일괄 조회
    const { data: cacheRows } = await supabase
      .from('stock_cache')
      .select('symbol, current_price')
      .in('symbol', symbols);

    const priceMap = new Map<string, number>();
    for (const row of cacheRows ?? []) {
      if (row.current_price != null) {
        priceMap.set(row.symbol, row.current_price);
      }
    }

    // stock_cache에 없는 종목만 daily_prices에서 조회
    const missing = symbols.filter((s) => !priceMap.has(s));
    if (missing.length > 0) {
      const { data: priceRows } = await supabase
        .from('daily_prices')
        .select('symbol, close, date')
        .in('symbol', missing)
        .order('date', { ascending: false });

      // 종목별 최신 종가만 사용
      for (const row of priceRows ?? []) {
        if (!priceMap.has(row.symbol) && row.close != null) {
          priceMap.set(row.symbol, row.close);
        }
      }
    }

    for (const h of holdings) {
      const currentPrice = priceMap.get(h.symbol) ?? h.avg_price;
      h.current_price = currentPrice;
      holdingsValue += currentPrice * h.quantity;
    }
  }

  return {
    cash,
    holdings,
    total_value: cash + holdingsValue,
  };
}
