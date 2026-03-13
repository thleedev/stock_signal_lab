import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fetchNaverDailyPrices } from "@/lib/naver-stock-api";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const supabase = createServiceClient();

  const { data: prices } = await supabase
    .from("daily_prices")
    .select("date, open, high, low, close, volume")
    .eq("symbol", symbol)
    .order("date", { ascending: false })
    .limit(90);

  if (prices && prices.length > 0) {
    return NextResponse.json(prices);
  }

  const naverPrices = await fetchNaverDailyPrices(symbol, 90);
  return NextResponse.json(naverPrices ?? []);
}
