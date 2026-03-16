'use client';

import { useRouter } from 'next/navigation';
import { FilterBar } from '@/components/common/filter-bar';

const SIGNAL_SOURCE_OPTIONS = [
  { key: 'all',      label: '전체'   },
  { key: 'lassi',    label: '라씨'   },
  { key: 'stockbot', label: '스톡봇' },
  { key: 'quant',    label: '퀀트'   },
];

interface SignalFilterBarProps {
  dates: string[];        // page.tsx에서 getLastNWeekdays(7) 결과 전달
  selectedDate: string;
  activeSource: string;
}

export function SignalFilterBar({ dates, selectedDate, activeSource }: SignalFilterBarProps) {
  const router = useRouter();

  const buildUrl = (date: string, source: string) => {
    const p = new URLSearchParams();
    // dates[0] = 오늘 = 기본값 → 파라미터 생략
    if (date !== dates[0]) p.set('date', date);
    if (source !== 'all') p.set('source', source);
    const qs = p.toString();
    return qs ? `/signals?${qs}` : '/signals';
  };

  return (
    <FilterBar
      date={{
        dates,
        selected: selectedDate,
        onChange: (d) => router.push(buildUrl(d, activeSource)),
        allLabel: '신호전체',
        label: '날짜',
      }}
      source={{
        options: SIGNAL_SOURCE_OPTIONS,
        selected: activeSource,
        onChange: (s) => router.push(buildUrl(selectedDate, s)),
      }}
    />
  );
}
