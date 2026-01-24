// --- 1. LIFECYCLE (Force Immediate Updates) ---
self.addEventListener('install', (event) => {
    // Tells the browser to activate this SW immediately, skipping the "waiting" state
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // Claims control of any open pages immediately
    event.waitUntil(clients.claim());
});

// --- 2. PUSH EVENT (Receive Notification) ---
self.addEventListener('push', (event) => {
    const data = event.data ? event.data.json() : {};

    event.waitUntil(
        self.registration.showNotification(data.title || 'ShortGames', {
            body: data.body || 'New turn available!',
            icon: '/icon.png', // Ensure you have an icon.png in your repo
            badge: '/icon.png',
            data: data // We pass the JSON payload to the click handler below
        })
    );
});

// --- 3. CLICK EVENT (Handle Deep Links) ---
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const payload = event.notification.data;
    const targetUrl = payload.url; // e.g., "shortcuts://run-shortcut?..."

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // A. If the PWA is already open, focus it and send a message
            for (const client of clientList) {
                if (client.url.includes(self.registration.scope) && 'focus' in client) {
                    if (targetUrl) {
                        // This message will be caught by index.html to trigger the redirect
                        client.postMessage({ type: 'NOTIFICATION_CLICK', payload: payload });
                    }
                    return client.focus();
                }
            }

            // B. If the PWA is closed, open it (with redirect param if needed)
            if (clients.openWindow) {
                const baseUrl = self.registration.scope;
                if (targetUrl) {
                    // Open PWA -> PWA sees param -> PWA bounces to Shortcut
                    return clients.openWindow(`${baseUrl}?redirect=${encodeURIComponent(targetUrl)}`);
                }
                return clients.openWindow(baseUrl);
            }
        })
    );
});