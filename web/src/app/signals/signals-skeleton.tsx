/** SignalColumns 로딩 중 자리를 지키는 스켈레톤. 모바일 탭 + 데스크톱 2열 구조를 그대로 따릅니다. */
function SkeletonCard() {
  return (
    <div className="card overflow-hidden">
      <div className="divide-y divide-[var(--border)]">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="px-4 py-3 flex items-center gap-3">
            <div className="h-5 w-12 rounded bg-[var(--card-hover)] animate-pulse" />
            <div className="h-4 flex-1 rounded bg-[var(--card-hover)] animate-pulse" />
            <div className="h-4 w-16 rounded bg-[var(--card-hover)] animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SignalsSkeleton() {
  return (
    <>
      {/* 모바일: 탭 자리 + 카드 1개 */}
      <div className="md:hidden">
        <div className="flex border-b border-[var(--border)] mb-4">
          {[0, 1].map((i) => (
            <div key={i} className="flex-1 py-3 flex justify-center">
              <div className="h-4 w-16 rounded bg-[var(--card-hover)] animate-pulse" />
            </div>
          ))}
        </div>
        <SkeletonCard />
      </div>

      {/* 데스크톱: 2열 (매수/매도) */}
      <div className="hidden md:grid md:grid-cols-2 md:gap-6">
        {[0, 1].map((col) => (
          <div key={col}>
            <div className="flex items-center gap-2 mb-3">
              <div className="h-5 w-20 rounded bg-[var(--card-hover)] animate-pulse" />
              <div className="h-3 w-10 rounded bg-[var(--card-hover)] animate-pulse" />
            </div>
            <SkeletonCard />
          </div>
        ))}
      </div>
    </>
  );
}
