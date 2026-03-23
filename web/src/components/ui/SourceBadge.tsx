import { SOURCE_COLORS, SOURCE_LABELS } from "@/lib/signal-constants";

interface SourceBadgeProps {
  source: "lassi" | "stockbot" | "quant";
  size?: "sm" | "md";
}

export function SourceBadge({ source, size = "sm" }: SourceBadgeProps) {
  const colors = SOURCE_COLORS[source] || "";
  const label = SOURCE_LABELS[source] || source;
  const sizeClass =
    size === "sm" ? "text-xs px-2 py-0.5" : "text-sm px-3 py-1";

  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium ${colors} ${sizeClass}`}
    >
      {label}
    </span>
  );
}
