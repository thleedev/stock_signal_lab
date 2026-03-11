import Link from "next/link";
import { createServiceClient } from "@/lib/supabase";
import StockChartSection from "@/components/charts/stock-chart-section";

const SOURCE_COLORS: Record<string, string> = {
  lassi: "bg-red-900/30 text-red-400 border-red-800/50",
  stockbot: "bg-green-900/30 text-green-400 border-green-800/50",
  quant: "bg-blue-900/30 text-blue-400 border-blue-800/50",
};

const SOURCE_LABELS: Record<string, string> = {
  lassi: "라씨매매",
  stockbot: "스톡봇",
  quant: "퀀트",
};

const SIGNAL_TYPE_LABELS: Record<string, string> = {
  BUY: "매수",
  BUY_FORECAST: "매수예고",
  SELL: "매도",
  SELL_COMPLETE: "매도완료",
  HOLD: "보유중",
};

const PERIOD_OPTIONS = [
  { key: "30", label: "30일" },
  { key: "60", label: "60일" },
  { key: "90", label: "90일" },
];

export const dynamic = "force-dynamic";

export default async function StockDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { symbol } = await params;
  const sp = await searchParams;
  const period = ["30", "60", "90"].includes(sp.period ?? "") ? Number(sp.period) : 30;
  const supabase = createServiceClient();

  // 기간 계산
  const fromDate = new Date(Date.now() - period * 86400000).toISOString().slice(0, 10);

  // 일별 시세 조회
  const { data: prices } = await supabase
    .from("daily_prices")
    .select("date, open, high, low, close, volume")
    .eq("symbol", symbol)
    .gte("date", fromDate)
    .order("date", { ascending: true });

  // 신호 이력 조회
  const { data: signals } = await supabase
    .from("signals")
    .select("*")
    .eq("symbol", symbol)
    .order("timestamp", { ascending: false })
    .limit(50);

  // 가상 거래 이력 조회
  const { data: trades } = await supabase
    .from("virtual_trades")
    .select("*")
    .eq("symbol", symbol)
    .order("created_at", { ascending: false })
    .limit(30);

  // 투자지표 조회 (stock_cache)
  const { data: stockCache } = await supabase
    .from("stock_cache")
    .select("name, current_price, price_change, price_change_pct, per, pbr, roe, eps, bps, market_cap, high_52w, low_52w, dividend_yield, volume")
    .eq("symbol", symbol)
    .single();

  // 최신 가격 정보 (daily_prices 우선, 없으면 stock_cache 사용)
  const latestPrice = prices && prices.length > 0 ? prices[prices.length - 1] : null;
  const prevPrice = prices && prices.length > 1 ? prices[prices.length - 2] : null;

  let currentPrice: number | null = null;
  let priceChange = 0;
  let priceChangePct = "0.00";
  let priceDate = "";

  if (latestPrice) {
    currentPrice = latestPrice.close;
    priceChange = prevPrice ? latestPrice.close - prevPrice.close : 0;
    priceChangePct = prevPrice && prevPrice.close > 0
      ? ((priceChange / prevPrice.close) * 100).toFixed(2)
      : "0.00";
    priceDate = latestPrice.date;
  } else if (stockCache?.current_price) {
    currentPrice = stockCache.current_price;
    priceChange = stockCache.price_change ?? 0;
    priceChangePct = stockCache.price_change_pct?.toFixed(2) ?? "0.00";
    priceDate = "stock_cache";
  }

  // 종목명 (stock_cache 우선)
  const stockName = stockCache?.name ?? signals?.[0]?.name ?? trades?.[0]?.name ?? symbol;

  const priceList = prices ?? [];

  // 신호 날짜 (차트 마커용)
  const signalDates = (signals ?? []).map((s: Record<string, string>) => s.timestamp?.slice(0, 10)).filter(Boolean);

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <Link
          href="/stocks"
          className="text-[var(--muted)] hover:text-[var(--foreground)]"
        >
          &larr;
        </Link>
        <div className="flex-1">
          <div className="flex items-baseline gap-2">
            <h1 className="text-2xl font-bold">{stockName}</h1>
            <span className="text-sm text-[var(--muted)]">{symbol}</span>
          </div>
          {currentPrice && (
            <div className="flex items-baseline gap-3 mt-1">
              <span className="text-xl font-bold">
                {Number(currentPrice).toLocaleString()}원
              </span>
              <span
                className={`text-sm font-medium ${
                  priceChange >= 0 ? "price-up" : "price-down"
                }`}
              >
                {priceChange >= 0 ? "+" : ""}
                {priceChange.toLocaleString()}원 ({priceChange >= 0 ? "+" : ""}
                {priceChangePct}%)
              </span>
              {priceDate && (
                <span className="text-xs text-[var(--muted)]">
                  {priceDate === "stock_cache" ? "최근 시세" : `${priceDate} 기준`}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 기간 탭 */}
      <div className="flex gap-2">
        {PERIOD_OPTIONS.map((opt) => (
          <a
            key={opt.key}
            href={`/stock/${symbol}?period=${opt.key}`}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              String(period) === opt.key
                ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                : "bg-[var(--card)] text-[var(--muted)] border-[var(--border)] hover:bg-[var(--card-hover)]"
            }`}
          >
            {opt.label}
          </a>
        ))}
      </div>

      {/* 가격 차트 (TradingView lightweight-charts) */}
      <StockChartSection
        prices={priceList.map((p) => ({
          date: p.date,
          open: Number(p.open),
          high: Number(p.high),
          low: Number(p.low),
          close: Number(p.close),
          volume: Number(p.volume),
        }))}
        signalDates={signalDates}
      />

      {/* 투자지표 */}
      {stockCache && (
        <div className="card p-4">
          <h2 className="font-semibold mb-4">투자지표</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {[
              { label: "PER", value: stockCache.per != null ? stockCache.per.toFixed(1) : "-", unit: "배" },
              { label: "PBR", value: stockCache.pbr != null ? stockCache.pbr.toFixed(2) : "-", unit: "배" },
              { label: "ROE", value: stockCache.roe != null ? `${stockCache.roe.toFixed(1)}` : "-", unit: "%" },
              { label: "EPS", value: stockCache.eps != null ? Number(stockCache.eps).toLocaleString() : "-", unit: "원" },
              { label: "BPS", value: stockCache.bps != null ? Number(stockCache.bps).toLocaleString() : "-", unit: "원" },
              { label: "시가총액", value: stockCache.market_cap != null
                ? stockCache.market_cap >= 1_0000_0000_0000
                  ? `${(stockCache.market_cap / 1_0000_0000_0000).toFixed(1)}`
                  : stockCache.market_cap >= 1_0000_0000
                    ? `${(stockCache.market_cap / 1_0000_0000).toFixed(0)}`
                    : Number(stockCache.market_cap).toLocaleString()
                : "-",
                unit: stockCache.market_cap != null
                  ? stockCache.market_cap >= 1_0000_0000_0000 ? "조" : stockCache.market_cap >= 1_0000_0000 ? "억" : "원"
                  : "" },
              { label: "52주 최고", value: stockCache.high_52w != null ? Number(stockCache.high_52w).toLocaleString() : "-", unit: "원", color: "text-red-400" },
              { label: "52주 최저", value: stockCache.low_52w != null ? Number(stockCache.low_52w).toLocaleString() : "-", unit: "원", color: "text-blue-400" },
              { label: "배당수익률", value: stockCache.dividend_yield != null ? stockCache.dividend_yield.toFixed(2) : "-", unit: "%" },
              { label: "거래량", value: stockCache.volume != null ? Number(stockCache.volume).toLocaleString() : "-", unit: "주" },
            ].map((item) => (
              <div key={item.label} className="rounded-lg bg-[var(--background)] p-3">
                <div className="text-xs text-[var(--muted)] mb-1">{item.label}</div>
                <div className={`text-sm font-bold ${"color" in item && item.color ? item.color : ""}`}>
                  {item.value}
                  {item.value !== "-" && <span className="text-xs font-normal text-[var(--muted)] ml-0.5">{item.unit}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 신호 이력 */}
      <div className="card">
        <div className="p-4 border-b border-[var(--border)]">
          <h2 className="font-semibold">신호 이력</h2>
        </div>
        {(signals ?? []).length === 0 ? (
          <div className="p-8 text-center text-[var(--muted)]">
            신호 이력이 없습니다
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {(signals ?? []).map((s: Record<string, unknown>) => {
              const rd = s.raw_data as Record<string, number> | null;
              const sigPrice = rd?.signal_price || rd?.recommend_price || rd?.buy_range_low || rd?.sell_price || null;
              return (
                <div
                  key={s.id as string}
                  className="px-4 py-3 flex items-center gap-3 hover:bg-[var(--card-hover)] transition-colors"
                >
                  {/* 신호 타입 */}
                  <span
                    className={`text-xs px-2 py-0.5 rounded font-medium whitespace-nowrap ${
                      ["BUY", "BUY_FORECAST"].includes(s.signal_type as string)
                        ? "bg-red-900/30 text-red-400"
                        : "bg-blue-900/30 text-blue-400"
                    }`}
                  >
                    {SIGNAL_TYPE_LABELS[s.signal_type as string] || String(s.signal_type)}
                  </span>

                  {/* 소스 배지 */}
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded border whitespace-nowrap ${
                      SOURCE_COLORS[s.source as string] ?? ""
                    }`}
                  >
                    {SOURCE_LABELS[s.source as string] || String(s.source)}
                  </span>

                  {/* 가격 */}
                  {sigPrice && (
                    <span className="text-sm text-[var(--foreground)]">
                      {Number(sigPrice).toLocaleString()}원
                    </span>
                  )}

                  {/* 시간 */}
                  <span className="ml-auto text-xs text-[var(--muted)]">
                    {new Date(s.timestamp as string).toLocaleDateString("ko-KR")}{" "}
                    {new Date(s.timestamp as string).toLocaleTimeString("ko-KR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <div className="px-4 py-2 text-sm text-[var(--muted)] text-right border-t border-[var(--border)]">
          총 {(signals ?? []).length}건
        </div>
      </div>

      {/* 가상 거래 이력 */}
      <div className="card">
        <div className="p-4 border-b border-[var(--border)]">
          <h2 className="font-semibold">가상 거래 이력</h2>
        </div>
        {(trades ?? []).length === 0 ? (
          <div className="p-8 text-center text-[var(--muted)]">
            거래 이력이 없습니다
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {(trades ?? []).map(
              (t: Record<string, string | number | null>) => (
                <div
                  key={t.id as string}
                  className="px-4 py-3 flex items-center gap-3 hover:bg-[var(--card-hover)] transition-colors"
                >
                  {/* 매수/매도 */}
                  <span
                    className={`text-xs px-2 py-0.5 rounded font-medium ${
                      t.side === "BUY"
                        ? "bg-red-900/30 text-red-400"
                        : "bg-blue-900/30 text-blue-400"
                    }`}
                  >
                    {t.side === "BUY" ? "매수" : "매도"}
                  </span>

                  {/* 소스 배지 */}
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded border whitespace-nowrap ${
                      SOURCE_COLORS[t.source as string] ?? ""
                    }`}
                  >
                    {SOURCE_LABELS[t.source as string] || t.source}
                  </span>

                  {/* 분할 회차 */}
                  {t.split_seq && (
                    <span className="text-xs text-[var(--muted)]">
                      {t.split_seq}회차
                    </span>
                  )}

                  {/* 수량 x 가격 */}
                  <span className="text-sm">
                    {Number(t.quantity)}주 ×{" "}
                    {Number(t.price).toLocaleString()}원
                  </span>

                  {/* 날짜 */}
                  <span className="ml-auto text-xs text-[var(--muted)]">
                    {new Date(t.created_at as string).toLocaleDateString(
                      "ko-KR"
                    )}
                  </span>
                </div>
              )
            )}
          </div>
        )}
        <div className="px-4 py-2 text-sm text-[var(--muted)] text-right border-t border-[var(--border)]">
          총 {(trades ?? []).length}건
        </div>
      </div>

      {/* 네비게이션 링크 */}
      <div className="flex gap-3">
        <Link
          href="/portfolio"
          className="px-4 py-2 rounded-lg text-sm font-medium border border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:bg-[var(--card-hover)] transition-colors"
        >
          포트폴리오
        </Link>
        <Link
          href="/signals"
          className="px-4 py-2 rounded-lg text-sm font-medium border border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:bg-[var(--card-hover)] transition-colors"
        >
          신호 목록
        </Link>
      </div>
    </div>
  );
}
