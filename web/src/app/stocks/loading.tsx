export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 bg-[var(--card)] rounded w-32" />
      <div className="h-4 bg-[var(--card)] rounded w-48" />
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="card h-16" />
        ))}
      </div>
    </div>
  );
}
