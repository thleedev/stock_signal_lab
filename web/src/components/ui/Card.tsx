interface CardProps {
  children: React.ReactNode;
  hover?: boolean;
  variant?: "default" | "highlight";
  color?: "lassi" | "stockbot" | "quant";
  padding?: "default" | "lg";
  className?: string;
  onClick?: () => void;
}

const HIGHLIGHT_COLORS = {
  lassi: "bg-red-900/20 border-red-800/50",
  stockbot: "bg-green-900/20 border-green-800/50",
  quant: "bg-blue-900/20 border-blue-800/50",
} as const;

export function Card({
  children,
  hover = false,
  variant = "default",
  color,
  padding = "default",
  className = "",
  onClick,
}: CardProps) {
  const baseClass =
    variant === "highlight" && color
      ? `rounded-xl border ${HIGHLIGHT_COLORS[color]}`
      : "card";
  const paddingClass = padding === "lg" ? "card-padding-lg" : "card-padding";
  const hoverClass = hover
    ? "hover:brightness-110 transition-all cursor-pointer"
    : "";

  return (
    <div
      className={`${baseClass} ${paddingClass} ${hoverClass} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
