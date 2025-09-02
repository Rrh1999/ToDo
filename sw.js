// Lightweight service worker for notifications and fast activation
// Scope is controlled by server.js which sets Service-Worker-Allowed: /

const SW_VERSION = '1.0.0';

self.addEventListener('install', (event) => {
	// Take control immediately on first load
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	// Become active for all open clients
	event.waitUntil(self.clients.claim());
});

// Helper: safe JSON parse
function safeJson(text) {
	try { return JSON.parse(text); } catch { return null; }
}

// Helper: show a notification from a payload
async function showPushNotification(payload) {
	const title = payload && (payload.title || payload.t) || 'Notification';
	const body = payload && (payload.body || payload.b) || '';
	const actions = Array.isArray(payload && payload.actions) ? payload.actions : [];
	const data = payload && payload.data ? payload.data : null;
	const tag = payload && payload.tag ? payload.tag : 'push';

	const options = {
		body,
		// Avoid caching issues; keep it simple without icons if not provided
		// icon: payload.icon || '/icon.png',
		badge: payload && payload.badge ? payload.badge : undefined,
		tag,
		requireInteraction: !!(payload && payload.requireInteraction),
		actions,
		data: { source: 'push', receivedAt: Date.now(), data }
	};

	await self.registration.showNotification(title, options);
}

self.addEventListener('push', (event) => {
	event.waitUntil((async () => {
		try {
			const hasData = event.data && (event.data.json || event.data.text);
			if (!hasData) { await showPushNotification({ title: 'Notification', body: '' }); return; }

			// Try JSON first; fall back to text
			let payload = null;
			try { payload = event.data.json(); }
			catch { const txt = await event.data.text(); payload = safeJson(txt) || { body: String(txt || '') }; }

			await showPushNotification(payload || {});
		} catch (e) {
			// As a last resort show a generic notification so user sees something
			await showPushNotification({ title: 'Notification', body: '' });
		}
	})());
});

// When user clicks a notification, send action back to server and focus/open a page
self.addEventListener('notificationclick', (event) => {
	const action = event.action || 'clicked';
	const payloadData = event.notification && event.notification.data ? event.notification.data.data : null;
	event.notification && event.notification.close && event.notification.close();

	event.waitUntil((async () => {
		// Best-effort report back (ignore failures silently)
		try {
			await fetch('/api/health/response', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action, data: payloadData })
			});
		} catch {}

		// Try to focus an existing client; else open the Health page (or root if unavailable)
		try {
			const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
			const urlToOpen = payloadData && payloadData.source === 'experience' ? '/health.html?fromPush=1' : '/';
			const target = all.find(c => c.url && new URL(c.url).pathname === new URL(urlToOpen, self.location.origin).pathname);
			if (target && 'focus' in target) {
				await target.focus();
			} else if (self.clients.openWindow) {
				await self.clients.openWindow(urlToOpen);
			}
		} catch {}
	})());
});

// Optional: track user dismissals (no server call needed, but hook is here if desired)
self.addEventListener('notificationclose', () => {
	// No-op
});

// No fetch handler -> passthrough to network/HTTP caching
// This avoids interfering with API requests and simplifies behavior under Caddy/HTTPS

// Keep a pingable message handler for future extension
self.addEventListener('message', (event) => {
	if (event && event.data === 'sw-version') {
		event.source && event.source.postMessage && event.source.postMessage({ type: 'sw-version', version: SW_VERSION });
	}
});

