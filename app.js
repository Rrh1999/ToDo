// Minimal Service Worker for notifications and future caching if needed
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Optional: listen for postMessage to show a notification (not required for this feature)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    if (self.registration && self.registration.showNotification) {
      self.registration.showNotification(title || 'Notification', options || {});
    }
  }
});

// Diagnostics: log notification lifecycle and handle click
self.addEventListener('notificationshow', (e) => {
  // Not all browsers fire this, but log if available
  try { console.log('SW: notificationshow', e?.notification?.tag); } catch {}
});

self.addEventListener('notificationclick', (e) => {
  const action = e.action || 'default';
  try { console.log('SW: notificationclick', action, e?.notification?.tag); } catch {}
  e.notification.close();
  e.waitUntil((async () => {
    // Report to server if action is yes/no
    if (action === 'open' || action === 'dismiss' || action === 'yes' || action === 'no') {
      const mapped = action === 'open' ? 'yes' : (action === 'dismiss' ? 'no' : action);
      try {
        await fetch('/api/notification-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: mapped, tag: e?.notification?.tag, ts: new Date().toISOString() })
        });
      } catch (err) { /* ignore */ }
    }

    // Broadcast to client pages to refresh stats
    try {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clients.forEach(c => c.postMessage({ type: 'NOTIF_STATS_UPDATED' }));
    } catch {}

    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const url = '/notification.html';
    // Focus an existing tab if one is open
    const client = allClients.find(c => c.url.includes(url));
    if (client) {
      return client.focus();
    }
    // Otherwise open a new tab
    return self.clients.openWindow(url);
  })());
});

self.addEventListener('notificationclose', (e) => {
  try { console.log('SW: notificationclose', e?.notification?.tag); } catch {}
});
