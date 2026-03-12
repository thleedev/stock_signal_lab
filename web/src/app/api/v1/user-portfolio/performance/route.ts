import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);
  const portfolioId = searchParams.get("portfolio_id");
  const days = parseInt(searchParams.get("days") ?? "30", 10);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split("T")[0];

  let query = supabase
    .from("user_portfolio_snapshots")
    .select("portfolio_id, date, daily_return_pct, cumulative_return_pct, holding_count, trade_count")
    .gte("date", startDateStr)
    .order("date", { ascending: true });

  if (portfolioId) {
    query = query.eq("portfolio_id", portfolioId);
  }

  const { data: snapshots, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const grouped: Record<string, typeof snapshots> = {};
  for (const snap of snapshots ?? []) {
    const key = String(snap.portfolio_id);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(snap);
  }

  const { data: kospiData } = await supabase
    .from("daily_prices")
    .select("date, close")
    .eq("symbol", "KOSPI")
    .gte("date", startDateStr)
    .order("date", { ascending: true });

  let benchmark = null;
  if (kospiData && kospiData.length > 0) {
    const basePrice = Number(kospiData[0].close);
    benchmark = kospiData.map((d) => ({
      date: d.date,
      return_pct: Math.round(((Number(d.close) - basePrice) / basePrice) * 100 * 100) / 100,
    }));
  }

  return NextResponse.json({
    portfolios: grouped,
    benchmark,
    period_days: days,
  });
}
