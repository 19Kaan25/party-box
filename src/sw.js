import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';

/**
 * Eigener Service Worker statt generateSW, weil Workbox' generateSW keine
 * eigenen Event-Listener (push, notificationclick) zulaesst -- dafuer
 * braucht es injectManifest mit einer selbst geschriebenen Datei.
 *
 * Die beiden nicht verhandelbaren PWA-Regeln aus CLAUDE.md gelten
 * unveraendert: Precache nur Build-Artefakte (self.__WB_MANIFEST, von
 * vite-plugin-pwa befuellt), kein navigateFallback, kein runtimeCaching.
 * Push kommt als DRITTES, unabhaengiges Feature dazu -- es installiert
 * keinen fetch-Handler und ruehrt das Caching-Verhalten nicht an.
 */
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

self.skipWaiting();
self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
    let data = {};
    try {
        data = event.data?.json() ?? {};
    } catch {
        data = { body: event.data?.text() };
    }

    event.waitUntil(
        self.registration.showNotification(data.title || 'PartyBox', {
            body: data.body || '',
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            data: { url: data.url || '/' },
        })
    );
});

// Klick auf die Benachrichtigung: vorhandenes Fenster fokussieren statt
// immer ein neues zu oeffnen -- die App laeuft meist schon in einem Tab.
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data?.url || '/';

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
            const existing = clientsArr.find((c) => c.url.startsWith(self.location.origin));
            if (existing) return existing.focus();
            return self.clients.openWindow(url);
        })
    );
});
