import { createServiceClient } from '@/lib/supabase';
import { Signal, SignalType } from '@/types/signal';

// 신호 타입 한국어 매핑
const SIGNAL_TYPE_KR: Record<SignalType, string> = {
  BUY: '매수',
  SELL: '매도',
  HOLD: '보유',
  BUY_FORECAST: '매수 예고',
  SELL_COMPLETE: '매도 완료',
};

// 소스 한국어 매핑
const SOURCE_KR: Record<string, string> = {
  lassi: '라씨',
  stockbot: '스톡봇',
  quant: '퀀트',
};

interface FCMMessage {
  token: string;
  notification: {
    title: string;
    body: string;
  };
  data?: Record<string, string>;
  webpush?: {
    fcm_options?: {
      link?: string;
    };
  };
}

/**
 * Google OAuth2 access token 발급 (서비스 계정 JWT)
 */
async function getAccessToken(serviceAccount: {
  client_email: string;
  private_key: string;
  token_uri: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: serviceAccount.token_uri,
    iat: now,
    exp: now + 3600,
  };

  const encode = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');

  const unsignedToken = `${encode(header)}.${encode(payload)}`;

  // Node.js crypto로 RS256 서명
  const crypto = await import('crypto');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsignedToken);
  const signature = sign.sign(serviceAccount.private_key, 'base64url');

  const jwt = `${unsignedToken}.${signature}`;

  const res = await fetch(serviceAccount.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) {
    throw new Error(`OAuth2 token error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.access_token;
}

/**
 * FCM HTTP v1 API로 단일 메시지 전송
 */
async function sendFCMMessage(
  projectId: string,
  accessToken: string,
  message: FCMMessage
): Promise<boolean> {
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error(`[FCM] 전송 실패 (${res.status}):`, errorText);
    return false;
  }

  return true;
}

/**
 * 신호에 대한 푸시 알림 전송
 * - notification_rules 확인 후 해당하는 경우에만 전송
 * - 모든 활성 FCM 토큰에 전송
 */
export async function sendSignalNotification(signal: Signal): Promise<void> {
  const supabase = createServiceClient();

  // 1. 알림 규칙 확인
  const shouldNotify = await checkNotificationRules(supabase, signal);
  if (!shouldNotify) {
    return;
  }

  // 2. 활성 FCM 토큰 조회
  const { data: tokens, error: tokenError } = await supabase
    .from('fcm_tokens')
    .select('token');

  if (tokenError || !tokens || tokens.length === 0) {
    if (tokenError) {
      console.error('[FCM] 토큰 조회 오류:', tokenError.message);
    }
    return;
  }

  // 3. 알림 내용 생성
  const signalTypeKr = SIGNAL_TYPE_KR[signal.signal_type] || signal.signal_type;
  const sourceKr = SOURCE_KR[signal.source] || signal.source;

  const title = `${signalTypeKr} 신호 - ${signal.name}`;
  const body = `[${sourceKr}] ${signal.name}${signal.symbol ? ` (${signal.symbol})` : ''} ${signalTypeKr}`;

  // 4. FCM 자격 증명 확인
  const projectId = process.env.FCM_PROJECT_ID;
  const serviceAccountJson = process.env.FCM_SERVICE_ACCOUNT_JSON;

  if (!projectId || !serviceAccountJson) {
    // FCM 자격 증명 미설정 시 로그 출력만
    console.log(`[FCM-FALLBACK] 알림: ${title} | ${body}`);
    console.log(`[FCM-FALLBACK] 대상 토큰 수: ${tokens.length}`);
    return;
  }

  try {
    // 서비스 계정 JSON 디코딩 (base64)
    const serviceAccount = JSON.parse(
      Buffer.from(serviceAccountJson, 'base64').toString('utf-8')
    );

    const accessToken = await getAccessToken(serviceAccount);

    // 5. 모든 토큰에 전송
    let successCount = 0;
    let failCount = 0;

    for (const { token } of tokens) {
      const message: FCMMessage = {
        token,
        notification: { title, body },
        data: {
          signal_id: signal.id,
          signal_type: signal.signal_type,
          source: signal.source,
          symbol: signal.symbol || '',
          name: signal.name,
        },
        webpush: {
          fcm_options: {
            link: '/',
          },
        },
      };

      const success = await sendFCMMessage(projectId, accessToken, message);
      if (success) {
        successCount++;
      } else {
        failCount++;
      }
    }

    console.log(
      `[FCM] 전송 완료: 성공 ${successCount}, 실패 ${failCount} (${signal.name} ${signalTypeKr})`
    );
  } catch (error) {
    console.error('[FCM] 전송 중 오류:', error);
  }
}

/**
 * notification_rules 테이블에서 해당 신호에 대한 규칙 확인
 * - 활성 규칙 중 조건에 맞는 것이 있으면 true
 * - 규칙이 없으면 기본적으로 모든 신호에 알림 (true)
 */
async function checkNotificationRules(
  supabase: ReturnType<typeof createServiceClient>,
  signal: Signal
): Promise<boolean> {
  const { data: rules, error } = await supabase
    .from('notification_rules')
    .select('*')
    .eq('active', true);

  if (error) {
    console.error('[FCM] 규칙 조회 오류:', error.message);
    return false;
  }

  // 활성 규칙이 없으면 기본적으로 모든 신호에 알림
  if (!rules || rules.length === 0) {
    return true;
  }

  // 조건 매칭: conditions에 source, signal_type 등이 있으면 해당 값과 비교
  return rules.some((rule) => {
    const conditions = rule.conditions as Record<string, string>;

    // source 조건
    if (conditions.source && conditions.source !== signal.source) {
      return false;
    }

    // signal_type 조건
    if (conditions.signal_type && conditions.signal_type !== signal.signal_type) {
      return false;
    }

    return true;
  });
}
