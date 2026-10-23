// Tinode used this root-scoped worker before FinChat replaced its frontend.
// Retire only that registration; never clear sessions, drafts or other workers.
export async function retireLegacyWorker(options = {}) {
  try {
    const serviceWorker = options.serviceWorker ?? globalThis.navigator?.serviceWorker;
    const origin = options.origin ?? globalThis.location?.origin;
    if (!serviceWorker?.getRegistrations || !origin) return;
    const registrations = await serviceWorker.getRegistrations();
    for (const registration of registrations) {
      try {
        const scope = new URL(registration.scope);
        const workers = [registration.active, registration.waiting, registration.installing].filter(Boolean);
        if (scope.origin !== origin || scope.pathname !== '/' || scope.search || !workers.length) continue;
        const legacy = workers.every((worker) => {
          const url = new URL(worker.scriptURL);
          return url.origin === origin && url.pathname === '/service-worker.js';
        });
        if (legacy) await registration.unregister();
      } catch { /* A rejected registration must not prevent startup or other cleanup. */ }
    }
  } catch { /* Storage/service workers may be unavailable in private browser modes. */ }
}
