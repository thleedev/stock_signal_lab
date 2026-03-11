import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BACKUP_TABLES = [
  'favorite_stocks',
  'watchlist',
  'signals',
  'virtual_trades',
  'market_indicators',
  'market_score_history',
  'notification_rules',
  'daily_signal_stats',
];

/**
 * 핵심 데이터 JSON 백업
 * GET /api/v1/backup — 전체 데이터 JSON 다운로드
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const backup: Record<string, unknown[]> = {};
  const errors: string[] = [];

  for (const table of BACKUP_TABLES) {
    const { data, error } = await supabase.from(table).select('*');
    if (error) {
      errors.push(`${table}: ${error.message}`);
    } else {
      backup[table] = data ?? [];
    }
  }

  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const timestamp = kst.toISOString().slice(0, 19).replace(/[:-]/g, '').replace('T', '_');

  const result = {
    backup_date: kst.toISOString(),
    tables: Object.keys(backup),
    row_counts: Object.fromEntries(
      Object.entries(backup).map(([k, v]) => [k, v.length])
    ),
    errors: errors.length > 0 ? errors : undefined,
    data: backup,
  };

  return new NextResponse(JSON.stringify(result, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="backup_${timestamp}.json"`,
    },
  });
}
