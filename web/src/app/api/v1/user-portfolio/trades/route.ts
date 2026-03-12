import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);
  const portfolioId = searchParams.get("portfolio_id");
  const symbol = searchParams.get("symbol");

  let query = supabase
    .from("user_trades")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (portfolioId) query = query.eq("portfolio_id", portfolioId);
  if (symbol) query = query.eq("symbol", symbol);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trades: data });
}

export async function POST(request: Request) {
  const supabase = createServiceClient();
  const body = await request.json();
  const { portfolio_id, symbol, name, side, price, target_price, stop_price, buy_trade_id, note } = body;

  if (!portfolio_id || !symbol || !side || !price) {
    return NextResponse.json(
      { error: "portfolio_id, symbol, side, price는 필수입니다" },
      { status: 400 }
    );
  }

  if (!["BUY", "SELL"].includes(side)) {
    return NextResponse.json({ error: "side는 BUY 또는 SELL이어야 합니다" }, { status: 400 });
  }

  if (side === "SELL") {
    if (!buy_trade_id) {
      return NextResponse.json(
        { error: "매도 시 buy_trade_id가 필요합니다" },
        { status: 400 }
      );
    }

    const { data: buyTrade } = await supabase
      .from("user_trades")
      .select("id, portfolio_id, symbol")
      .eq("id", buy_trade_id)
      .eq("side", "BUY")
      .single();

    if (!buyTrade) {
      return NextResponse.json({ error: "유효하지 않은 매수 거래입니다" }, { status: 400 });
    }

    const { data: existingSell } = await supabase
      .from("user_trades")
      .select("id")
      .eq("buy_trade_id", buy_trade_id)
      .eq("side", "SELL")
      .single();

    if (existingSell) {
      return NextResponse.json({ error: "이미 매도 완료된 거래입니다" }, { status: 409 });
    }
  }

  const insertData: Record<string, unknown> = {
    portfolio_id,
    symbol,
    name,
    side,
    price,
  };
  if (side === "BUY") {
    if (target_price) insertData.target_price = target_price;
    if (stop_price) insertData.stop_price = stop_price;
  }
  if (side === "SELL") {
    insertData.buy_trade_id = buy_trade_id;
  }
  if (note) insertData.note = note;

  const { data, error } = await supabase
    .from("user_trades")
    .insert(insertData)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trade: data }, { status: 201 });
}
