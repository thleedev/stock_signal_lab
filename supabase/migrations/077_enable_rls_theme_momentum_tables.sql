-- supabase/migrations/077_enable_rls_theme_momentum_tables.sql

-- stock_sectors 테이블 RLS 활성화 및 정책 추가
ALTER TABLE stock_sectors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_sectors_all" ON stock_sectors FOR ALL USING (true);

-- stock_themes 테이블 RLS 활성화 및 정책 추가
ALTER TABLE stock_themes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_themes_all" ON stock_themes FOR ALL USING (true);

-- theme_stocks 테이블 RLS 활성화 및 정책 추가
ALTER TABLE theme_stocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "theme_stocks_all" ON theme_stocks FOR ALL USING (true);
