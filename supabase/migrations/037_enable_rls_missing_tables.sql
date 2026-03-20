-- Enable RLS on tables flagged by Supabase linter
-- These tables were missing RLS policies

-- daily_report_summary
ALTER TABLE daily_report_summary ENABLE ROW LEVEL SECURITY;
CREATE POLICY "daily_report_summary_all" ON daily_report_summary FOR ALL USING (true);

-- watchlist_groups
ALTER TABLE watchlist_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "watchlist_groups_all" ON watchlist_groups FOR ALL USING (true);

-- watchlist_group_stocks
ALTER TABLE watchlist_group_stocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "watchlist_group_stocks_all" ON watchlist_group_stocks FOR ALL USING (true);

-- ai_recommendations
ALTER TABLE ai_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_recommendations_all" ON ai_recommendations FOR ALL USING (true);

-- market_indicators
ALTER TABLE market_indicators ENABLE ROW LEVEL SECURITY;
CREATE POLICY "market_indicators_all" ON market_indicators FOR ALL USING (true);

-- indicator_weights
ALTER TABLE indicator_weights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "indicator_weights_all" ON indicator_weights FOR ALL USING (true);

-- app_config
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_config_all" ON app_config FOR ALL USING (true);

-- stock_cache
ALTER TABLE stock_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_cache_all" ON stock_cache FOR ALL USING (true);

-- market_score_history
ALTER TABLE market_score_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "market_score_history_all" ON market_score_history FOR ALL USING (true);

-- watchlist
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "watchlist_all" ON watchlist FOR ALL USING (true);
