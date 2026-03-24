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
    .select("id, portfolio_id, symbol, name, side, price, target_price, stop_price, buy_trade_id, note, created_at")
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

export async function PATCH(request: Request) {
  const supabase = createServiceClient();
  const body = await request.json();
  const { trade_id, target_price, stop_price, portfolio_id } = body;

  if (!trade_id) {
    return NextResponse.json({ error: "trade_id는 필수입니다" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (target_price !== undefined) update.target_price = target_price;
  if (stop_price !== undefined) update.stop_price = stop_price;
  if (portfolio_id !== undefined) update.portfolio_id = portfolio_id;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "변경할 필드가 없습니다" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("user_trades")
    .update(update)
    .eq("id", trade_id)
    .eq("side", "BUY")
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trade: data });
}

export async function DELETE(request: Request) {
  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);
  const tradeId = searchParams.get("trade_id");

  if (!tradeId) {
    return NextResponse.json({ error: "trade_id는 필수입니다" }, { status: 400 });
  }

  // BUY 거래만 삭제 가능 (매도 기록이 없는 경우만)
  const { data: buyTrade } = await supabase
    .from("user_trades")
    .select("id")
    .eq("id", tradeId)
    .eq("side", "BUY")
    .single();

  if (!buyTrade) {
    return NextResponse.json({ error: "유효하지 않은 매수 거래입니다" }, { status: 400 });
  }

  const { data: existingSell } = await supabase
    .from("user_trades")
    .select("id")
    .eq("buy_trade_id", tradeId)
    .eq("side", "SELL")
    .single();

  if (existingSell) {
    return NextResponse.json({ error: "이미 매도 완료된 거래는 삭제할 수 없습니다" }, { status: 409 });
  }

  const { error } = await supabase
    .from("user_trades")
    .delete()
    .eq("id", tradeId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
