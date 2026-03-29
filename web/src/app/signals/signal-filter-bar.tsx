'use client';

import { useRouter } from 'next/navigation';

const DATE_OPTIONS = [
  { key: 'today',  label: '오늘'   },
  { key: 'week',   label: '이번주' },
  { key: 'all',    label: '전체'   },
] as const;

type DateKey = typeof DATE_OPTIONS[number]['key'];

const SOURCE_OPTIONS = [
  { key: 'all',      label: '전체'   },
  { key: 'lassi',    label: '라씨'   },
  { key: 'stockbot', label: '스톡봇' },
  { key: 'quant',    label: '퀀트'   },
] as const;

type SourceKey = typeof SOURCE_OPTIONS[number]['key'];

interface SignalFilterBarProps {
  dates: string[];      // page.tsx에서 getLastNWeekdays(7) 결과 전달 (dates[0] = 오늘)
  selectedDate: string;
  activeSource: string;
}

/** 수평 버튼 그룹 */
function ButtonGroup<T extends string>({
  options,
  active,
  onSelect,
}: {
  options: readonly { key: T; label: string }[];
  active: T;
  onSelect: (key: T) => void;
}) {
  return (
    <div className="flex rounded-lg border border-[var(--border)] overflow-hidden shrink-0">
      {options.map((opt, idx) => {
        const isActive = opt.key === active;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onSelect(opt.key)}
            className={[
              'px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap',
              idx > 0 ? 'border-l border-[var(--border)]' : '',
              isActive
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--card)] text-[var(--muted-foreground)] hover:bg-[var(--border)]',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** selectedDate → DateKey 변환 (today 포함) */
function toDateKey(selectedDate: string): DateKey {
  if (selectedDate === 'week') return 'week';
  if (selectedDate === 'all') return 'all';
  return 'today'; // dates[0](오늘) 또는 기본값
}

export function SignalFilterBar({ dates, selectedDate, activeSource }: SignalFilterBarProps) {
  const router = useRouter();

  const buildUrl = (date: string, source: string) => {
    const p = new URLSearchParams();
    if (date !== dates[0]) p.set('date', date);
    if (source !== 'all') p.set('source', source);
    const qs = p.toString();
    return qs ? `/signals?${qs}` : '/signals';
  };

  const handleDateSelect = (key: DateKey) => {
    const dateValue = key === 'today' ? dates[0] : key;
    router.push(buildUrl(dateValue, activeSource));
  };

  const handleSourceSelect = (key: SourceKey) => {
    router.push(buildUrl(selectedDate, key));
  };

  const activeDateKey = toDateKey(selectedDate);

  return (
    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
      <ButtonGroup
        options={DATE_OPTIONS}
        active={activeDateKey}
        onSelect={handleDateSelect}
      />
      <ButtonGroup
        options={SOURCE_OPTIONS}
        active={activeSource as SourceKey}
        onSelect={handleSourceSelect}
      />
    </div>
  );
}
