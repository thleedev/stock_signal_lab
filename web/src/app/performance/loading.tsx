export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 bg-[var(--card)] rounded w-40" />
      <div className="h-4 bg-[var(--card)] rounded w-56" />
      <div className="flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-10 bg-[var(--card)] rounded w-16" />
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="card h-32" />
        <div className="card h-32" />
      </div>
      <div className="card h-64" />
    </div>
  );
}
