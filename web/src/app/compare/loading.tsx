export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 bg-[var(--card)] rounded w-36" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card h-48" />
        <div className="card h-48" />
      </div>
      <div className="card h-64" />
    </div>
  );
}
