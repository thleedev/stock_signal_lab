import { SIGNAL_COLORS, SIGNAL_TYPE_LABELS } from "@/lib/signal-constants";

interface SignalBadgeProps {
  type: string;
  size?: "sm" | "md";
}

export function SignalBadge({ type, size = "sm" }: SignalBadgeProps) {
  const colors =
    SIGNAL_COLORS[type] || "bg-gray-900/30 text-gray-400 border-gray-800/50";
  const label = SIGNAL_TYPE_LABELS[type] || type;
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
