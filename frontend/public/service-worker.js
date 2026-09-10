/* Dynamic Day standalone service worker: background web push + notification clicks. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { title: 'Dynamic Day', body: 'Your schedule has an update.' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Dynamic Day', { body: data.body || '', icon: '/favicon.ico', data: { url: data.url || '/' } }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const target = list.find((c) => 'focus' in c);
    return target ? target.focus() : clients.openWindow(event.notification?.data?.url || '/');
  }));
});
