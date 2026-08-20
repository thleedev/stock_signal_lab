interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  /**
   * 부제를 sm(640px) 미만에서 숨깁니다.
   * 부제가 화면 설명일 뿐이고 좁은 화면에서 세 줄로 접히는 화면에만 켭니다.
   * 기준일·건수처럼 값을 담은 부제에는 켜지 않습니다.
   */
  hideSubtitleOnMobile?: boolean;
}

export function PageHeader({ title, subtitle, action, hideSubtitleOnMobile = false }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl md:text-2xl font-bold">{title}</h1>
        {subtitle && (
          <p className={`text-sm text-[var(--muted)] mt-1 ${hideSubtitleOnMobile ? "hidden sm:block" : ""}`}>
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
