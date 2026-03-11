import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

// POST /api/v1/notifications/token — FCM 토큰 등록/갱신
export async function POST(request: NextRequest) {
  const body = await request.json();

  if (!body.token || !body.device_id) {
    return Response.json(
      { error: 'token and device_id are required' },
      { status: 400 }
    );
  }

  const platform = body.platform || 'web';
  if (!['web', 'android'].includes(platform)) {
    return Response.json(
      { error: 'platform must be "web" or "android"' },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  // device_id 기준으로 upsert
  const { data, error } = await supabase
    .from('fcm_tokens')
    .upsert(
      {
        token: body.token,
        device_id: body.device_id,
        platform,
      },
      { onConflict: 'device_id' }
    )
    .select()
    .single();

  if (error) {
    console.error('fcm_tokens upsert error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ token: data }, { status: 201 });
}

// DELETE /api/v1/notifications/token — FCM 토큰 삭제
export async function DELETE(request: NextRequest) {
  const body = await request.json();

  if (!body.device_id) {
    return Response.json(
      { error: 'device_id is required' },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  const { error } = await supabase
    .from('fcm_tokens')
    .delete()
    .eq('device_id', body.device_id);

  if (error) {
    console.error('fcm_tokens delete error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
