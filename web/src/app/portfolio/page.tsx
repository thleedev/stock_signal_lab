import Link from "next/link";
import { createServiceClient } from "@/lib/supabase";
import { PageLayout, PageHeader } from "@/components/ui";
import { PORTFOLIO_CONFIG } from "@/lib/strategy-engine";
import { StockLinkButton } from "./stock-link-button";
import { SOURCE_CARD_COLORS, SOURCE_DOTS, SOURCE_LABELS } from "@/lib/signal-constants";

/** SOURCE_CARD_COLORS를 기존 SOURCE_META 형태로 매핑 */
const SOURCE_META = Object.fromEntries(
  Object.entries(SOURCE_CARD_COLORS).map(([k, v]) => [k, { label: SOURCE_LABELS[k] ?? k, color: v.card, borderColor: v.borderColor }])
) as Record<string, { label: string; color: string; borderColor: string }>;

const SOURCE_DOT = SOURCE_DOTS;

interface HoldingStock {
  symbol: string;
  name: string;
  price: number;
  quantity: number;
  source: string;
  created_at: string;
}

export const dynamic = 'force-dynamic';

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const params = await searchParams;
  const execType = params.type === "split" ? "split" : "lump";
  const supabase = createServiceClient();

  const d30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  // 모든 쿼리 병렬 실행
  const [
    { data: snapshots },
    { data: combined },
    { data: history },
    { data: allTrades },
  ] = await Promise.all([
    supabase.from("portfolio_snapshots").select("*")
      .eq("execution_type", execType).order("date", { ascending: false }).limit(3),
    supabase.from("combined_portfolio_snapshots").select("*")
      .eq("execution_type", execType).order("date", { ascending: false }).limit(1).single(),
    supabase.from("combined_portfolio_snapshots")
      .select("date, total_value, daily_return_pct, cumulative_return_pct")
      .eq("execution_type", execType).gte("date", d30).order("date", { ascending: true }),
    supabase.from("virtual_trades")
      .select("symbol, name, side, source, price, quantity, created_at")
      .in("source", ["lassi", "stockbot", "quant"]).order("created_at", { ascending: false }),
  ]);

  const totalInitial = PORTFOLIO_CONFIG.CASH_PER_STRATEGY * 3;
  const totalValue = combined?.total_value ?? totalInitial;
  const cumReturn = combined?.cumulative_return_pct ?? 0;
  const dailyReturn = combined?.daily_return_pct ?? 0;

  // 소스별 최신 데이터
  const bySource: Record<string, {
    total_value: number;
    cash: number;
    holdings: Array<{ symbol: string; name: string; quantity: number; avg_price: number }>;
    cumulative_return_pct: number;
  }> = {};

  for (const snap of snapshots ?? []) {
    if (!bySource[snap.source]) {
      bySource[snap.source] = snap;
    }
  }

  // 소스별로 가장 최근 거래가 BUY인 종목 = 현재 보유 중
  const holdingsBySource: Record<string, HoldingStock[]> = {
    lassi: [],
    stockbot: [],
    quant: [],
  };

  if (allTrades) {
    const seen = new Set<string>(); // "source:symbol" dedup
    for (const trade of allTrades) {
      const key = `${trade.source}:${trade.symbol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // 가장 최근 거래가 BUY이면 보유 중
      if (trade.side === "BUY") {
        holdingsBySource[trade.source]?.push({
          symbol: trade.symbol,
          name: trade.name,
          price: trade.price,
          quantity: trade.quantity,
          source: trade.source,
          created_at: trade.created_at,
        });
      }
    }
  }

  return (
    <PageLayout>
      <PageHeader title="AI 포트폴리오" subtitle="3개 AI 합산 성과" />

      {/* 전략 탭 */}
      <div className="flex gap-2">
        {[
          { key: "lump", label: "일시매매" },
          { key: "split", label: "분할매매" },
        ].map((t) => (
          <Link
            key={t.key}
            href={`/portfolio?type=${t.key}`}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              execType === t.key
                ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                : "bg-[var(--card)] text-[var(--muted)] border-[var(--border)] hover:bg-[var(--card-hover)]"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* 총 평가액 */}
      <div className="card p-6">
        <div className="text-sm text-[var(--muted)]">총 평가액</div>
        <div className="text-4xl font-bold mt-1">
          {totalValue.toLocaleString()}원
        </div>
        <div className="flex gap-4 mt-2">
          <span className={`text-sm font-medium ${cumReturn >= 0 ? "price-up" : "price-down"}`}>
            누적 {cumReturn >= 0 ? "+" : ""}{cumReturn}%
          </span>
          <span className={`text-sm ${dailyReturn >= 0 ? "price-up" : "price-down"}`}>
            오늘 {dailyReturn >= 0 ? "+" : ""}{dailyReturn}%
          </span>
        </div>
      </div>

      {/* 수익률 히스토리 (간단 바 차트) */}
      {history && history.length > 0 && (
        <div className="card p-4">
          <h2 className="font-semibold mb-3">일별 수익률 추이</h2>
          <div className="flex items-end gap-1 h-32">
            {history.map((h) => {
              const val = h.cumulative_return_pct ?? 0;
              const maxAbs = Math.max(...history.map((x) => Math.abs(x.cumulative_return_pct ?? 0)), 1);
              const height = Math.abs(val) / maxAbs * 100;
              return (
                <div key={h.date} className="flex-1 flex flex-col items-center justify-end h-full" title={`${h.date}: ${val}%`}>
                  <div
                    className={`w-full rounded-t ${val >= 0 ? "bg-red-400" : "bg-blue-400"}`}
                    style={{ height: `${Math.max(height, 2)}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-xs text-[var(--muted)] mt-1">
            <span>{history[0]?.date}</span>
            <span>{history[history.length - 1]?.date}</span>
          </div>
        </div>
      )}

      {/* AI별 성과 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(["lassi", "stockbot", "quant"] as const).map((src) => {
          const meta = SOURCE_META[src];
          const data = bySource[src];
          const value = data?.total_value ?? PORTFOLIO_CONFIG.CASH_PER_STRATEGY;
          const ret = data?.cumulative_return_pct ?? 0;
          const holdingsCount = data?.holdings?.length ?? 0;

          return (
            <Link
              key={src}
              href={`/portfolio/${src}?type=${execType}`}
              className={`rounded-lg border p-4 ${meta.color} hover:shadow-md transition-shadow`}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className={`w-2.5 h-2.5 rounded-full ${SOURCE_DOT[src]}`} />
                {meta.label}
              </div>
              <div className="text-2xl font-bold mt-2">
                {value.toLocaleString()}원
              </div>
              <div className={`text-sm font-medium mt-1 ${ret >= 0 ? "price-up" : "price-down"}`}>
                {ret >= 0 ? "+" : ""}{ret}%
              </div>
              <div className="text-xs text-[var(--muted)] mt-1">
                보유 {holdingsCount}종목 · 현금 {(data?.cash ?? PORTFOLIO_CONFIG.CASH_PER_STRATEGY).toLocaleString()}원
              </div>
            </Link>
          );
        })}
      </div>

      {/* AI별 보유 종목 상세 */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold">AI별 보유 종목</h2>
        {(["lassi", "stockbot", "quant"] as const).map((src) => {
          const meta = SOURCE_META[src];
          const holdings = holdingsBySource[src] ?? [];

          return (
            <div key={src} className={`card border ${meta.color} overflow-hidden`}>
              <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${SOURCE_DOT[src]}`} />
                <h3 className="font-semibold text-sm">{meta.label}</h3>
                <span className="text-xs text-[var(--muted)] ml-auto">
                  {holdings.length}종목 보유
                </span>
              </div>

              {holdings.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-[var(--muted)]">
                  현재 보유 중인 종목이 없습니다
                </div>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {holdings.map((h) => (
                    <StockLinkButton
                      key={`${src}-${h.symbol}`}
                      symbol={h.symbol}
                      name={h.name}
                      quantity={h.quantity}
                      price={h.price}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </PageLayout>
  );
}
