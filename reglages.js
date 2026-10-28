/* ═══════════════════════════════════════════════════════════════════════
   RÉGLAGES — page de configuration du CRM
   • Sections affichées (par utilisateur, synchronisé entre appareils)
   • Données : synchronisation, rechargement, cache de cet appareil
   • Équipe & comptes (admin), marque, relevés, compte, application
   Masquer une section ne supprime rien : elle reste accessible ici.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  var LOCKED = ['dashboard', 'bdc', 'contacts-db', 'releves', 'reglages'];
  var GROUPS = [
    { t: 'Principal', items: [['agenda', '📅', 'Agenda', 'Rendez-vous, actions et alertes']] },
    { t: 'Terrain', items: [
      ['recherche', '🔍', 'Recherche produit', 'Fiches produit du catalogue et du site'],
      ['tournees', '🗺️', 'Tournées', 'Préparation d’itinéraires'],
      ['visites', '📝', 'Visites', 'Comptes rendus liés à l’agenda'],
      ['notes', '🗒️', 'Notes', 'Notes libres rattachées aux clients'],
      ['cadencier', '🗓️', 'Cadencier', 'Cadencier client'],
      ['accords', '🤝', 'Accords commerciaux', 'Conditions par groupement']] },
    { t: 'Analyse', items: [
      ['radar', '📡', 'Radar', 'Radar clients'],
      ['top100', '🏆', 'Top 100 produits', 'Meilleures ventes'],
      ['commissions', '💶', 'Commissions', 'Commission en cours et détail'],
      ['assortiment', '🧩', 'Assortiment', 'Analyse de gamme'],
      ['alertes', '🔔', 'Alertes', 'Alertes commerciales']] },
    { t: 'Outils', items: [
      ['mailing', '✉️', 'Mailing', 'Emails promotionnels'],
      ['promos', '📄', 'Promos PDF', 'Documents promotionnels'],
      ['ia', '🤖', 'Assistant IA', 'Page de l’assistant et clé API'],
      ['rgpd', '⚖️', 'Conformité (RGPD)', 'Registre et mentions légales'],
      ['frais', '🧾', 'Notes de frais', 'Saisie et PDF mensuel']] }
  ];
  var PRESETS = {
    terrain: ['visites', 'tournees', 'ia', 'alertes', 'assortiment', 'radar', 'top100', 'mailing', 'promos', 'rgpd'],
    tout: []
  };
  var _H = [];

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function $(id){ return document.getElementById(id); }
  function uid(){ try { return (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || ''; } catch(e){ return ''; } }
  function key(){ return 'cfg_hidden_sections_' + (uid() || 'anon'); }
  function admin(){ try { return typeof isAdminUser === 'function' && isAdminUser(); } catch(e){ return false; } }
  function manager(){ try { return typeof isManagerUser === 'function' && isManagerUser(); } catch(e){ return false; } }
  function note(m, t){ try { toast(m, t || 'ok'); } catch(e){} }

  function readLocal() { try { var v = JSON.parse(localStorage.getItem(key()) || localStorage.getItem('cfg_hidden_sections_anon') || '[]'); return Array.isArray(v) ? v : []; } catch(e){ return []; } }
  function writeLocal() { try { localStorage.setItem(key(), JSON.stringify(_H)); } catch(e){} }
  function saveCloud() {
    try { if (typeof db !== 'undefined' && db && uid()) db.collection('profils').doc(uid()).set({ sectionsMasquees: _H, sectionsMajAt: Date.now() }, { merge: true }).catch(function(){}); } catch(e){}
  }
  function loadCloud() {
    try {
      if (typeof db === 'undefined' || !db || !uid()) return;
      db.collection('profils').doc(uid()).get().then(function(d){
        var v = d.exists && d.data().sectionsMasquees; if (!Array.isArray(v)) return;
        _H = v.filter(function(s){ return LOCKED.indexOf(s) === -1; }); writeLocal(); apply(); paint();
      }).catch(function(){});
    } catch(e){}
  }

  // ── Application dans les menus (bureau, barre du haut, menu iPhone) ──
  function apply() {
    var all = []; GROUPS.forEach(function(g){ g.items.forEach(function(i){ all.push(i[0]); }); });
    all.forEach(function(s){
      var off = _H.indexOf(s) !== -1;
      document.querySelectorAll('[data-sec="' + s + '"]').forEach(function(e){ e.classList.toggle('cfg-off', off); });
      document.querySelectorAll('.nav-item').forEach(function(e){ var oc = e.getAttribute('onclick') || ''; if (oc.indexOf("showSection('" + s + "'") !== -1) e.classList.toggle('cfg-off', off); });
    });
    document.querySelectorAll('.t-menu').forEach(function(m){
      var its = m.querySelectorAll('.t-item:not(.hidden)'), vis = [].filter.call(its, function(e){ return !e.classList.contains('cfg-off'); });
      m.classList.toggle('cfg-off', its.length > 0 && !vis.length);
    });
  }
  function toggle(s, on) {
    if (LOCKED.indexOf(s) !== -1) return;
    _H = _H.filter(function(x){ return x !== s; }); if (!on) _H.push(s);
    writeLocal(); saveCloud(); apply(); paint();
  }
  function preset(name) { _H = (PRESETS[name] || []).slice(); writeLocal(); saveCloud(); apply(); paint(); note(name === 'tout' ? 'Toutes les sections sont affichées' : 'Mode terrain appliqué'); }

  // ── Actions ──
  function go(s) { try { showSection(s, null, null); } catch(e){} }
  function sync() { try { openSyncModal(); } catch(e){ note('Synchronisation indisponible', 'err'); } }
  function brand(b) { try { setCurrentBrand(b); } catch(e){} setTimeout(paint, 300); }
  function clearCache() {
    if (!confirm('Vider le cache de cet appareil et recharger ? Vos données dans le cloud ne sont pas touchées.')) return;
    try { Object.keys(localStorage).forEach(function(k){ if (/^(mdm_contacts_cache|dashca_|mdm_dashca|cdb_|mdm_cache)/i.test(k)) localStorage.removeItem(k); }); } catch(e){}
    location.reload();
  }
  function reloadApp() { try { if ('caches' in window) caches.keys().then(function(K){ return Promise.all(K.map(function(k){ return caches.delete(k); })); }).finally(function(){ location.reload(); }); else location.reload(); } catch(e){ location.reload(); } }
  function releves(fn) { go('releves'); setTimeout(function(){ try { if (fn === 'orph') Releves.orphOpen(); else if (window.Releves && Releves.refEdit) Releves.refEdit(); } catch(e){} }, 400); }

  // ── Rendu ──
  function card(title, body) { return '<div class="cfg-card"><div class="cfg-t">' + title + '</div>' + body + '</div>'; }
  function btn(label, fn, cls) { return '<button class="btn ' + (cls || 'btn-ghost') + ' cfg-b" onclick="' + fn + '">' + label + '</button>'; }
  function row(ico, label, sub, right) { return '<div class="cfg-row"><div class="cfg-ico">' + ico + '</div><div class="cfg-tx"><b>' + label + '</b><small>' + esc(sub || '') + '</small></div>' + (right || '') + '</div>'; }
  function sw(s) {
    var on = _H.indexOf(s) === -1;
    return '<label class="cfg-sw"><input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="Reglages.toggle(\'' + s + '\',this.checked)"><span></span></label>';
  }
  function paint() {
    var h = $('reglages-host'); if (!h) return;
    var u = null; try { u = currentUser; } catch(e){}
    var br = ''; try { br = CURRENT_BRAND; } catch(e){}
    var secHtml = GROUPS.map(function(g){
      return '<div class="cfg-g">' + esc(g.t) + '</div>' + g.items.map(function(i){ return row(i[1], i[2], i[3], sw(i[0])); }).join('');
    }).join('');
    var hidden = []; GROUPS.forEach(function(g){ g.items.forEach(function(i){ if (_H.indexOf(i[0]) !== -1) hidden.push(i); }); });
    var hiddenHtml = hidden.length ? '<div class="cfg-g">Accès direct aux sections masquées</div><div class="cfg-chips">' + hidden.map(function(i){ return '<button class="cfg-chip" onclick="Reglages.go(\'' + i[0] + '\')">' + i[1] + ' ' + esc(i[2]) + '</button>'; }).join('') + '</div>' : '';
    h.innerHTML = '<div class="cfg-wrap"><div class="page-header"><div><div class="page-title">⚙️ Réglages</div><div class="page-sub">Configurer le CRM · vos choix sont mémorisés sur tous vos appareils</div></div></div>'
      + card('📱 Sections affichées', '<div class="cfg-sub">Décochez ce que vous n’utilisez pas : la section disparaît des menus. Rien n’est supprimé, vous pouvez la réafficher à tout moment.</div>'
        + '<div class="cfg-acts">' + btn('📱 Mode terrain', "Reglages.preset('terrain')") + btn('Tout afficher', "Reglages.preset('tout')") + '</div>'
        + '<div class="cfg-fixed">Toujours affichés : Dashboard, Bon de commande, Clients, Relevés magasins.</div>' + secHtml + hiddenHtml)
      + card('🔄 Données',
        row('🔄', 'Synchroniser les données', 'Importer le fichier CA, le stock, les commandes…', btn('Ouvrir', 'Reglages.sync()', 'btn-primary'))
        + row('🧹', 'Vider le cache de cet appareil', 'À utiliser si des chiffres semblent anciens (le cloud n’est pas touché)', btn('Vider', 'Reglages.clearCache()'))
        + row('⟳', 'Recharger l’application', 'Charge la dernière version du CRM', btn('Recharger', 'Reglages.reloadApp()')))
      + ((admin() || manager()) ? card('👥 Équipe & comptes',
        row('👥', 'Équipe', 'Commerciaux, rôles et secteurs', btn('Ouvrir', "Reglages.go('equipe')"))
        + (admin() ? row('🔑', 'Comptes', 'Création et gestion des accès', btn('Ouvrir', "Reglages.go('comptes')")) : '')) : '')
      + card('🏷️ Marque', row('🌾', 'Marque active', 'Moulin des Moines ou Naturaline', '<div class="cfg-acts" style="margin:0">' + btn('MDM', "Reglages.brand('mdm')", br === 'mdm' ? 'btn-primary' : 'btn-ghost') + btn('Naturaline', "Reglages.brand('naturaline')", br === 'naturaline' ? 'btn-primary' : 'btn-ghost') + '</div>'))
      + card('🛒 Relevés magasins',
        row('📋', 'Listes produits par enseigne', 'Biocoop, Marcel & Fils, Eau Vive, listes importées', btn('Ouvrir', "Reglages.releves('ref')"))
        + row('🔗', 'Relevés à rattacher à un client', 'Pour qu’ils apparaissent dans l’analyse client', btn('Vérifier', "Reglages.releves('orph')")))
      + card('👤 Mon compte',
        row('👤', esc((u && (u.displayName || u.email)) || '—'), (u && u.email ? u.email : '') + (admin() ? ' · Admin' : manager() ? ' · Directeur' : ' · Commercial'), btn('Mon profil', 'openProfilModal()'))
        + row('🚪', 'Se déconnecter', '', btn('Déconnexion', 'doLogout()')))
      + '</div>';
  }
  function mount() { _H = readLocal().filter(function(s){ return LOCKED.indexOf(s) === -1; }); paint(); apply(); }

  function css() {
    if ($('cfg-css')) return;
    var s = document.createElement('style'); s.id = 'cfg-css';
    s.textContent = '.cfg-off{display:none !important}'
      + '#nav-item-equipe,#mtab-equipe,#mtab-comptes,#t-tab-comptes{display:none !important}'
      + '#sec-reglages{padding:1.75rem 2rem;overflow-y:auto;flex:1;background:var(--bg);box-sizing:border-box}'
      + '.cfg-wrap{max-width:760px;margin:0 auto}.cfg-card{background:var(--surface,#fff);border:1px solid var(--border,#e7e3da);border-radius:16px;padding:1rem 1.1rem;margin-bottom:1rem}'
      + '.cfg-t{font-weight:700;font-size:.95rem;margin-bottom:.5rem}.cfg-sub{font-size:.8rem;color:#8a857d;margin-bottom:.6rem}.cfg-fixed{font-size:.74rem;color:#8a857d;margin:.4rem 0 .2rem}'
      + '.cfg-g{font-size:.68rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#8a857d;margin:.9rem 0 .2rem}'
      + '.cfg-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid #f0eee8}.cfg-row:first-of-type{border-top:0}'
      + '.cfg-ico{width:30px;text-align:center;font-size:1.15rem}.cfg-tx{flex:1;min-width:0}.cfg-tx b{display:block;font-size:.88rem}.cfg-tx small{display:block;color:#8a857d;font-size:.74rem}'
      + '.cfg-acts{display:flex;gap:8px;flex-wrap:wrap;margin:.3rem 0}.cfg-b{white-space:nowrap;min-height:40px}'
      + '.cfg-sw{position:relative;display:inline-block;width:46px;height:28px;flex:0 0 auto}.cfg-sw input{opacity:0;width:100%;height:100%;position:absolute;margin:0;z-index:2;cursor:pointer}'
      + '.cfg-sw span{position:absolute;inset:0;background:#cfcabf;border-radius:99px;transition:.2s}.cfg-sw span:before{content:"";position:absolute;left:3px;top:3px;width:22px;height:22px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.3)}'
      + '.cfg-sw input:checked+span{background:var(--brand,#f5511e)}.cfg-sw input:checked+span:before{transform:translateX(18px)}'
      + '.cfg-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:.3rem}.cfg-chip{border:1px solid #ddd;background:#fff;border-radius:99px;padding:8px 14px;font:600 .8rem inherit;cursor:pointer;min-height:40px}'
      + '@media(max-width:768px){#sec-reglages{padding:1rem .9rem 150px}.cfg-row{flex-wrap:wrap}.cfg-row .cfg-b{margin-left:40px}}';
    document.head.appendChild(s);
  }
  function boot() {
    css(); _H = readLocal().filter(function(s){ return LOCKED.indexOf(s) === -1; }); apply();
    var n = 0, t = setInterval(function(){ n++; apply(); if (uid() && n === 2) loadCloud(); if (n > 12) clearInterval(t); }, 1500);   // les menus et le compte arrivent après l'ouverture
    var orig = window.showSection;
    if (typeof orig === 'function' && !orig.__cfg) {
      var w = function(name){ var r = orig.apply(this, arguments); if (name === 'reglages') mount(); return r; };
      w.__cfg = 1; window.showSection = w;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ setTimeout(boot, 600); }); else setTimeout(boot, 600);
  window.Reglages = { mount: mount, toggle: toggle, preset: preset, go: go, sync: sync, brand: brand, clearCache: clearCache, reloadApp: reloadApp, releves: releves, apply: apply };
})();
