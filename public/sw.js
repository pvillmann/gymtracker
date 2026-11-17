// Service Worker nur für Benachrichtigungen („Pause vorbei“) – kein Cache,
// keine Offline-Logik.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "GymTracker", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "GymTracker", {
      body: data.body || "",
      tag: data.tag || "gymtracker",
      renotify: true,
      icon: "/apple-icon.png",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Nur Pfade dieser Seite – nie eine fremde Adresse aus der Nachricht öffnen.
  const raw = (event.notification.data && event.notification.data.url) || "/";
  const url = typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const win of windows) {
        if ("focus" in win) {
          win.navigate(url);
          return win.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
