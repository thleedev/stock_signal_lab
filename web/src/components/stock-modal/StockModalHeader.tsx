"use client";

interface Portfolio {
  id: string;
  name: string;
}

interface Group {
  id: string;
  name: string;
}

interface Props {
  symbol: string;
  name: string;
  currentPrice: number;
  changeAmount: number;
  changePct: number;
  portfolios: Portfolio[];   // 이 종목이 속한 포트폴리오 목록
  groups: Group[];           // 이 종목이 속한 관심그룹 목록
  onClose: () => void;
}

export function StockModalHeader({
  symbol, name, currentPrice, changeAmount, changePct,
  portfolios, groups, onClose,
}: Props) {
  const isUp = changeAmount >= 0;

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="sticky top-0 z-10 bg-[var(--card)] border-b border-[var(--border)] px-6 py-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-bold">{name}</h2>
            <span className="text-sm text-[var(--muted)]">{symbol}</span>
          </div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold">
              {currentPrice.toLocaleString()}원
            </span>
            <span className={`text-sm font-medium ${isUp ? "text-red-500" : "text-blue-500"}`}>
              {isUp ? "▲" : "▼"} {Math.abs(changeAmount).toLocaleString()}
              ({isUp ? "+" : ""}{changePct.toFixed(2)}%)
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[var(--muted)]/20 text-[var(--muted)] text-xl leading-none"
          aria-label="닫기"
        >
          ×
        </button>
      </div>

      {/* 배지 영역 */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[var(--muted)] shrink-0">포트폴리오:</span>
          {portfolios.length === 0 ? (
            <span className="text-[var(--muted)]">없음</span>
          ) : (
            portfolios.map((p) => (
              <button
                key={p.id}
                onClick={() => scrollTo("portfolio-section")}
                className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 hover:opacity-80 text-xs"
              >
                {p.name}
              </button>
            ))
          )}
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[var(--muted)] shrink-0">관심그룹:</span>
          {groups.length === 0 ? (
            <span className="text-[var(--muted)]">없음</span>
          ) : (
            groups.map((g) => (
              <button
                key={g.id}
                onClick={() => scrollTo("group-section")}
                className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 hover:opacity-80 text-xs"
              >
                {g.name}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
