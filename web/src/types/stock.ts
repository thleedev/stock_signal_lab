// 소스별 신호 정보
export interface SourceSignal {
  type: string | null;
  price: number | null;
}

// 종목 캐시 타입

export interface StockCache {
  symbol: string;
  name: string;
  market: string;
  current_price: number | null;
  price_change: number | null;
  price_change_pct: number | null;
  volume: number | null;
  market_cap: number | null;
  per: number | null;
  pbr: number | null;
  roe: number | null;
  eps: number | null;
  bps: number | null;
  dividend_yield: number | null;
  high_52w: number | null;
  low_52w: number | null;
  latest_signal_type: string | null;
  latest_signal_date: string | null;
  signal_count_30d: number;
  ai_score: number | null;
  is_holding: boolean;
  change_1m_pct: number | null;
  is_favorite: boolean;
  updated_at: string;
  // 소스별 최신 신호 (API에서 merge)
  signals?: {
    lassi: SourceSignal;
    stockbot: SourceSignal;
    quant: SourceSignal;
  };
}

// 워치리스트 아이템
export interface WatchlistItem {
  id: string;
  symbol: string;
  name: string;
  added_at: string;
  memo: string | null;
  sort_order: number;
  buy_price: number | null;
  stop_loss_price: number | null;
  target_price: number | null;
}

// 전종목 필터
export interface StockFilter {
  market?: string;
  signal?: string;
  minPer?: number;
  maxPer?: number;
  minPbr?: number;
  maxPbr?: number;
  minRoe?: number;
  maxRoe?: number;
  minPrice?: number;
  maxPrice?: number;
  minVolume?: number;
  isHolding?: boolean;
  isFavorite?: boolean;
  query?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

// KIS API 실시간 데이터
export interface StockRealtimeData {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  per: number | null;
  pbr: number | null;
  eps: number | null;
  bps: number | null;
  market_cap: number | null;
  high_52w: number | null;
  low_52w: number | null;
  price_change: number | null;
  price_change_pct: number | null;
}

export interface WatchlistGroup {
  id: string;
  name: string;
  sort_order: number;
  is_default: boolean;
  created_at: string;
}
