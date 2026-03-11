import { SupabaseClient } from '@supabase/supabase-js';
import type { Signal } from '@/types/signal';
import { PORTFOLIO_CONFIG, calculateQuantity } from './index';
import { getPortfolioCash, hasOpenPosition } from './portfolio';

/**
 * 일시매매(lump) 전략
 *
 * 매수: 신호 가격에 전량 1회 매수
 * 매도: 신호 가격에 전량 1회 매도
 */
export async function executeLumpTrade(
  supabase: SupabaseClient,
  signal: Signal,
  side: 'BUY' | 'SELL',
  price: number
): Promise<boolean> {
  const symbol = signal.symbol!;
  const source = signal.source;

  if (side === 'BUY') {
    // 이미 보유 중이면 스킵
    const hasPos = await hasOpenPosition(supabase, source, 'lump', symbol);
    if (hasPos) {
      console.log(`[lump] Already holding ${symbol}, skip BUY`);
      return false;
    }

    // 가용 현금 확인
    const cash = await getPortfolioCash(supabase, source, 'lump');
    const quantity = calculateQuantity(cash, price, source);
    if (quantity <= 0) {
      console.log(`[lump] Insufficient cash for ${symbol} (cash=${cash}, price=${price})`);
      return false;
    }

    const { error } = await supabase.from('virtual_trades').insert({
      source,
      execution_type: 'lump',
      symbol,
      name: signal.name,
      side: 'BUY',
      price,
      quantity,
      signal_id: signal.id,
      note: `일시매수 ${signal.signal_type}`,
    });

    if (error) {
      console.error(`[lump] BUY insert failed:`, error);
      return false;
    }

    console.log(`[lump] BUY ${symbol} x${quantity} @ ${price}`);
    return true;
  }

  if (side === 'SELL') {
    // 보유 수량 조회
    const holdings = await getHoldings(supabase, source, 'lump', symbol);
    if (holdings.length === 0) {
      console.log(`[lump] No position in ${symbol}, skip SELL`);
      return false;
    }

    const totalQty = holdings.reduce((sum, h) => sum + h.quantity, 0);

    const { error } = await supabase.from('virtual_trades').insert({
      source,
      execution_type: 'lump',
      symbol,
      name: signal.name,
      side: 'SELL',
      price,
      quantity: totalQty,
      signal_id: signal.id,
      note: `일시매도 ${signal.signal_type}`,
    });

    if (error) {
      console.error(`[lump] SELL insert failed:`, error);
      return false;
    }

    console.log(`[lump] SELL ${symbol} x${totalQty} @ ${price}`);
    return true;
  }

  return false;
}

/**
 * 특정 종목의 미청산 매수 거래 조회
 */
async function getHoldings(
  supabase: SupabaseClient,
  source: string,
  execType: string,
  symbol: string
) {
  // 매수 총량 - 매도 총량 = 보유 수량
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
  const netQty = buyQty - sellQty;

  if (netQty <= 0) return [];
  return [{ quantity: netQty }];
}
