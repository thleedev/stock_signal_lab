import { Card } from "./Card";

interface EmptyStateProps {
  icon?: React.ReactNode;
  message: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, message, action }: EmptyStateProps) {
  return (
    <Card padding="lg">
      <div className="flex flex-col items-center justify-center text-center gap-3">
        {icon && <div className="text-[var(--muted)]">{icon}</div>}
        <p className="text-[var(--muted)]">{message}</p>
        {action}
      </div>
    </Card>
  );
}
