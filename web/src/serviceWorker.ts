export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((registration) => {
    const activate = () => registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
    activate();
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => { if (worker.state === 'installed') activate(); });
    });
    const check = () => { if (navigator.onLine) void registration.update().catch(() => {}); };
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    setInterval(check, 60 * 60 * 1000);
  }).catch(() => {});
}