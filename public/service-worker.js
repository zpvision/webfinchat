// Retirement endpoint for a previously installed Tinode service worker.
// FinChat does not register this worker. Existing browsers update the old URL,
// activate this pass-through replacement, and remove the registration.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.registration.unregister());
});
