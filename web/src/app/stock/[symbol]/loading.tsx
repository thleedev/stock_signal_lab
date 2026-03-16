export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center gap-4">
        <div className="h-10 bg-[var(--card)] rounded w-24" />
        <div className="h-6 bg-[var(--card)] rounded w-40" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card h-24" />
        ))}
      </div>
      <div className="card h-64" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card h-14" />
        ))}
      </div>
    </div>
  );
}
