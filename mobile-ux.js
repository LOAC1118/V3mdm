/* ═══════════════════════════════════════════════════════════════════════
   MOBILE UX — confort d'utilisation sur iPhone (écrans ≤ 768 px)
   1) Barre du bas à 5 entrées : Accueil · Relevés · ＋ Visite · Clients · Plus
   2) « Démarrer une visite » : recherche d'un magasin, magasins récents,
      reprise du relevé du jour — un seul geste pour commencer
   3) Saisie : champs à 16 px (plus de zoom automatique d'iOS), zones tactiles
      de 44 px, bulles flottantes réduites et masquées pendant un relevé
   Utilisation : MobileUX.visit()  ·  MobileUX.sync()
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  var _sec = 'dashboard', _wrapped = false;
  var TABS = [
    { id: 'dashboard', ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>', lbl: 'Accueil' },
    { id: 'releves', ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>', lbl: 'Relevés' },
    { id: '__visit', ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>', lbl: 'Visite', main: true },
    { id: 'contacts-db', ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.4 2.7-6 6-6s6 2.6 6 6"/><path d="M16 5a3 3 0 010 6M18 14c2 .7 3 2.6 3 6"/></svg>', lbl: 'Clients' },
    { id: '__more', ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>', lbl: 'Plus' }
  ];

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function $(id){ return document.getElementById(id); }
  function norm(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').trim(); }
  function note(m,t){ try { toast(m,t||'ok'); } catch(e){ console.log(m); } }
  function contacts(){ return (typeof cdbContacts !== 'undefined' && cdbContacts) ? cdbContacts : []; }
  function frDate(s){ var p = String(s||'').split('-'); return p.length === 3 ? p[2] + '/' + p[1] : s; }
  function isMobile(){ return window.matchMedia && window.matchMedia('(max-width: 768px)').matches; }

  // ── 1) Barre du bas ──
  function buildTabs() {
    var bar = document.querySelector('.mobile-navbar'); if (!bar || bar.getAttribute('data-mux')) return;
    bar.setAttribute('data-mux', '1');
    bar.innerHTML = '<div class="mux-tabs">' + TABS.map(function(t){
      return '<button class="mux-tab' + (t.main ? ' main' : '') + '" data-tab="' + t.id + '" onclick="MobileUX.tab(\'' + t.id + '\')" aria-label="' + t.lbl + '"><span class="mux-ico">' + t.ico + '</span><span class="mux-lbl">' + t.lbl + '</span></button>';
    }).join('') + '</div>';
    markActive();
  }
  function tab(id) {
    if (id === '__visit') return visit();
    if (id === '__more') { try { openMobileMenu(); } catch(e){} return; }
    try { showSection(id, null, null); } catch(e){}
  }
  function markActive() {
    document.querySelectorAll('.mux-tab').forEach(function(b){ var id = b.getAttribute('data-tab'); b.classList.toggle('on', id === _sec || (id === '__more' && ['dashboard', 'releves', 'contacts-db'].indexOf(_sec) === -1)); });
  }
  function wrap() {
    if (_wrapped || typeof window.showSection !== 'function') return; _wrapped = true;
    var orig = window.showSection;
    window.showSection = function (name) { try { if (window.Releves && Releves.scanClose && document.getElementById('rl-scan')) Releves.scanClose(); } catch(e){} var r = orig.apply(this, arguments); _sec = name; markActive(); sync(); var o = document.getElementById('mux-dash-visit'); if (o) o.remove(); return r; };
  }
  // pendant un relevé, les bulles flottantes sont masquées (elles couvraient les boutons de pointage)
  function sync() {
    var edit = false; try { edit = _sec === 'releves' && window.Releves && Releves.isEditing && Releves.isEditing(); } catch(e){}
    document.body.classList.toggle('rl-editing', !!edit);
  }

  // ── 2) Démarrer une visite ──
  var _ens = 'catalogue';
  function addDashButton() {
    var d = $('sec-dashboard'); if (!d || $('mux-dash-visit')) return;
    var hd = d.querySelector('.page-header'); if (!hd) return;
    var b = document.createElement('button'); b.id = 'mux-dash-visit'; b.className = 'mux-big'; b.type = 'button';
    b.innerHTML = '<span style="font-size:1.5rem">🏪</span><span style="flex:1;text-align:left"><b>Démarrer une visite</b><small>Relevé, notes et photos du magasin</small></span><span style="font-size:1.4rem">›</span>';
    b.onclick = visit; hd.parentNode.insertBefore(b, hd.nextSibling);
  }
  function stores(q) {
    q = norm(q); var L = contacts(), out = [];
    if (!q) return out;
    var toks = q.split(' ');
    L.forEach(function(c){ var h = norm([c.nom, c.ville, c.numClient, c.groupe, c.cp].join(' ')); if (toks.every(function(t){ return h.indexOf(t) !== -1; })) out.push(c); });
    out.sort(function(a, b){ return String(a.nom).localeCompare(String(b.nom), 'fr'); });
    return out.slice(0, 40);
  }
  function visit() {
    try { if (window.Releves && Releves.scanClose && $('rl-scan')) Releves.scanClose(); } catch(e){}
    css(); var old = $('mux-ov'); if (old) old.remove();
    var ov = document.createElement('div'); ov.id = 'mux-ov'; ov.onclick = function(e){ if (e.target === ov) closeVisit(); };
    var ens = (window.Releves && Releves.ensChoices) ? Releves.ensChoices() : [{ id: 'catalogue', nom: 'Toutes enseignes' }];
    ov.innerHTML = '<div class="mux-sheet"><div class="mux-h"><b>🏪 Démarrer une visite</b><button class="mux-x" onclick="MobileUX.closeVisit()" aria-label="Fermer">✕</button></div>'
      + '<div class="mux-b"><input id="mux-q" type="search" placeholder="Nom du magasin, ville, n° client…" autocomplete="off" oninput="MobileUX.find(this.value)">'
      + '<div class="mux-m" style="margin:10px 0 4px">Type de relevé</div><select id="mux-ens" onchange="MobileUX.setEns(this.value)">' + ens.map(function(e){ return '<option value="' + esc(e.id) + '"' + (e.id === _ens ? ' selected' : '') + '>' + esc(e.nom) + '</option>'; }).join('') + '</select>'
      + '<div id="mux-res" style="margin-top:12px"></div></div></div>';
    document.body.appendChild(ov);
    find('');
  }
  function closeVisit() { var o = $('mux-ov'); if (o) o.remove(); }
  function setEns(v) { _ens = v; }
  function row(m, sub, tag) {
    return '<button class="mux-row" data-id="' + esc(m.clientId || '') + '" data-nom="' + esc(m.nom) + '" data-ville="' + esc(m.ville || '') + '" data-ens="' + esc(m.ens || '') + '" onclick="MobileUX.pick(this)"><span style="flex:1;text-align:left"><b>' + esc(m.nom) + '</b>' + (m.ville ? ' <span class="mux-m">· ' + esc(m.ville) + '</span>' : '') + (sub ? '<br><span class="mux-m">' + sub + '</span>' : '') + '</span>' + (tag ? '<span class="mux-tag">' + tag + '</span>' : '') + '<span>›</span></button>';
  }
  function find(v) {
    var r = $('mux-res'); if (!r) return; var q = String(v || '').trim(), h = '';
    var rec = (window.Releves && Releves.recentStores) ? Releves.recentStores(8) : [];
    if (rec.then) { rec.then(function(L){ paint(L); }); } else paint(rec);
    function paint(R) {
      r = $('mux-res'); if (!r) return; var hh = '';
      if (!q) {
        hh += R.length ? '<div class="mux-m" style="margin-bottom:4px">Magasins récents</div>' + R.map(function(m){ var today = m.today ? 'Reprendre' : ''; return row(m, (m.ensNom ? m.ensNom + ' · ' : '') + 'vu le ' + frDate(m.date) + (m.open ? ' · ✅ ' + m.open + ' action(s)' : ''), today); }).join('') : '<div class="mux-m">Tapez le nom d\'un magasin pour commencer.</div>';
      } else {
        var S = stores(q);
        hh += S.length ? S.map(function(c){ return row({ clientId: c.id, nom: c.nom, ville: c.ville || '' }, c.numClient ? 'N° ' + esc(c.numClient) : '', ''); }).join('') : '<div class="mux-m">Aucun client trouvé.</div>';
        hh += '<button class="mux-row" onclick="MobileUX.pickFree()"><span style="flex:1;text-align:left"><b>＋ Autre magasin</b><br><span class="mux-m">« ' + esc(q) + ' » (hors base clients)</span></span><span>›</span></button>';
      }
      r.innerHTML = hh;
    }
  }
  function launch(m) {
    closeVisit();
    if (!window.Releves || !Releves.demarrer) { note('Module relevés indisponible', 'err'); return; }
    Releves.demarrer({ clientId: m.clientId || null, nom: m.nom, ville: m.ville || '', ens: m.ens || _ens });
  }
  function pick(el) { launch({ clientId: el.getAttribute('data-id'), nom: el.getAttribute('data-nom'), ville: el.getAttribute('data-ville'), ens: el.getAttribute('data-ens') }); }
  function pickFree() { var q = $('mux-q'); var v = q ? q.value.trim() : ''; if (v) launch({ clientId: null, nom: v, ville: '' }); }

  // ── 3) Confort de saisie ──
  function css() {
    if ($('mux-css')) return;
    var st = document.createElement('style'); st.id = 'mux-css';
    st.textContent = [
      '#mux-ov{position:fixed;inset:0;z-index:99991;background:rgba(20,18,15,.55);display:flex;align-items:flex-end;justify-content:center}',
      '.mux-sheet{background:#fff;border-radius:18px 18px 0 0;width:100%;max-width:560px;max-height:90vh;display:flex;flex-direction:column;font-family:var(--fd,system-ui,sans-serif);color:#1c1a17;padding-bottom:env(safe-area-inset-bottom,0)}',
      '.mux-h{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #eee;font-size:1.05rem}.mux-x{border:0;background:none;font-size:1.3rem;padding:8px 12px;cursor:pointer}',
      '.mux-b{overflow:auto;padding:12px 16px 18px}.mux-m{color:#8a857d;font-size:.8rem}',
      '#mux-q,#mux-ens{width:100%;box-sizing:border-box;border:1px solid #d9d5cc;border-radius:12px;padding:12px;font:inherit;font-size:16px;background:#fff}',
      '.mux-row{display:flex;align-items:center;gap:10px;width:100%;border:0;border-top:1px solid #eee;background:none;padding:12px 4px;font:inherit;font-size:.95rem;cursor:pointer;min-height:52px}.mux-row:active{background:#f6f3ec}',
      '.mux-tag{background:#e3f4ea;color:#1e7a45;border-radius:99px;font-size:.7rem;font-weight:700;padding:3px 9px}',
      '.mux-big{display:flex;align-items:center;gap:12px;width:100%;box-sizing:border-box;margin:0 0 14px;padding:16px;border:0;border-radius:16px;background:var(--brand,#f5511e);color:#fff;font:inherit;cursor:pointer;box-shadow:0 8px 20px -8px rgba(245,81,30,.6)}',
      '.mux-big b{display:block;font-size:1.05rem}.mux-big small{opacity:.9;font-size:.78rem}'
    ].join('') + [
      '@media (max-width:768px){',
      // barre du bas
      '.mobile-navbar{padding:0 !important;height:calc(62px + env(safe-area-inset-bottom,0px)) !important;align-items:stretch}',
      '.mux-tabs{display:flex;width:100%;padding-bottom:env(safe-area-inset-bottom,0px)}',
      '.mux-tab{flex:1;border:0;background:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;color:#8a857d;font:600 .66rem var(--fd,system-ui,sans-serif);min-height:56px;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '.mux-tab .mux-ico svg{width:24px;height:24px;display:block}.mux-tab.on{color:var(--brand,#f5511e)}',
      '.mux-tab.main{margin-top:-16px;justify-content:flex-start;padding-top:0}.mux-tab.main .mux-ico{background:var(--brand,#f5511e);color:#fff;flex:0 0 50px;width:50px;height:50px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px -4px rgba(245,81,30,.7)}.mobile-navbar{overflow:visible !important}.mux-tab.main .mux-lbl{color:var(--brand,#f5511e)}',
      '.main{padding-bottom:calc(150px + env(safe-area-inset-bottom,0px)) !important}',
      // bulles flottantes : plus petites, au-dessus de la barre ; masquées pendant un relevé
      '#asst-fab{width:42px !important;height:42px !important;font-size:1.2rem !important;right:12px !important;bottom:calc(62px + env(safe-area-inset-bottom,0px) + 12px) !important}',
      '#bot-fab{width:42px !important;height:42px !important;right:12px !important;bottom:calc(62px + env(safe-area-inset-bottom,0px) + 12px) !important}#bot-fab svg{width:21px !important;height:21px !important}',
      '#brand-fab{bottom:calc(62px + env(safe-area-inset-bottom,0px) + 12px) !important;left:10px !important;padding:7px 11px !important;font-size:.72rem !important;opacity:.92}',
      'body.rl-editing #asst-fab,body.rl-editing #bot-fab,body.rl-editing #brand-fab{display:none !important}',
      // saisie : 16 px = pas de zoom d\'iOS ; zones tactiles de 44 px
      'input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]),select,textarea{font-size:16px !important}',
      '.btn,.rl-b,.rl-pt,.mmenu-item,.ag-b,.nt-b{min-height:44px}',
      'input[type=checkbox],input[type=radio]{width:22px;height:22px}',
      '.rl-px{width:96px !important}',
      '}'
    ].join('');
    document.head.appendChild(st);
  }

  function boot() { css(); buildTabs(); wrap(); sync(); if (!document.querySelector('.mux-tabs') || !_wrapped) setTimeout(boot, 800); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.addEventListener('resize', function(){ buildTabs(); });

  window.MobileUX = { visit: visit, closeVisit: closeVisit, find: find, setEns: setEns, pick: pick, pickFree: pickFree, tab: tab, sync: sync, _stores: stores };
})();
