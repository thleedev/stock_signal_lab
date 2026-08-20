export default function Loading() {
  return (
    <div className="section-gap animate-pulse">
      <div className="h-8 bg-[var(--card)] rounded w-32" />
      <div className="h-11 bg-[var(--card)] rounded w-full" />
      <div className="flex flex-col gap-2">
        {/* 좁은 화면은 카드(약 112px), lg 이상은 테이블 행(약 64px) */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="card h-28 lg:h-16" />
        ))}
      </div>
    </div>
  );
}
