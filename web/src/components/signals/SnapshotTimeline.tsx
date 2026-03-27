'use client';

interface Session {
  id: number;
  session_time: string;
  trigger_type: string;
  total_count: number;
}

interface SnapshotTimelineProps {
  sessions: Session[];
  activeSessionId: number | null;
  onSelect: (sessionId: number) => void;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Seoul',
  });
}

function getTriggerLabel(triggerType: string): string {
  return triggerType === 'manual' ? '수동' : '자동';
}

export default function SnapshotTimeline({
  sessions,
  activeSessionId,
  onSelect,
}: SnapshotTimelineProps) {
  if (sessions.length < 2) return null;

  const count = sessions.length;

  return (
    <div className="flex flex-col gap-2">
      {/* 범례 헤더 */}
      <div className="flex items-center gap-3">
        <span
          className="text-xs font-medium"
          style={{ color: 'var(--foreground)' }}
        >
          타임라인
        </span>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted)' }}>
            <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
            자동
          </span>
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted)' }}>
            <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
            수동
          </span>
        </div>
      </div>

      {/* 타임라인 바 */}
      <div className="relative" style={{ height: '40px' }}>
        {/* 배경 라인 */}
        <div
          className="absolute top-[10px] left-0 right-0 h-0.5 rounded-full"
          style={{ background: 'var(--border)' }}
        />

        {/* 점(dot) 목록 */}
        {sessions.map((session, idx) => {
          const isActive = session.id === activeSessionId;
          const isAuto = session.trigger_type !== 'manual';
          const timeLabel = formatTime(session.session_time);
          const triggerLabel = getTriggerLabel(session.trigger_type);
          const leftPercent = (idx / (count - 1)) * 100;

          return (
            <div
              key={session.id}
              className="absolute flex flex-col items-center"
              style={{ left: `${leftPercent}%`, transform: 'translateX(-50%)' }}
            >
              {/* 점 */}
              <button
                onClick={() => onSelect(session.id)}
                title={`${timeLabel} (${triggerLabel}) · ${session.total_count}종목`}
                className={[
                  'w-4 h-4 rounded-full transition-transform cursor-pointer',
                  isAuto ? 'bg-blue-500' : 'bg-green-500',
                  isActive
                    ? 'scale-125 border-2 border-white shadow-md'
                    : 'border border-transparent',
                ].join(' ')}
              />

              {/* 시간 라벨 */}
              <span
                className="mt-1 text-[10px] leading-none whitespace-nowrap"
                style={{ color: 'var(--muted)' }}
              >
                {timeLabel}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
