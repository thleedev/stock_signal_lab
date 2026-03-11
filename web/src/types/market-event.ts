export type EventType =
  | 'futures_expiry'
  | 'options_expiry'
  | 'simultaneous_expiry'
  | 'holiday'
  | 'fomc'
  | 'cpi'
  | 'employment'
  | 'gdp'
  | 'earnings'
  | 'ipo'
  | 'custom';

export type EventCategory = 'derivatives' | 'holiday' | 'economic' | 'corporate';

export type EventSource = 'rule_based' | 'nager_date' | 'fred_api' | 'manual';

export interface MarketEvent {
  id: string;
  event_date: string;
  event_type: EventType;
  event_category: EventCategory;
  title: string;
  description: string | null;
  country: string;
  impact_level: number;
  risk_score: number;
  source: EventSource;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export const EVENT_RISK_DEFAULTS: Record<EventType, { impact_level: number; risk_score: number; category: EventCategory }> = {
  simultaneous_expiry: { impact_level: 5, risk_score: -20, category: 'derivatives' },
  futures_expiry:      { impact_level: 3, risk_score: -10, category: 'derivatives' },
  options_expiry:      { impact_level: 2, risk_score: -5,  category: 'derivatives' },
  fomc:                { impact_level: 5, risk_score: -15, category: 'economic' },
  cpi:                 { impact_level: 4, risk_score: -12, category: 'economic' },
  employment:          { impact_level: 4, risk_score: -10, category: 'economic' },
  gdp:                 { impact_level: 3, risk_score: -8,  category: 'economic' },
  holiday:             { impact_level: 1, risk_score: 0,   category: 'holiday' },
  earnings:            { impact_level: 3, risk_score: -5,  category: 'corporate' },
  ipo:                 { impact_level: 2, risk_score: -3,  category: 'corporate' },
  custom:              { impact_level: 1, risk_score: 0,   category: 'corporate' },
};

export const EVENT_CATEGORY_LABELS: Record<EventCategory, string> = {
  derivatives: '파생상품',
  holiday: '휴장',
  economic: '경제지표',
  corporate: '기업',
};

export function getImpactLabel(level: number): { label: string; color: string } {
  if (level >= 5) return { label: '매우 높음', color: '#ef4444' };
  if (level >= 4) return { label: '높음', color: '#f97316' };
  if (level >= 3) return { label: '보통', color: '#eab308' };
  if (level >= 2) return { label: '낮음', color: '#6b7280' };
  return { label: '미미', color: '#4b5563' };
}
