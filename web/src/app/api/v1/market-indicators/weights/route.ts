import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('indicator_weights')
    .select('*')
    .order('indicator_type');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function PUT(request: NextRequest) {
  const supabase = createServiceClient();
  const body = await request.json();

  // body: { weights: { VIX: 3.0, USD_KRW: 2.0, ... } }
  const { weights } = body as { weights: Record<string, number> };

  if (!weights || typeof weights !== 'object') {
    return NextResponse.json({ error: 'weights object required' }, { status: 400 });
  }

  const updates = Object.entries(weights).map(([indicator_type, weight]) =>
    supabase
      .from('indicator_weights')
      .update({ weight, updated_at: new Date().toISOString() })
      .eq('indicator_type', indicator_type)
  );

  await Promise.all(updates);

  return NextResponse.json({ success: true });
}
