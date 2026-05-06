// ═══════════════════════════════════════════════════════════════
//  MDM CRM — Service Worker PWA
//  Cache stratégie : Network First pour les données Firebase,
//  Cache First pour les assets statiques (fonts, CDN libs)
// ═══════════════════════════════════════════════════════════════

const CACHE_VERSION = 'mdm-crm-v1';
const CACHE_STATIC  = 'mdm-static-v1';

// Assets à mettre en cache immédiatement à l'installation
const STATIC_ASSETS = [
  '/V3mdm/',
  '/V3mdm/index.html',
  '/V3mdm/manifest.json',
  // Fonts Google (mise en cache pour offline)
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Lora:ital,wght@0,500;0,600;1,400&display=swap',
  // CDN libraries
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js',
];

// ── Installation : mise en cache des assets statiques ───────────────────────
self.addEventListener('install', function(event) {
  console.log('[SW] Installation MDM CRM PWA...');
  event.waitUntil(
    caches.open(CACHE_STATIC).then(function(cache) {
      return Promise.allSettled(
        STATIC_ASSETS.map(function(url) {
          return cache.add(url).catch(function(err) {
            console.warn('[SW] Impossible de mettre en cache :', url, err.message);
          });
        })
      );
    }).then(function() {
      console.log('[SW] Cache statique prêt');
      return self.skipWaiting();
    })
  );
});

// ── Activation : nettoyage des anciens caches ───────────────────────────────
self.addEventListener('activate', function(event) {
  console.log('[SW] Activation...');
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          return key !== CACHE_STATIC && key !== CACHE_VERSION;
        }).map(function(key) {
          console.log('[SW] Suppression ancien cache :', key);
          return caches.delete(key);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── Fetch : stratégie selon le type de requête ──────────────────────────────
self.addEventListener('fetch', function(event) {
  var url = event.request.url;

  // Ignorer les requêtes non-GET et Firebase/Firestore (toujours network)
  if (event.request.method !== 'GET') return;
  if (url.includes('firebaseapp.com') ||
      url.includes('googleapis.com/identitytoolkit') ||
      url.includes('securetoken.googleapis.com') ||
      url.includes('firestore.googleapis.com') ||
      url.includes('firebase.googleapis.com')) {
    return; // Laisse passer sans interception
  }

  // Fonts Google & CDN → Cache First (offline friendly)
  if (url.includes('fonts.googleapis.com') ||
      url.includes('fonts.gstatic.com') ||
      url.includes('cdnjs.cloudflare.com')) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        return fetch(event.request).then(function(response) {
          if (!response || response.status !== 200) return response;
          var clone = response.clone();
          caches.open(CACHE_STATIC).then(function(cache) {
            cache.put(event.request, clone);
          });
          return response;
        }).catch(function() {
          return new Response('', { status: 503 });
        });
      })
    );
    return;
  }

  // Page principale index.html → Network First, fallback cache
  if (url.includes('/V3mdm/') || url.endsWith('/V3mdm')) {
    event.respondWith(
      fetch(event.request).then(function(response) {
        if (!response || response.status !== 200) throw new Error('Network error');
        var clone = response.clone();
        caches.open(CACHE_STATIC).then(function(cache) {
          cache.put(event.request, clone);
        });
        return response;
      }).catch(function() {
        console.log('[SW] Réseau indisponible, utilisation du cache pour :', url);
        return caches.match('/V3mdm/index.html') || caches.match('/V3mdm/');
      })
    );
    return;
  }
});

// ── Message handler : force update ─────────────────────────────────────────
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
