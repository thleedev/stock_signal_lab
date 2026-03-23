interface SectionTitleProps {
  children: React.ReactNode;
  action?: React.ReactNode;
}

export function SectionTitle({ children, action }: SectionTitleProps) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="section-title">{children}</h2>
      {action}
    </div>
  );
}
