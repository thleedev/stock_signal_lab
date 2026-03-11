export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 bg-[var(--card)] rounded w-40" />
      <div className="h-4 bg-[var(--card)] rounded w-32" />
      <div className="flex gap-2">
        <div className="h-10 bg-[var(--card)] rounded w-24" />
        <div className="h-10 bg-[var(--card)] rounded w-24" />
      </div>
      <div className="card h-40" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card h-40" />
        <div className="card h-40" />
        <div className="card h-40" />
      </div>
    </div>
  );
}
