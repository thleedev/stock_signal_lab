// web/src/app/api/v1/user-portfolio/summary/route.ts
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createServiceClient();

  // user_portfolios 목록 조회
  const { data: portfolios, error: pErr } = await supabase
    .from("user_portfolios")
    .select("id, name, sort_order")
    .order("sort_order", { ascending: true });

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }

  // user_trades 중 SELL 없이 남은 BUY (오픈 포지션) 조회
  const { data: openBuys, error: tErr } = await supabase
    .from("user_trades")
    .select("id, portfolio_id, side")
    .eq("side", "BUY");

  if (tErr) {
    return NextResponse.json({ error: tErr.message }, { status: 500 });
  }

  // 매도 완료된 trade_id 조회
  const { data: sells, error: sErr } = await supabase
    .from("user_trades")
    .select("buy_trade_id")
    .eq("side", "SELL");

  if (sErr) {
    return NextResponse.json({ error: sErr.message }, { status: 500 });
  }

  const soldIds = new Set((sells ?? []).map((s) => s.buy_trade_id));
  const openTrades = (openBuys ?? []).filter((t) => !soldIds.has(t.id));

  // 포트폴리오별 집계
  const byPortfolio: Record<number, number> = {};
  for (const trade of openTrades) {
    byPortfolio[trade.portfolio_id] = (byPortfolio[trade.portfolio_id] ?? 0) + 1;
  }

  const portfolioSummary = (portfolios ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    count: byPortfolio[p.id] ?? 0,
  }));

  return NextResponse.json({
    total_count: openTrades.length,
    portfolio_count: (portfolios ?? []).length,
    portfolios: portfolioSummary,
  });
}
