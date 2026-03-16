export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 bg-[var(--card)] rounded w-36" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card h-40" />
        <div className="card h-40" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card h-14" />
        ))}
      </div>
    </div>
  );
}
