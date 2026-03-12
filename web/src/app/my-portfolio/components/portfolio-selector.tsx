"use client";

interface Portfolio {
  id: number;
  name: string;
  is_default: boolean;
}

interface Props {
  portfolios: Portfolio[];
  selectedId: number | null;
  onChange: (id: number) => void;
}

const COLORS = [
  "bg-red-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-sky-500",
  "bg-pink-500",
];

export function PortfolioSelector({ portfolios, selectedId, onChange }: Props) {
  // "전체" (기본 포트)는 뷰 전용이므로 선택 대상에서 제외
  const selectablePortfolios = portfolios.filter((p) => !p.is_default);

  return (
    <div>
      <div className="text-xs text-[var(--muted)] mb-1">포트 선택</div>
      <div className="flex gap-2 flex-wrap">
        {selectablePortfolios.map((p, i) => {
          const isSelected = p.id === selectedId;
          const colorClass = COLORS[i % COLORS.length];
          return (
            <button
              key={p.id}
              onClick={() => onChange(p.id)}
              className={`px-3 py-1 rounded-full text-xs transition-colors ${
                isSelected
                  ? `${colorClass} text-white`
                  : "bg-[var(--card-hover)] text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {p.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
