import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("stock_cache")
    .select("name, current_price, price_change, price_change_pct, per, pbr, roe, eps, bps, market_cap, high_52w, low_52w, dividend_yield, volume")
    .eq("symbol", symbol)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  });
}
