import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { buildEventRow } from '@/lib/market-events';
import type { EventType } from '@/types/market-event';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const category = searchParams.get('category');

  const supabase = createServiceClient();
  let query = supabase
    .from('market_events')
    .select('*')
    .order('event_date', { ascending: true });

  if (from) query = query.gte('event_date', from);
  if (to) query = query.lte('event_date', to);
  if (category) query = query.eq('event_category', category);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { event_date, event_type, title, description, country, metadata } = body as {
    event_date: string;
    event_type: EventType;
    title: string;
    description?: string;
    country?: string;
    metadata?: Record<string, unknown>;
  };

  if (!event_date || !event_type || !title) {
    return NextResponse.json({ error: 'event_date, event_type, title are required' }, { status: 400 });
  }

  const row = buildEventRow(
    event_date,
    event_type,
    title,
    'manual',
    country ?? 'KR',
    description ?? null,
    metadata ?? {}
  );

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('market_events')
    .upsert(row, { onConflict: 'event_date,event_type,title' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
