/* eslint-disable no-restricted-globals */

// Firebase Cloud Messaging Service Worker
// 백그라운드 푸시 알림 처리

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// 푸시 메시지 수신 시 알림 표시
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { notification: { title: '새 알림', body: event.data.text() } };
  }

  const notification = payload.notification || {};
  const data = payload.data || {};

  // 신호 타입 한국어 매핑
  const signalTypeKr = {
    BUY: '매수',
    SELL: '매도',
    HOLD: '보유',
    BUY_FORECAST: '매수 예고',
    SELL_COMPLETE: '매도 완료',
  };

  const title =
    notification.title ||
    `${signalTypeKr[data.signal_type] || data.signal_type || ''} 신호 - ${data.name || ''}`;
  const body =
    notification.body ||
    `[${data.source || ''}] ${data.name || ''} ${signalTypeKr[data.signal_type] || ''}`;

  const options = {
    body,
    icon: '/next.svg',
    badge: '/next.svg',
    data: data,
    tag: data.signal_id || 'signal-notification',
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// 알림 클릭 시 앱 열기
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 이미 열려 있는 창이 있으면 포커스
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // 없으면 새 창 열기
      return self.clients.openWindow(url);
    })
  );
});
