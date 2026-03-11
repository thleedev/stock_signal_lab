import { SupabaseClient } from '@supabase/supabase-js';
import type { Signal, SignalSource } from '@/types/signal';
import { executeLumpTrade } from './lump-strategy';
import { executeSplitTrade } from './split-strategy';

/**
 * 전략 엔진 진입점
 *
 * 신호 수신 시 호출되어 일시/분할 매매를 동시 시뮬레이션
 *
 * 라씨매매: 즐겨찾기 종목만 전략 진입
 * 스톡봇/퀀트: 전 종목 자동 진입
 */

// 포트폴리오 초기 설정
export const PORTFOLIO_CONFIG = {
  INITIAL_CASH_PER_SOURCE: 10_000_000,  // AI별 1천만원
  CASH_PER_STRATEGY: 5_000_000,         // 전략별 500만원
  MAX_POSITION_RATIO: 0.20,             // 종목당 최대 20%
  SPLIT_COUNT: 3,                       // 분할 횟수
};

export async function processSignal(
  supabase: SupabaseClient,
  signal: Signal
): Promise<{ lump: boolean; split: boolean }> {
  if (!signal.symbol) {
    return { lump: false, split: false };
  }

  // 라씨매매: 즐겨찾기 체크
  if (signal.source === 'lassi') {
    const { data: fav } = await supabase
      .from('favorite_stocks')
      .select('symbol')
      .eq('symbol', signal.symbol)
      .single();

    if (!fav) {
      console.log(`[engine] ${signal.symbol} not in favorites, skipping`);
      return { lump: false, split: false };
    }
  }

  // 매수/매도 신호만 처리
  const side = getTradeDirection(signal);
  if (!side) {
    console.log(`[engine] ${signal.signal_type} - no trade action`);
    return { lump: false, split: false };
  }

  const price = getSignalPrice(signal);
  if (!price) {
    console.log(`[engine] No price for ${signal.symbol}`);
    return { lump: false, split: false };
  }

  // 일시매매 + 분할매매 동시 실행
  const lump = await executeLumpTrade(supabase, signal, side, price);
  const split = await executeSplitTrade(supabase, signal, side, price);

  return { lump, split };
}

/**
 * 신호 타입에서 매매 방향 결정
 */
function getTradeDirection(signal: Signal): 'BUY' | 'SELL' | null {
  switch (signal.signal_type) {
    case 'BUY':
    case 'BUY_FORECAST':
      return 'BUY';
    case 'SELL':
    case 'SELL_COMPLETE':
      return 'SELL';
    case 'HOLD':
      return null;
    default:
      return null;
  }
}

/**
 * 신호에서 가격 추출
 *
 * 소스별 raw_data 필드:
 *   스톡봇: recommend_price
 *   퀀트 매수완료: buy_price, signal_price
 *   퀀트 매도완료: sell_price, signal_price
 *   공통: signal_price (buildRawData에서 자동 병합)
 */
function getSignalPrice(signal: Signal): number | null {
  const raw = signal.raw_data;

  // 1) raw_data.signal_price (모든 소스 공통 — Android buildRawData에서 병합)
  const signalPrice = raw?.signal_price as number | undefined;
  if (signalPrice && signalPrice > 0) return signalPrice;

  // 2) 스톡봇: recommend_price
  const recPrice = raw?.recommend_price as number | undefined;
  if (recPrice && recPrice > 0) return recPrice;

  // 3) 퀀트: buy_price (매수완료 시)
  const buyPrice = raw?.buy_price as number | undefined;
  if (buyPrice && buyPrice > 0) return buyPrice;

  // 4) 퀀트: sell_price (매도완료 시)
  const sellPrice = raw?.sell_price as number | undefined;
  if (sellPrice && sellPrice > 0) return sellPrice;

  // 5) 일반 price / current_price (범용 폴백)
  const price = raw?.price as number | undefined;
  if (price && price > 0) return price;

  const currentPrice = raw?.current_price as number | undefined;
  if (currentPrice && currentPrice > 0) return currentPrice;

  return null;
}

/**
 * 매수 수량 계산
 */
export function calculateQuantity(
  availableCash: number,
  price: number,
  source: SignalSource
): number {
  const maxAmount = PORTFOLIO_CONFIG.CASH_PER_STRATEGY * PORTFOLIO_CONFIG.MAX_POSITION_RATIO;
  const investAmount = Math.min(availableCash, maxAmount);
  return Math.floor(investAmount / price);
}
