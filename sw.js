// App-shell cache only. Never caches Supabase or any personal data.
const V = "maree-v14";
const SHELL = ["./", "index.html", "icon.svg", "icon-192.png", "manifest.webmanifest"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return; // network only for APIs
  if (u.pathname.endsWith("version.json")) return; // always network
  e.respondWith(fetch(e.request, { cache: "no-store" }).then((r) => { const cp = r.clone(); caches.open(V).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
});
