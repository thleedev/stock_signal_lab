export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 bg-[var(--card)] rounded w-24" />
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card h-20" />
        ))}
      </div>
    </div>
  );
}
