/* =======================================================================
   equipe.js  —  Étape 1 migration équipe : Identité, rôles & secteurs
   -----------------------------------------------------------------------
   Écran manager (réservé admin) pour gérer le référentiel de l'équipe :
   pour chaque membre → rôle (commercial / manager), secteur (région) et
   départements. Stocké dans la collection GLOBALE `equipe`, un document
   par membre (id = e-mail normalisé). Purement ADDITIF : ne change aucun
   comportement existant. Le rattachement au compte (uid) se fait plus tard,
   à la connexion, par e-mail.

   API : Equipe.mount(el?), Equipe.roleForCurrent(), Equipe.load()
   ======================================================================= */
(function () {
  'use strict';

  // Accès sûr à la globale currentUser (déclarée en let dans index.html : pas sur window).
  function CU() { try { return (typeof currentUser !== 'undefined') ? currentUser : null; } catch (e) { return null; } }

  // Pré-remplissage depuis l'organigramme MDM fourni.
  var SEED = [
    { nom:'Christophe de SAINT PIERRE', email:'christophedesaintpierre@moulindesmoines.com', role:'manager',    region:'Direction commerciale', departements:'' },
    { nom:'Sébastien CLUCKERS',         email:'scluckers@moulindesmoines.com',                role:'commercial', region:'Nord-Est',        departements:'' },
    { nom:'Stéphanie LE CORNEC',        email:'slecornec@moulindesmoines.com',                role:'commercial', region:'Île-de-France',   departements:'' },
    { nom:'Pascal LE NAOUR',            email:'plenaour@moulindesmoines.com',                 role:'commercial', region:'Nord-Ouest',      departements:'' },
    { nom:'Christophe SPOTO',           email:'cspoto@moulindesmoines.com',                   role:'commercial', region:'Centre-Est',      departements:'' },
    { nom:'Guillaume DEVANNES',         email:'gdevannes@moulindesmoines.com',                role:'commercial', region:'Sud-Ouest',       departements:'' },
    { nom:'Patricia POLITO',            email:'ppolito@moulindesmoines.com',                  role:'commercial', region:'Sud-Est',         departements:'' }
  ];

  var _roster = null;

  function slugMail(m) { return String(m || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  async function load() {
    _roster = [];
    try {
      var snap = await db.collection('equipe').get();
      snap.forEach(function (d) { _roster.push(Object.assign({ _id: d.id }, d.data())); });
    } catch (e) { console.warn('[Equipe] load', e && e.message); }
    return _roster;
  }

  // Rôle du compte connecté (par e-mail). null si absent du référentiel.
  function roleForCurrent() {
    try {
      if (!_roster || !CU()) return null;
      var mail = (currentUser.email || '').toLowerCase();
      var m = _roster.find(function (x) { return (x.email || '').toLowerCase() === mail; });
      return m ? (m.role || 'commercial') : null;
    } catch (e) { return null; }
  }

  var CSS = [
    '.eq-wrap{max-width:900px;margin:0 auto;padding:4px 2px 90px}',
    '.eq-h{margin:6px 2px 16px}',
    '.eq-h h2{font:600 20px/1.1 "Fraunces",Georgia,serif;margin:0 0 4px;color:var(--g900,#1a1a1a)}',
    '.eq-h p{font:500 13px/1.4 "Inter",sans-serif;color:var(--g600,#8a8f87);margin:0}',
    '.eq-row{display:grid;grid-template-columns:1.4fr 1fr 1.1fr 1fr auto;gap:10px;align-items:center;background:#fff;border:1px solid #e7e9e5;border-radius:12px;padding:10px 12px;margin-bottom:8px}',
    '@media(max-width:720px){.eq-row{grid-template-columns:1fr 1fr;}}',
    '.eq-row input,.eq-row select{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d8dcd4;border-radius:8px;font:500 13px "Inter",sans-serif;background:#fff}',
    '.eq-nom{font-weight:600}',
    '.eq-role-manager{border-color:#266327 !important;background:#eaf5ee !important;color:#266327;font-weight:600}',
    '.eq-del{appearance:none;border:1px solid #e7c9c2;background:#fff8f5;color:#b42318;border-radius:8px;padding:8px 10px;cursor:pointer;font-size:12px}',
    '.eq-bar{display:flex;gap:9px;flex-wrap:wrap;margin:14px 2px}',
    '.eq-btn{appearance:none;border:1px solid var(--accent,#266327);background:var(--accent,#266327);color:#fff;font:600 13px "Inter",sans-serif;padding:10px 16px;border-radius:9px;cursor:pointer}',
    '.eq-btn.ghost{background:#fff;color:var(--accent,#266327)}',
    '.eq-note{font:500 12px/1.5 "Inter",sans-serif;color:#9aa096;margin:2px}',
    '.eq-lbl{font:600 10px/1 "Inter",sans-serif;text-transform:uppercase;letter-spacing:.05em;color:#9aa096;margin-bottom:4px;display:block}',
    '.eq-empty{padding:26px;text-align:center;color:#9aa096;font:500 13px "Inter",sans-serif;background:#fff;border:1px dashed #d8dcd4;border-radius:12px}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('eq-style')) return;
    var s = document.createElement('style'); s.id = 'eq-style'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  function rowHTML(m, i) {
    return '<div class="eq-row" data-i="' + i + '">'
      + '<div><span class="eq-lbl">Nom</span><input class="eq-f" data-k="nom" value="' + esc(m.nom) + '" placeholder="Prénom NOM"></div>'
      + '<div><span class="eq-lbl">E-mail</span><input class="eq-f" data-k="email" value="' + esc(m.email) + '" placeholder="prenom@..."></div>'
      + '<div><span class="eq-lbl">Rôle</span><select class="eq-f eq-role" data-k="role">'
      +   '<option value="commercial"' + (m.role !== 'manager' ? ' selected' : '') + '>Commercial</option>'
      +   '<option value="manager"' + (m.role === 'manager' ? ' selected' : '') + '>Manager</option>'
      + '</select></div>'
      + '<div><span class="eq-lbl">Secteur</span><input class="eq-f" data-k="region" value="' + esc(m.region) + '" placeholder="Région"></div>'
      + '<div style="grid-column:1/-1"><span class="eq-lbl">Départements (n° séparés par des virgules)</span>'
      +   '<input class="eq-f" data-k="departements" value="' + esc(m.departements) + '" placeholder="ex : 38, 73, 74, 69, 01, 26, 07"></div>'
      + '<div style="grid-column:1/-1;text-align:right"><button class="eq-del" data-del="' + i + '">Retirer</button></div>'
      + '</div>';
  }

  function collectRows(host) {
    var rows = host.querySelectorAll('.eq-row');
    var out = [];
    rows.forEach(function (r) {
      var m = {};
      r.querySelectorAll('.eq-f').forEach(function (f) { m[f.getAttribute('data-k')] = f.value.trim(); });
      if (m.email) out.push(m);
    });
    return out;
  }

  function paintRoleColors(host) {
    host.querySelectorAll('.eq-role').forEach(function (sel) {
      sel.classList.toggle('eq-role-manager', sel.value === 'manager');
    });
  }

  async function render(host) {
    injectCSS();
    if (typeof isAdminUser === 'function' && !isAdminUser()) {
      host.innerHTML = '<div class="eq-empty">Cet écran est réservé au manager.</div>';
      return;
    }
    await load();
    var list = (_roster && _roster.length) ? _roster.slice() : null;

    var body = list
      ? list.map(function (m, i) { return rowHTML(m, i); }).join('')
      : '<div class="eq-empty">Aucune équipe enregistrée pour l\'instant.<br>Tu peux pré-remplir avec l\'équipe MDM, puis ajuster les rôles et départements.</div>';

    host.innerHTML =
      '<div class="eq-wrap">'
      + '<div class="eq-h"><h2>Équipe · rôles & secteurs</h2>'
      +   '<p>Définis le rôle et le secteur de chaque commercial. Le rattachement au compte se fera à leur première connexion (par e-mail).</p></div>'
      + '<div id="eq-list">' + body + '</div>'
      + '<div class="eq-bar">'
      +   (list ? '<button class="eq-btn" id="eq-save">💾 Enregistrer l\'équipe</button>'
              + '<button class="eq-btn ghost" id="eq-add">+ Ajouter un membre</button>'
            : '<button class="eq-btn" id="eq-seed">Pré-remplir avec l\'équipe MDM</button>'
              + '<button class="eq-btn ghost" id="eq-add">+ Ajouter un membre</button>')
      + '</div>'
      + '<p class="eq-note">Astuce : mets « Manager » à qui doit tout voir (toi, et/ou le directeur commercial). Les départements servent à attribuer les clients automatiquement à l\'étape suivante.</p>'
      + '</div>';

    var listEl = host.querySelector('#eq-list');
    paintRoleColors(host);
    host.addEventListener('change', function (e) { if (e.target.classList.contains('eq-role')) paintRoleColors(host); });
    host.addEventListener('click', function (e) {
      var del = e.target.getAttribute && e.target.getAttribute('data-del');
      if (del !== null && del !== undefined && e.target.classList.contains('eq-del')) {
        var row = e.target.closest('.eq-row'); if (row) row.remove();
      }
    });

    var seedBtn = host.querySelector('#eq-seed');
    if (seedBtn) seedBtn.onclick = function () {
      listEl.innerHTML = SEED.map(function (m, i) { return rowHTML(m, i); }).join('');
      // bascule la barre pour montrer Enregistrer
      host.querySelector('.eq-bar').innerHTML = '<button class="eq-btn" id="eq-save2">💾 Enregistrer l\'équipe</button><button class="eq-btn ghost" id="eq-add2">+ Ajouter un membre</button>';
      paintRoleColors(host);
      host.querySelector('#eq-save2').onclick = function () { saveAll(host); };
      host.querySelector('#eq-add2').onclick = function () { addRow(listEl); };
    };

    var addBtn = host.querySelector('#eq-add');
    if (addBtn) addBtn.onclick = function () { addRow(listEl); };
    var saveBtn = host.querySelector('#eq-save');
    if (saveBtn) saveBtn.onclick = function () { saveAll(host); };

    if (typeof __USE_TEST !== 'undefined' && __USE_TEST) appendMigration(host);
  }

  // ── Migration modèle B (bac à sable uniquement) ──────────────────────
  var MIG_SCOPED = ['clients','contacts','prospects','commandes','commandes_meta','commandes_stats','frais','notes_frais','activite','objectifs_ca','config','cadenciers','visites','visites_photos'];
  var MIG_BRANDS = ['mdm','naturaline'];

  function appendMigration(host) {
    var wrap = host.querySelector('.eq-wrap'); if (!wrap) return;
    var box = document.createElement('div');
    box.style.cssText = 'margin-top:26px;padding:14px 16px;border:1px dashed #d8a34a;border-radius:12px;background:#fffaf0';
    box.innerHTML =
      '<div style="font:600 13px/1.3 Inter,sans-serif;color:#8a5a12;margin-bottom:6px;">⚙️ Zone technique — bac à sable · Migration modèle B</div>'
      + '<div style="font:500 12px/1.5 Inter,sans-serif;color:#9a7b3a;margin-bottom:10px;">Copie tes collections par-utilisateur (…_' + (CU()?CU().uid.slice(0,6):'') + '…) vers des collections <b>partagées</b> et ajoute le champ <b>owner</b>. Idempotent : tu peux la relancer sans risque. À faire une fois sur le bac à sable, avant de tester la vue partagée.</div>'
      + '<button class="eq-btn" id="eq-migrate">Lancer la migration (bac à sable)</button>'
      + '<div id="eq-miglog" style="display:none;font-family:ui-monospace,Menlo,monospace;font-size:11px;background:#0f1710;color:#c7e6c9;border-radius:9px;padding:10px;height:180px;overflow:auto;white-space:pre-wrap;margin-top:10px;"></div>';
    wrap.appendChild(box);
    box.querySelector('#eq-migrate').onclick = function () { migrate(box.querySelector('#eq-miglog')); };
  }

  async function migrate(logEl) {
    logEl.style.display = 'block';
    function mlog(m, c){ logEl.innerHTML += (c?('<span style="color:'+c+'">'+m+'</span>'):m)+'\n'; logEl.scrollTop = logEl.scrollHeight; }
    if (!CU()) { mlog('Connecte-toi d\'abord.', '#f88'); return; }
    var uid = currentUser.uid;
    var brand = (typeof CURRENT_BRAND !== 'undefined') ? CURRENT_BRAND : 'mdm';
    mlog('Migration → collections partagées, owner=' + uid.slice(0,8) + '…');
    var total = 0;
    try {
      for (var b = 0; b < MIG_BRANDS.length; b++) {
        for (var s = 0; s < MIG_SCOPED.length; s++) {
          var src = MIG_SCOPED[s] + '_' + MIG_BRANDS[b] + '_' + uid;
          var dst = MIG_SCOPED[s] + '_' + MIG_BRANDS[b];
          var snap = await db.collection(src).get();
          if (snap.empty) continue;
          var batch = db.batch(), ops = 0;
          var docs = snap.docs;
          for (var i = 0; i < docs.length; i++) {
            var data = docs[i].data();
            if (data.owner === undefined) data.owner = uid;
            batch.set(db.collection(dst).doc(docs[i].id), data, { merge: true });
            ops++; total++;
            if (ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
          }
          if (ops > 0) await batch.commit();
          mlog('  ✓ ' + src + ' → ' + dst + ' (' + snap.size + ')', '#9f9');
        }
      }
      mlog('\n✅ Migration terminée — ' + total + ' documents copiés vers les collections partagées.', '#9f9');
      mlog('Recharge l\'app avec ?test : elle lit désormais les collections partagées.', '#9f9');
    } catch (e) {
      mlog('\n❌ Erreur : ' + (e.code || e.message), '#f88');
    }
  }

  function addRow(listEl) {
    var empty = listEl.querySelector('.eq-empty');
    if (empty) empty.remove();
    var i = listEl.querySelectorAll('.eq-row').length;
    var div = document.createElement('div');
    div.innerHTML = rowHTML({ nom:'', email:'', role:'commercial', region:'', departements:'' }, i);
    listEl.appendChild(div.firstChild);
  }

  async function saveAll(host) {
    var members = collectRows(host);
    if (!members.length) { if (typeof toast === 'function') toast('Ajoute au moins un membre avec un e-mail', 'err'); return; }
    try {
      // Écrit/maj chaque membre (id = e-mail normalisé). Additif : on n'efface rien d'autre.
      var batch = db.batch();
      members.forEach(function (m) {
        var id = slugMail(m.email);
        batch.set(db.collection('equipe').doc(id), {
          nom: m.nom || '', email: (m.email || '').toLowerCase(), role: m.role === 'manager' ? 'manager' : 'commercial',
          region: m.region || '', departements: m.departements || '',
          actif: true, majAt: (window.firebase && firebase.firestore) ? firebase.firestore.FieldValue.serverTimestamp() : Date.now()
        }, { merge: true });
      });
      await batch.commit();
      if (typeof toast === 'function') toast('✅ Équipe enregistrée (' + members.length + ')', 'ok');
      render(host);
    } catch (e) {
      if (typeof toast === 'function') toast('Échec enregistrement : ' + (e.code || e.message), 'err');
      console.error('[Equipe] save', e);
    }
  }

  async function mount(target) {
    var host = typeof target === 'string' ? document.querySelector(target)
             : (target || document.getElementById('equipe-host'));
    if (!host) { console.warn('[Equipe] conteneur introuvable'); return; }
    host.innerHTML = '<div style="padding:40px;text-align:center;color:#9aa096">Chargement…</div>';
    await render(host);
  }

  window.Equipe = { mount: mount, load: load, roleForCurrent: roleForCurrent, SEED: SEED };
})();
