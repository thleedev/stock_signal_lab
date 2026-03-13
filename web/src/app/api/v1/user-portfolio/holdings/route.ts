import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface HoldingRow {
  id: number;
  portfolio_id: number;
  symbol: string;
  name: string;
  price: number;
  target_price: number | null;
  stop_price: number | null;
  note: string | null;
  created_at: string;
}

interface SellRow {
  buy_trade_id: number;
  price: number;
}

function getStatus(
  currentPrice: number,
  targetPrice: number | null,
  stopPrice: number | null
): string {
  if (targetPrice && currentPrice >= targetPrice * 0.97) return "near_target";
  if (stopPrice && currentPrice <= stopPrice * 1.03) return "near_stop";
  return "holding";
}

export async function GET(request: Request) {
  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);
  const portfolioId = searchParams.get("portfolio_id");

  // 1. 미청산 BUY 조회
  let buyQuery = supabase
    .from("user_trades")
    .select("id, portfolio_id, symbol, name, price, target_price, stop_price, note, created_at")
    .eq("side", "BUY");

  if (portfolioId) {
    buyQuery = buyQuery.eq("portfolio_id", portfolioId);
  }

  const { data: allBuys, error: buyError } = await buyQuery;
  if (buyError) return NextResponse.json({ error: buyError.message }, { status: 500 });

  // 매도된 BUY ID 목록 + 매도가
  let sellQuery = supabase
    .from("user_trades")
    .select("buy_trade_id, price")
    .eq("side", "SELL")
    .not("buy_trade_id", "is", null);

  if (portfolioId) {
    sellQuery = sellQuery.eq("portfolio_id", portfolioId);
  }

  const { data: sells } = await sellQuery;

  const soldBuyIds = new Set((sells ?? []).map((s: SellRow) => s.buy_trade_id));

  // 완료 거래: (매수가, 매도가) 쌍 구성
  const completedTrades: Array<{ buyPrice: number; sellPrice: number }> = [];
  if ((sells ?? []).length > 0) {
    const soldBuyIdList = [...soldBuyIds];
    const { data: soldBuys } = await supabase
      .from("user_trades")
      .select("id, price")
      .in("id", soldBuyIdList);

    const buyPriceMap = new Map(
      (soldBuys ?? []).map((b: { id: number; price: number }) => [b.id, b.price])
    );

    for (const sell of sells ?? []) {
      const buyPrice = buyPriceMap.get(sell.buy_trade_id);
      if (buyPrice) {
        completedTrades.push({ buyPrice, sellPrice: Number(sell.price) });
      }
    }
  }
  const openBuys = (allBuys ?? []).filter((b: HoldingRow) => !soldBuyIds.has(b.id));

  if (openBuys.length === 0) {
    return NextResponse.json({
      holdings: [],
      summary: {
        current_return_pct: 0,
        total_return_pct: 0,
        holding_count: 0,
        completed_trade_count: soldBuyIds.size,
      },
    });
  }

  // 2. 현재가 조회 (stock_cache → daily_prices 폴백)
  const symbols = [...new Set(openBuys.map((b: HoldingRow) => b.symbol))];
  const { data: cacheData } = await supabase
    .from("stock_cache")
    .select("symbol, current_price, updated_at")
    .in("symbol", symbols);

  const priceMap = new Map<string, { price: number; asOf: string }>();
  for (const c of cacheData ?? []) {
    if (c.current_price) {
      priceMap.set(c.symbol, { price: Number(c.current_price), asOf: c.updated_at });
    }
  }

  const missingSymbols = symbols.filter((s: string) => !priceMap.has(s));
  if (missingSymbols.length > 0) {
    const { data: dpData } = await supabase
      .from("daily_prices")
      .select("symbol, close, date")
      .in("symbol", missingSymbols)
      .order("date", { ascending: false })
      .limit(missingSymbols.length * 30);

    const seen = new Set<string>();
    for (const dp of dpData ?? []) {
      if (!seen.has(dp.symbol)) {
        priceMap.set(dp.symbol, { price: Number(dp.close), asOf: dp.date });
        seen.add(dp.symbol);
      }
    }
  }

  // 3. AI 신호 조회 (timestamp 컬럼 사용!)
  const { data: signalsData } = await supabase
    .from("signals")
    .select("symbol, signal_type, source, timestamp")
    .in("symbol", symbols)
    .order("timestamp", { ascending: false })
    .limit(symbols.length * 3);

  const signalMap = new Map<string, { type: string; source: string; date: string }>();
  for (const sig of signalsData ?? []) {
    if (!signalMap.has(sig.symbol)) {
      signalMap.set(sig.symbol, {
        type: sig.signal_type,
        source: sig.source,
        date: sig.timestamp?.split("T")[0] ?? "",
      });
    }
  }

  // 4. 수익률 계산 및 응답 구성
  const holdings = openBuys.map((buy: HoldingRow) => {
    const current = priceMap.get(buy.symbol);
    const currentPrice = current?.price ?? buy.price;
    const returnPct = ((currentPrice - buy.price) / buy.price) * 100;
    const signal = signalMap.get(buy.symbol);

    return {
      trade_id: buy.id,
      portfolio_id: buy.portfolio_id,
      symbol: buy.symbol,
      name: buy.name,
      buy_price: buy.price,
      current_price: currentPrice,
      return_pct: Math.round(returnPct * 100) / 100,
      target_price: buy.target_price,
      stop_price: buy.stop_price,
      status: getStatus(currentPrice, buy.target_price, buy.stop_price),
      note: buy.note,
      bought_at: buy.created_at,
      price_as_of: current?.asOf ?? null,
      latest_signal: signal ?? null,
    };
  });

  // 현재수익률: 보유 종목 매수금액 가중 평균
  let currentReturnPct = 0;
  if (holdings.length > 0) {
    const totalBuy = holdings.reduce((sum: number, h: { buy_price: number }) => sum + h.buy_price, 0);
    const totalGain = holdings.reduce(
      (sum: number, h: { current_price: number; buy_price: number }) =>
        sum + (h.current_price - h.buy_price),
      0
    );
    currentReturnPct = totalBuy > 0 ? Math.round((totalGain / totalBuy) * 10000) / 100 : 0;
  }

  // 총수익률: 보유 + 완료 거래 매수금액 가중 평균
  let totalReturnPct = currentReturnPct;
  if (completedTrades.length > 0) {
    const openBuyTotal = holdings.reduce(
      (sum: number, h: { buy_price: number }) => sum + h.buy_price,
      0
    );
    const openGainTotal = holdings.reduce(
      (sum: number, h: { current_price: number; buy_price: number }) =>
        sum + (h.current_price - h.buy_price),
      0
    );
    const closedBuyTotal = completedTrades.reduce((sum, t) => sum + t.buyPrice, 0);
    const closedGainTotal = completedTrades.reduce((sum, t) => sum + (t.sellPrice - t.buyPrice), 0);

    const allBuyTotal = openBuyTotal + closedBuyTotal;
    totalReturnPct =
      allBuyTotal > 0
        ? Math.round(((openGainTotal + closedGainTotal) / allBuyTotal) * 10000) / 100
        : 0;
  }

  return NextResponse.json({
    holdings,
    summary: {
      current_return_pct: currentReturnPct,
      total_return_pct: totalReturnPct,
      holding_count: holdings.length,
      completed_trade_count: soldBuyIds.size,
    },
  });
}
