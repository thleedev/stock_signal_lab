-- 052: stock_ranking_snapshot, stock_dart_info, snapshot_update_status RLS 활성화

ALTER TABLE stock_ranking_snapshot ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_ranking_snapshot_all" ON stock_ranking_snapshot FOR ALL USING (true);

ALTER TABLE stock_dart_info ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_dart_info_all" ON stock_dart_info FOR ALL USING (true);

ALTER TABLE snapshot_update_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "snapshot_update_status_all" ON snapshot_update_status FOR ALL USING (true);
