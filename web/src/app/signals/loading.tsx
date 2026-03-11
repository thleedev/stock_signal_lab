export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 bg-[var(--card)] rounded w-36" />
      <div className="h-4 bg-[var(--card)] rounded w-28" />
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-10 bg-[var(--card)] rounded w-20" />
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card h-96" />
        <div className="card h-96" />
      </div>
    </div>
  );
}
