// 휴대폰 PWA Service Worker — Web Push 수신 + "열기/무시" 2-action 알림. M5-T4 stub.
// 자동 입력 절대 금지 — action 은 사용자 수동 선택만.

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'mtb', body: '' };
  event.waitUntil(
    self.registration.showNotification(data.title || 'mobile_term_bridge', {
      body: data.body || '',
      tag: data.tag,
      actions: [
        { action: 'open', title: '열기' },
        { action: 'dismiss', title: '무시' }
      ]
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'open') {
    event.waitUntil(clients.openWindow('/'));
  }
  // 'dismiss' 는 close 만, 추가 동작 없음.
});
