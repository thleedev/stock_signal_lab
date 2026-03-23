interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-xl md:text-2xl font-bold">{title}</h1>
        {subtitle && (
          <p className="text-sm text-[var(--muted)] mt-1">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}
