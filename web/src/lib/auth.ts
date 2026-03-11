import { NextRequest } from 'next/server';

// 수집기 API Key 인증 (Android → Server)
export function verifyCollectorKey(request: NextRequest): boolean {
  const apiKey = request.headers.get('x-device-key');
  const expectedKey = process.env.COLLECTOR_API_KEY;

  if (!expectedKey) {
    console.warn('COLLECTOR_API_KEY not set');
    return false;
  }

  return apiKey === expectedKey;
}

export function unauthorizedResponse() {
  return Response.json(
    { error: 'Unauthorized: Invalid or missing X-Device-Key' },
    { status: 401 }
  );
}
