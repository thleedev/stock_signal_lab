import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fetchNaverDailyPrices } from "@/lib/naver-stock-api";

const SYMBOL_PATTERN = /^\d{5,6}[A-Z0-9]*$/i;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;

  if (!SYMBOL_PATTERN.test(symbol)) {
    return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: prices, error } = await supabase
    .from("daily_prices")
    .select("date, open, high, low, close, volume")
    .eq("symbol", symbol)
    .order("date", { ascending: false })
    .limit(90);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (prices && prices.length > 0) {
    return NextResponse.json(prices);
  }

  // Naver fallback only when Supabase returned no rows
  const naverPrices = await fetchNaverDailyPrices(symbol, 90);
  return NextResponse.json(naverPrices ?? []);
}
