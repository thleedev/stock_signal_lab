import Link from "next/link";
import { createServiceClient } from "@/lib/supabase";
import { PORTFOLIO_CONFIG } from "@/lib/strategy-engine";

const SOURCE_META: Record<string, { label: string; color: string }> = {
  lassi: { label: "🔴 라씨매매", color: "text-red-400" },
  stockbot: { label: "🟢 스톡봇", color: "text-green-400" },
  quant: { label: "🔵 퀀트", color: "text-blue-400" },
};

export const dynamic = "force-dynamic";

export default async function SourcePortfolioPage({
  params,
  searchParams,
}: {
  params: Promise<{ source: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { source } = await params;
  const sp = await searchParams;
  const execType = sp.type === "split" ? "split" : "lump";
  const meta = SOURCE_META[source] ?? { label: source, color: "" };
  const supabase = createServiceClient();

  // 최신 스냅샷 (일시 + 분할)
  const { data: lumpSnap } = await supabase
    .from("portfolio_snapshots")
    .select("*")
    .eq("source", source)
    .eq("execution_type", "lump")
    .order("date", { ascending: false })
    .limit(1)
    .single();

  const { data: splitSnap } = await supabase
    .from("portfolio_snapshots")
    .select("*")
    .eq("source", source)
    .eq("execution_type", "split")
    .order("date", { ascending: false })
    .limit(1)
    .single();

  // 현재 선택된 전략의 보유 종목
  const activeSnap = execType === "split" ? splitSnap : lumpSnap;
  const holdings = activeSnap?.holdings ?? [];
  const cash = activeSnap?.cash ?? PORTFOLIO_CONFIG.CASH_PER_STRATEGY;
  const totalValue = activeSnap?.total_value ?? PORTFOLIO_CONFIG.CASH_PER_STRATEGY;

  // 최근 거래 내역
  const { data: recentTrades } = await supabase
    .from("virtual_trades")
    .select("*")
    .eq("source", source)
    .eq("execution_type", execType)
    .order("created_at", { ascending: false })
    .limit(20);

  // 라씨매매: 즐겨찾기 목록
  let favorites: string[] = [];
  if (source === "lassi") {
    const { data: favs } = await supabase
      .from("favorite_stocks")
      .select("symbol, name");
    favorites = favs?.map((f) => `${f.name}(${f.symbol})`) ?? [];
  }

  // 히스토리 (30일)
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const { data: history } = await supabase
    .from("portfolio_snapshots")
    .select("date, execution_type, total_value, cumulative_return_pct")
    .eq("source", source)
    .gte("date", d30)
    .order("date", { ascending: true });

  const lumpHistory = history?.filter((h) => h.execution_type === "lump") ?? [];
  const splitHistory = history?.filter((h) => h.execution_type === "split") ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/portfolio" className="text-[var(--muted)] hover:text-[var(--foreground)]">&larr;</Link>
        <div>
          <h1 className="text-2xl font-bold">{meta.label} 포트폴리오</h1>
          {source === "lassi" && (
            <p className="text-xs text-[var(--muted)] mt-1">⭐ 즐겨찾기 종목만 추적</p>
          )}
        </div>
      </div>

      {/* 전략 탭 */}
      <div className="flex gap-2">
        {[
          { key: "lump", label: "일시매매" },
          { key: "split", label: "분할매매" },
        ].map((t) => (
          <a
            key={t.key}
            href={`/portfolio/${source}?type=${t.key}`}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              execType === t.key
                ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                : "bg-[var(--card)] text-[var(--muted)] border-[var(--border)] hover:bg-[var(--card-hover)]"
            }`}
          >
            {t.label}
          </a>
        ))}
      </div>

      {/* 일시 vs 분할 비교 카드 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { snap: lumpSnap, label: "일시매매", key: "lump" },
          { snap: splitSnap, label: "분할매매", key: "split" },
        ].map(({ snap, label, key }) => {
          const val = snap?.total_value ?? PORTFOLIO_CONFIG.CASH_PER_STRATEGY;
          const ret = snap?.cumulative_return_pct ?? 0;
          return (
            <div
              key={key}
              className={`rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 ${execType === key ? "ring-2 ring-[var(--accent)]" : ""}`}
            >
              <div className="text-sm font-medium text-[var(--muted)]">{label}</div>
              <div className="text-xl font-bold mt-1">{val.toLocaleString()}원</div>
              <div className={`text-sm font-medium ${ret >= 0 ? "price-up" : "price-down"}`}>
                {ret >= 0 ? "+" : ""}{ret}%
              </div>
              <div className="text-xs text-[var(--muted)] mt-1">
                보유 {snap?.holdings?.length ?? 0}종목
              </div>
            </div>
          );
        })}
      </div>

      {/* 즐겨찾기 관리 (라씨매매) */}
      {source === "lassi" && (
        <div className="bg-yellow-900/20 rounded-lg border border-yellow-800/50 p-4">
          <h3 className="text-sm font-medium">⭐ 즐겨찾기 종목 ({favorites.length}개)</h3>
          <p className="text-xs text-[var(--muted)] mt-1">
            {favorites.length > 0 ? favorites.join(", ") : "즐겨찾기한 종목이 없습니다"}
          </p>
        </div>
      )}

      {/* 보유 종목 */}
      <div className="card">
        <div className="p-4 border-b border-[var(--border)]">
          <h2 className="font-semibold">보유 종목</h2>
        </div>
        {holdings.length === 0 ? (
          <div className="p-8 text-center text-[var(--muted)]">보유 종목이 없습니다</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            <div className="px-4 py-2 grid grid-cols-5 text-xs text-[var(--muted)] font-medium">
              <span>종목</span>
              <span className="text-right">수량</span>
              <span className="text-right">평균단가</span>
              <span className="text-right">현재가</span>
              <span className="text-right">수익률</span>
            </div>
            {holdings.map((h: { symbol: string; name: string; quantity: number; avg_price: number; current_price?: number }) => {
              const curPrice = h.current_price ?? h.avg_price;
              const ret = ((curPrice - h.avg_price) / h.avg_price) * 100;
              return (
                <div key={h.symbol} className="px-4 py-3 grid grid-cols-5 items-center">
                  <div>
                    <Link href={`/stock/${h.symbol}`} className="font-medium text-sm hover:underline">{h.name}</Link>
                    <div className="text-xs text-[var(--muted)]">{h.symbol}</div>
                  </div>
                  <div className="text-right text-sm">{h.quantity}</div>
                  <div className="text-right text-sm">{h.avg_price.toLocaleString()}</div>
                  <div className="text-right text-sm">{curPrice.toLocaleString()}</div>
                  <div className={`text-right text-sm font-medium ${ret >= 0 ? "price-up" : "price-down"}`}>
                    {ret >= 0 ? "+" : ""}{ret.toFixed(1)}%
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 최근 거래 */}
      <div className="card">
        <div className="p-4 border-b border-[var(--border)]">
          <h2 className="font-semibold">최근 거래</h2>
        </div>
        {(recentTrades ?? []).length === 0 ? (
          <div className="p-8 text-center text-[var(--muted)]">거래 내역이 없습니다</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {(recentTrades ?? []).map((t) => (
              <div key={t.id} className="px-4 py-3 flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                  t.side === "BUY" ? "bg-red-900/30 text-red-400" : "bg-blue-900/30 text-blue-400"
                }`}>
                  {t.side === "BUY" ? "매수" : "매도"}
                </span>
                {t.split_seq && (
                  <span className="text-xs text-[var(--muted)]">{t.split_seq}회차</span>
                )}
                <span className="font-medium text-sm">{t.name ?? t.symbol}</span>
                <span className="text-sm">{t.quantity}주 × {t.price.toLocaleString()}원</span>
                <span className="ml-auto text-xs text-[var(--muted)]">
                  {new Date(t.created_at).toLocaleDateString("ko-KR")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
