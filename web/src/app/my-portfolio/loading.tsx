export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 bg-[var(--card)] rounded w-40" />
      <div className="flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-9 bg-[var(--card)] rounded w-24" />
        ))}
      </div>
      <div className="card h-24" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card h-16" />
        ))}
      </div>
    </div>
  );
}
