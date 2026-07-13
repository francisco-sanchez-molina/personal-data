/* Service worker mínimo: solo notificaciones push (sin caché, para no servir la app obsoleta). */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'Personal Vault', body: event.data?.text() ?? '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Personal Vault', {
      body: data.body || '',
      tag: data.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const win of windows) {
        win.navigate(url)
        return win.focus()
      }
      return self.clients.openWindow(url)
    })
  )
})
