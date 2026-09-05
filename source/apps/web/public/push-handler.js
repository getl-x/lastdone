/* global self, URL */

self.addEventListener("push", (event) => {
  const payload = (() => {
    try {
      return event.data?.json() ?? {};
    } catch {
      return { title: "LastDone", body: event.data?.text() ?? "" };
    }
  })();

  const title = payload.title || "LastDone";
  const options = {
    body: payload.body || "",
    icon: "/pwa-192x192.png",
    badge: "/favicon-32x32.png",
    tag: payload.tag || undefined,
    data: { url: payload.url || "/" },
  };
  const tasks = [self.registration.showNotification(title, options)];
  if (Number.isFinite(payload.badge) && self.navigator?.setAppBadge) {
    tasks.push(
      payload.badge > 0
        ? self.navigator.setAppBadge(payload.badge)
        : self.navigator.clearAppBadge(),
    );
  }
  event.waitUntil(Promise.all(tasks));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requestedPath = event.notification.data?.url || "/";
  const destination = new URL(requestedPath, self.location.origin);
  const safeURL =
    destination.origin === self.location.origin
      ? destination.href
      : new URL("/", self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ("navigate" in client) {
            return client.navigate(safeURL).then(() => client.focus());
          }
          if (client.url === safeURL && "focus" in client) {
            return client.focus();
          }
        }
        return self.clients.openWindow(safeURL);
      }),
  );
});
