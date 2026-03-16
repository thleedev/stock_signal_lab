export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 bg-[var(--card)] rounded w-48" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card h-28" />
        ))}
      </div>
      <div className="card h-72" />
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card h-16" />
        ))}
      </div>
    </div>
  );
}
