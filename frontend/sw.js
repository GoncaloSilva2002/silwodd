self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_error) { data = { title: "Silwood", body: event.data?.text() || "Nova notificacao" }; }
  event.waitUntil((async () => {
    if (self.registration.setAppBadge) await self.registration.setAppBadge(data.unread || 1);
    await self.registration.showNotification(data.title || "Silwood", {
      body: data.body || data.title || "Tens uma nova notificacao.",
      icon: "/images.png",
      badge: "/images.png",
      silent: false,
      renotify: true,
      data: data.data || {}
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => "focus" in client);
    return existing ? existing.focus() : clients.openWindow("/");
  }));
});
