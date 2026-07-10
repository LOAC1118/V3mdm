// MDM CRM — Service Worker v3
// Changement clé vs v2 : la branche "app" récupère les fichiers /V3mdm/ avec
// { cache: 'no-store' }, ce qui court-circuite le cache HTTP de GitHub Pages
// (max-age=600 = 10 min). Les mises à jour (index.html, promo-generator.js,
// et tous les modules .js) arrivent donc immédiatement, sans vider le cache.
const CACHE_STATIC = 'mdm-static-v3';

self.addEventListener('install', function(event) {
  console.log('[SW] Installation v3...');
  event.waitUntil(
    caches.open(CACHE_STATIC).then(function(cache) {
      return cache.addAll([
        '/V3mdm/',
        '/V3mdm/index.html',
        '/V3mdm/manifest.json',
      ]).catch(function(err) {
        console.warn('[SW] Cache partiel:', err);
      });
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(event) {
  console.log('[SW] Activation v3 - suppression anciens caches...');
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          return key !== CACHE_STATIC;
        }).map(function(key) {
          console.log('[SW] Suppression:', key);
          return caches.delete(key);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(event) {
  var url = event.request.url;
  if (event.request.method !== 'GET') return;

  // Ne jamais toucher à Firebase / Google APIs
  if (url.includes('firebaseapp.com') || url.includes('googleapis.com') ||
      url.includes('firestore.googleapis.com') || url.includes('firebase.googleapis.com')) {
    return;
  }

  // Fichiers de l'app (/V3mdm/…) : Network First SANS cache HTTP (toujours la dernière version).
  // Repli sur le cache uniquement si le réseau est indisponible (mode hors-ligne).
  if (url.includes('/V3mdm/') || url.endsWith('/V3mdm')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).then(function(response) {
        if (response && response.status === 200 && response.type === 'basic') {
          var clone = response.clone();
          caches.open(CACHE_STATIC).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function() {
        return caches.match(event.request);
      })
    );
    return;
  }

  // Polices Google + librairies CDN : Cache First (immuables et versionnées par URL).
  if (url.includes('fonts.') || url.includes('cdnjs.') || url.includes('jsdelivr.')) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        return cached || fetch(event.request).then(function(response) {
          if (response && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE_STATIC).then(function(c) { c.put(event.request, clone); });
          }
          return response;
        });
      })
    );
    return;
  }
});

self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
