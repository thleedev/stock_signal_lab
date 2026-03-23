interface PriceTextProps {
  value: number;
  format?: "percent" | "currency" | "number";
  size?: "sm" | "md" | "lg";
  showSign?: boolean;
}

const SIZE_CLASS = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
} as const;

export function PriceText({
  value,
  format = "percent",
  size = "sm",
  showSign = true,
}: PriceTextProps) {
  const colorClass =
    value > 0
      ? "text-red-400"
      : value < 0
        ? "text-blue-400"
        : "text-[var(--muted)]";
  const sign = showSign && value > 0 ? "+" : "";

  let formatted: string;
  if (format === "percent") {
    formatted = `${sign}${value.toFixed(2)}%`;
  } else if (format === "currency") {
    formatted = `${sign}${value.toLocaleString()}원`;
  } else {
    formatted = `${sign}${value.toLocaleString()}`;
  }

  return (
    <span className={`${colorClass} ${SIZE_CLASS[size]} font-medium`}>
      {formatted}
    </span>
  );
}
