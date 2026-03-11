import { SupabaseClient } from '@supabase/supabase-js';
import type { Signal } from '@/types/signal';
import { PORTFOLIO_CONFIG, calculateQuantity } from './index';
import { getPortfolioCash, hasOpenPosition } from './portfolio';
import { v4 as uuidv4 } from 'uuid';

/**
 * 분할매매(split) 전략
 *
 * 매수: 1/3 즉시 + 1/3 D+1 시가 + 1/3 D+2 시가
 * 매도: 1/3 즉시 + 1/3 D+1 시가 + 1/3 D+2 시가
 */
export async function executeSplitTrade(
  supabase: SupabaseClient,
  signal: Signal,
  side: 'BUY' | 'SELL',
  price: number
): Promise<boolean> {
  const symbol = signal.symbol!;
  const source = signal.source;
  const splitCount = PORTFOLIO_CONFIG.SPLIT_COUNT;

  if (side === 'BUY') {
    const hasPos = await hasOpenPosition(supabase, source, 'split', symbol);
    if (hasPos) {
      console.log(`[split] Already holding ${symbol}, skip BUY`);
      return false;
    }

    const cash = await getPortfolioCash(supabase, source, 'split');
    const totalQty = calculateQuantity(cash, price, source);
    if (totalQty < splitCount) {
      console.log(`[split] Insufficient qty for split (${totalQty} < ${splitCount})`);
      return false;
    }

    const tradeGroupId = uuidv4();
    const qtyPerSplit = Math.floor(totalQty / splitCount);
    const remainder = totalQty - qtyPerSplit * splitCount;

    // 1회차: 즉시 매수
    const { error: tradeError } = await supabase.from('virtual_trades').insert({
      source,
      execution_type: 'split',
      symbol,
      name: signal.name,
      side: 'BUY',
      price,
      quantity: qtyPerSplit + remainder, // 나머지는 1회차에 포함
      split_seq: 1,
      signal_id: signal.id,
      trade_group_id: tradeGroupId,
      note: `분할매수 1/${splitCount}`,
    });

    if (tradeError) {
      console.error(`[split] BUY 1st insert failed:`, tradeError);
      return false;
    }

    // 2회차, 3회차: 예약 등록
    const today = new Date();
    for (let seq = 2; seq <= splitCount; seq++) {
      const schedDate = new Date(today);
      schedDate.setDate(schedDate.getDate() + (seq - 1));
      // 주말 건너뛰기
      while (schedDate.getDay() === 0 || schedDate.getDay() === 6) {
        schedDate.setDate(schedDate.getDate() + 1);
      }

      await supabase.from('split_trade_schedule').insert({
        trade_group_id: tradeGroupId,
        source,
        symbol,
        side: 'BUY',
        quantity: qtyPerSplit,
        scheduled_date: schedDate.toISOString().slice(0, 10),
        split_seq: seq,
        status: 'pending',
        signal_id: signal.id,
      });
    }

    console.log(`[split] BUY ${symbol}: 1st=${qtyPerSplit + remainder}@${price}, scheduled ${splitCount - 1} more`);
    return true;
  }

  if (side === 'SELL') {
    // 보유 수량 조회
    const netQty = await getNetQuantity(supabase, source, 'split', symbol);
    if (netQty <= 0) {
      console.log(`[split] No position in ${symbol}, skip SELL`);
      return false;
    }

    const tradeGroupId = uuidv4();
    const qtyPerSplit = Math.floor(netQty / splitCount);
    const remainder = netQty - qtyPerSplit * splitCount;

    if (qtyPerSplit <= 0) {
      // 수량이 분할 불가 → 전량 즉시 매도
      await supabase.from('virtual_trades').insert({
        source,
        execution_type: 'split',
        symbol,
        name: signal.name,
        side: 'SELL',
        price,
        quantity: netQty,
        split_seq: 1,
        signal_id: signal.id,
        trade_group_id: tradeGroupId,
        note: `분할매도(전량) - 수량부족`,
      });
      return true;
    }

    // 1회차: 즉시 매도
    await supabase.from('virtual_trades').insert({
      source,
      execution_type: 'split',
      symbol,
      name: signal.name,
      side: 'SELL',
      price,
      quantity: qtyPerSplit + remainder,
      split_seq: 1,
      signal_id: signal.id,
      trade_group_id: tradeGroupId,
      note: `분할매도 1/${splitCount}`,
    });

    // 2회차, 3회차: 예약
    const today = new Date();
    for (let seq = 2; seq <= splitCount; seq++) {
      const schedDate = new Date(today);
      schedDate.setDate(schedDate.getDate() + (seq - 1));
      while (schedDate.getDay() === 0 || schedDate.getDay() === 6) {
        schedDate.setDate(schedDate.getDate() + 1);
      }

      await supabase.from('split_trade_schedule').insert({
        trade_group_id: tradeGroupId,
        source,
        symbol,
        side: 'SELL',
        quantity: qtyPerSplit,
        scheduled_date: schedDate.toISOString().slice(0, 10),
        split_seq: seq,
        status: 'pending',
        signal_id: signal.id,
      });
    }

    console.log(`[split] SELL ${symbol}: 1st=${qtyPerSplit + remainder}@${price}, scheduled ${splitCount - 1} more`);
    return true;
  }

  return false;
}

async function getNetQuantity(
  supabase: SupabaseClient,
  source: string,
  execType: string,
  symbol: string
): Promise<number> {
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
  return buyQty - sellQty;
}
