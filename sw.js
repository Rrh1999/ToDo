// Minimal Service Worker for notifications and future caching if needed
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle push events (background notifications)
self.addEventListener('push', (event) => {
  console.log('SW: push event received', event);
  
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    console.warn('SW: failed to parse push data', e);
  }

  const title = data.title || 'ToDo Notification';
  const options = {
    body: data.body || 'You have a new notification',
    icon: data.icon || '/favicon.ico',
    badge: data.badge || '/favicon.ico',
    tag: data.tag || 'todo-push',
    renotify: true,
    requireInteraction: true,
    data: data.data || {},
    actions: data.actions || [
      { action: 'yes', title: 'Yes' },
      { action: 'no', title: 'No' }
    ]
  };

  // For experience notifications, customize the options
  if (data.data && data.data.experienceId) {
    console.log('SW: Experience push notification:', data.data);
    
    // If it's a survey experience, just show "Open Survey" action
    if (data.data.experienceType === 'more') {
      options.actions = [
        { action: 'open', title: 'Open Survey' },
        { action: 'skip', title: 'Skip' }
      ];
    }
    // For simple responses, actions are already set in data.actions
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
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
  let action = e.action || 'default';
  const tag = e?.notification?.tag;
  const data = e?.notification?.data || {};
  // Backward-compat: map old 'resp-0/resp-1' to 'response-0/response-1'
  if (action && action.startsWith('resp-')) {
    action = action.replace('resp-', 'response-');
  }
  
  try { console.log('SW: notificationclick', action, tag, data); } catch {}
  e.notification.close();
  
  e.waitUntil((async () => {
  // Handle experience tracker notifications
    if (tag && tag.startsWith('experience-') && data.experienceId) {
      if (action.startsWith('response-')) {
        // Extract response index and record the response
        const responseIndex = parseInt(action.replace('response-', ''));
        try {
          await fetch('/api/experience-responses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              experienceId: data.experienceId,
              type: 'notification_action',
              data: { responseIndex, action },
              timestamp: new Date().toISOString()
            })
          });
          console.log('SW: Experience response recorded');
        } catch (err) {
          console.error('SW: Failed to record experience response:', err);
        }
      } else if (action === 'skip') {
        // Record a skipped response and do not open the page
        try {
          await fetch('/api/experience-responses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              experienceId: data.experienceId,
              type: 'skipped',
              timestamp: new Date().toISOString()
            })
          });
        } catch (err) { /* ignore */ }
        return; // stop here, don't open the page
      }
    }
    
    // Report to server if action is yes/no (for regular notifications)
  if (action === 'open' || action === 'dismiss' || action === 'yes' || action === 'no') {
      const mapped = action === 'open' ? 'yes' : (action === 'dismiss' ? 'no' : action);
      try {
        await fetch('/api/notification-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: mapped, tag: tag, ts: new Date().toISOString() })
        });
      } catch (err) { /* ignore */ }
    }

    // Broadcast to client pages to refresh stats
    try {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clients.forEach(c => c.postMessage({ type: 'NOTIF_STATS_UPDATED' }));
    } catch {}

    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const baseUrl = '/notification.html';
  const isSurvey = data.experienceId && (data.experienceType === 'more');
  const wantOpenSurvey = isSurvey && (action === 'open' || action === 'default');
    // Try to focus an existing tab first
    const client = allClients.find(c => c.url.includes(baseUrl));
    if (client) {
      await client.focus();
      if (wantOpenSurvey) {
        try { client.postMessage({ type: 'OPEN_SURVEY', experienceId: data.experienceId }); } catch {}
      }
      return;
    }
    // Otherwise open a new tab and pass the id via query string so the page can open the modal
    const targetUrl = wantOpenSurvey ? `${baseUrl}?openSurvey=${encodeURIComponent(data.experienceId)}` : baseUrl;
    return self.clients.openWindow(targetUrl);
  })());
});

self.addEventListener('notificationclose', (e) => {
  try { console.log('SW: notificationclose', e?.notification?.tag); } catch {}
});


