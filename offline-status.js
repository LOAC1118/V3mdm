/* =======================================================================
   offline-status.js  —  Robustesse hors-ligne (MDM V3, module 5)
   -----------------------------------------------------------------------
   1) Active la persistance Firestore (cache local) => l'app fonctionne
      sans réseau pendant une visite : lectures servies depuis le cache,
      écritures mises en file et synchronisées au retour du réseau.
   2) Affiche un badge d'état : En ligne / Hors ligne / Synchro… + nombre
      d'écritures en attente.

   ⚠️ IMPORTANT : la persistance doit être activée AVANT toute autre
   opération Firestore. Le mieux est d'ajouter la ligne ci-dessous
   DIRECTEMENT dans ton init Firebase (voir bloc SNIPPET en bas), plutôt
   que de compter sur l'ordre de chargement des scripts.
   ======================================================================= */
(function () {
  'use strict';

  var CSS = [
    '.ofl-badge{position:fixed;z-index:9998;left:50%;bottom:calc(env(safe-area-inset-bottom,0) + 68px);',
    '  transform:translateX(-50%);display:none;align-items:center;gap:7px;',
    '  padding:7px 13px;border-radius:999px;font:600 12.5px/1 "Inter",system-ui,sans-serif;',
    '  box-shadow:0 6px 20px rgba(0,0,0,.18);transition:.25s;white-space:nowrap}',
    '.ofl-badge.show{display:inline-flex}',
    '.ofl-badge .dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto}',
    '.ofl-off{background:#3a2a12;color:#ffd9a8;border:1px solid #6b4a1f}',
    '.ofl-off .dot{background:#ff9f43;box-shadow:0 0 0 3px rgba(255,159,67,.25)}',
    '.ofl-sync{background:#0f2e1c;color:#a8f0c4;border:1px solid #1f6b45}',
    '.ofl-sync .dot{background:#28c76f;animation:oflPulse 1s infinite}',
    '.ofl-back{background:#0f2e1c;color:#a8f0c4;border:1px solid #1f6b45}',
    '.ofl-back .dot{background:#28c76f}',
    '@keyframes oflPulse{0%,100%{opacity:1}50%{opacity:.3}}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('ofl-style')) return;
    var s = document.createElement('style');
    s.id = 'ofl-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  var el, hideTimer, pending = 0;

  function badge() {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'ofl-badge';
    el.innerHTML = '<span class="dot"></span><span class="txt"></span>';
    document.body.appendChild(el);
    return el;
  }

  function render(state, text, autoHide) {
    injectCSS();
    var b = badge();
    b.className = 'ofl-badge show ofl-' + state;
    b.querySelector('.txt').textContent = text;
    clearTimeout(hideTimer);
    if (autoHide) {
      hideTimer = setTimeout(function () { b.classList.remove('show'); }, 2600);
    }
  }
  function hide() { clearTimeout(hideTimer); if (el) el.classList.remove('show'); }

  function refresh() {
    if (!navigator.onLine) {
      render('off', pending > 0 ? ('Hors ligne · ' + pending + ' en attente') : 'Hors ligne — saisie possible', false);
    } else if (pending > 0) {
      render('sync', 'Synchronisation… (' + pending + ')', false);
    } else {
      hide();
    }
  }

  // Suivi des écritures en attente via l'état de synchro Firestore.
  // On s'appuie sur onSnapshot(metadata) d'un doc "heartbeat" léger.
  function watchPending() {
    try {
      if (typeof bcol !== 'function') return;
      var ref = bcol('config').doc('_sync_heartbeat');
      ref.onSnapshot({ includeMetadataChanges: true }, function (snap) {
        // hasPendingWrites = cette écriture n'est pas encore confirmée serveur
        var hp = snap.metadata.hasPendingWrites;
        pending = hp ? Math.max(pending, 1) : 0;
        refresh();
      }, function () {});
    } catch (e) { /* silencieux */ }
  }

  // Appelé par l'app juste avant/après une écriture importante (optionnel,
  // pour un compteur précis). Renvoie un "done" à appeler quand résolu.
  function trackWrite() {
    pending++; refresh();
    return function done() { pending = Math.max(0, pending - 1); refresh(); };
  }

  function mount() {
    injectCSS();
    window.addEventListener('online', function () {
      render('back', 'De retour en ligne', true);
      setTimeout(refresh, 300);
    });
    window.addEventListener('offline', refresh);
    watchPending();
    refresh();
  }

  /* Active la persistance si pas déjà fait par l'init (voir SNIPPET).
     Renvoie une promesse. À n'utiliser QUE si tu ne peux pas mettre le
     snippet dans l'init. */
  function enablePersistence() {
    try {
      if (typeof firebase === 'undefined' || !firebase.firestore) return Promise.resolve(false);
      return firebase.firestore().enablePersistence({ synchronizeTabs: true })
        .then(function () { console.log('[Offline] persistance activée'); return true; })
        .catch(function (err) {
          if (err.code === 'failed-precondition') {
            console.warn('[Offline] persistance : plusieurs onglets ouverts');
          } else if (err.code === 'unimplemented') {
            console.warn('[Offline] persistance non supportée par ce navigateur');
          }
          return false;
        });
    } catch (e) { return Promise.resolve(false); }
  }

  window.OfflineStatus = {
    mount: mount,
    enablePersistence: enablePersistence,
    trackWrite: trackWrite,
    refresh: refresh
  };
})();

/* =======================================================================
   SNIPPET À COLLER DANS TON INIT FIREBASE (recommandé)
   -----------------------------------------------------------------------
   Juste APRÈS firebase.initializeApp(...) et AVANT le premier appel
   Firestore (avant bcol/get/onSnapshot) :

     firebase.firestore().enablePersistence({ synchronizeTabs: true })
       .catch(function(err){ console.warn('persistance:', err.code); });

   Puis, une fois le DOM prêt / après login :

     OfflineStatus.mount();
   ======================================================================= */
