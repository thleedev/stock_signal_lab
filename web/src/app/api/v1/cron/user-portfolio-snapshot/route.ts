import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  // CRON 인증
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const today = new Date().toISOString().split("T")[0];

  // 1. 활성 포트 목록
  const { data: portfolios } = await supabase
    .from("user_portfolios")
    .select("id")
    .is("deleted_at", null)
    .eq("is_default", false);

  if (!portfolios || portfolios.length === 0) {
    return NextResponse.json({ message: "No portfolios", snapshots: 0 });
  }

  const snapshots = [];

  for (const port of portfolios) {
    // 2. 미청산 BUY 조회
    const { data: buys } = await supabase
      .from("user_trades")
      .select("id, symbol, price")
      .eq("portfolio_id", port.id)
      .eq("side", "BUY");

    const { data: sells } = await supabase
      .from("user_trades")
      .select("buy_trade_id")
      .eq("side", "SELL")
      .not("buy_trade_id", "is", null);

    const soldIds = new Set((sells ?? []).map((s: { buy_trade_id: number }) => s.buy_trade_id));
    const openBuys = (buys ?? []).filter((b: { id: number }) => !soldIds.has(b.id));

    if (openBuys.length === 0) continue;

    // 3. 현재가 조회
    const symbols = [...new Set(openBuys.map((b: { symbol: string }) => b.symbol))];
    const { data: cacheData } = await supabase
      .from("stock_cache")
      .select("symbol, current_price")
      .in("symbol", symbols);

    const priceMap = new Map<string, number>();
    for (const c of cacheData ?? []) {
      if (c.current_price) priceMap.set(c.symbol, Number(c.current_price));
    }

    // 4. 수익률 계산
    const returns = openBuys.map((b: { symbol: string; price: number }) => {
      const cp = priceMap.get(b.symbol) ?? b.price;
      return ((cp - b.price) / b.price) * 100;
    });
    const avgReturn = returns.reduce((a: number, b: number) => a + b, 0) / returns.length;

    // 전일 스냅샷 조회 (daily_return 계산용)
    const { data: prevSnap } = await supabase
      .from("user_portfolio_snapshots")
      .select("cumulative_return_pct")
      .eq("portfolio_id", port.id)
      .lt("date", today)
      .order("date", { ascending: false })
      .limit(1)
      .single();

    const prevCumulative = prevSnap?.cumulative_return_pct ?? 0;
    const dailyReturn = avgReturn - Number(prevCumulative);

    // 전체 거래 수
    const { count: tradeCount } = await supabase
      .from("user_trades")
      .select("id", { count: "exact", head: true })
      .eq("portfolio_id", port.id);

    snapshots.push({
      portfolio_id: port.id,
      date: today,
      daily_return_pct: Math.round(dailyReturn * 100) / 100,
      cumulative_return_pct: Math.round(avgReturn * 100) / 100,
      holding_count: openBuys.length,
      trade_count: tradeCount ?? 0,
    });
  }

  // 5. 스냅샷 upsert
  if (snapshots.length > 0) {
    const { error } = await supabase
      .from("user_portfolio_snapshots")
      .upsert(snapshots, { onConflict: "portfolio_id,date" });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true, snapshots: snapshots.length });
}
