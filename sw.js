/* Caché offline — ACME liquidación pesaje */
var CACHE_NAME = "acme-liquidacion-v1";
var PRECACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./librerias/jspdf.umd.min.js",
  "./librerias/jspdf.plugin.autotable.min.js",
  "./librerias/sweetalert2.all.min.js",
  "./librerias/sweetalert2.min.css",
  "./librerias/lucide.min.js",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(PRECACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  var url = event.request.url;
  if (url.startsWith("chrome-extension")) return;

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request)
        .then(function (res) {
          var copy = res.clone();
          if (res.ok && res.type === "basic") {
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(event.request, copy);
            });
          }
          return res;
        })
        .catch(function () {
          return caches.match("./index.html");
        });
    })
  );
});
