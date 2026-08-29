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
    '.eq-empty{padding:26px;text-align:center;color:#9aa096;font:500 13px "Inter",sans-serif;background:#fff;border:1px dashed #d8dcd4;border-radius:12px}',
    '.eq-acc{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;background:#fff;border:1px solid #e7e9e5;border-radius:12px;padding:10px 14px;margin-bottom:8px}',
    '.eq-acc-main{min-width:180px}',
    '.eq-acc-nom{font:600 13px "Inter",sans-serif;color:#1a1a1a}',
    '.eq-acc-mail{font:500 12px "Inter",sans-serif;color:#9aa096}',
    '.eq-acc-actions{display:flex;gap:6px;flex-wrap:wrap}',
    '.eq-badge{display:inline-block;font:600 11px "Inter",sans-serif;padding:3px 8px;border-radius:20px}',
    '.eq-badge-wait{background:#eef1ec;color:#9aa096}',
    '.eq-badge-ok{background:#eaf5ee;color:#1f7a3d}',
    '.eq-badge-none{background:#fff4e5;color:#9a5a12}',
    '.eq-badge-off{background:#fdecea;color:#b42318}',
    '.eq-mini{appearance:none;border:1px solid #d3d8ce;background:#fff;color:#40463c;border-radius:8px;padding:6px 10px;cursor:pointer;font:600 12px "Inter",sans-serif}',
    '.eq-mini:hover{background:#f5f7f3}',
    '.eq-mini-danger{border-color:#e7c9c2;background:#fff8f5;color:#b42318}'
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

    renderAccounts(host);
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

    // ── Attribution par secteur (étape 2b) ──
    var box2 = document.createElement('div');
    box2.style.cssText = 'margin-top:14px;padding:14px 16px;border:1px dashed #4a86d8;border-radius:12px;background:#f2f7ff';
    box2.innerHTML =
      '<div style="font:600 13px/1.3 Inter,sans-serif;color:#1e4e8a;margin-bottom:6px;">🎯 Attribution des clients par secteur</div>'
      + '<div style="font:500 12px/1.5 Inter,sans-serif;color:#3a6ba3;margin-bottom:10px;">Attribue chaque client au commercial qui couvre son département (déduit du code postal), d\'après les départements saisis ci-dessus. Fais d\'abord une <b>simulation</b> pour vérifier, puis applique. Un commercial sans compte encore créé sera rattaché par e-mail (le lien se fera à sa 1re connexion).</div>'
      + '<label style="display:flex;align-items:center;gap:7px;font:500 12px Inter,sans-serif;color:#3a6ba3;margin-bottom:10px;cursor:pointer"><input type="checkbox" id="eq-attr-onlyunowned" checked> N\'attribuer que les clients <b>sans propriétaire</b> (recommandé)</label>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="eq-btn ghost" id="eq-attr-sim">Simulation</button><button class="eq-btn" id="eq-attr-go">Appliquer l\'attribution</button></div>'
      + '<div id="eq-attrlog" style="display:none;font-family:ui-monospace,Menlo,monospace;font-size:11px;background:#0d1424;color:#cfe0ff;border-radius:9px;padding:10px;height:200px;overflow:auto;white-space:pre-wrap;margin-top:10px;"></div>';
    wrap.appendChild(box2);
    box2.querySelector('#eq-attr-sim').onclick = function () { attribute(true, box2.querySelector('#eq-attrlog')); };
    box2.querySelector('#eq-attr-go').onclick = function () { attribute(false, box2.querySelector('#eq-attrlog')); };
  }

  // Département à partir du code postal (métropole = 2 chiffres, DOM = 3).
  function deptOfCp(cp) {
    cp = String(cp == null ? '' : cp).trim();
    if (!cp) return null;
    if (/^9[78]\d/.test(cp)) return cp.slice(0, 3);
    var d = cp.slice(0, 2);
    return /^\d{2}$/.test(d) ? d : null;
  }
  function parseDepts(txt) {
    return String(txt || '').split(/[^0-9AB]+/i).map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean);
  }
  function buildDeptMap() {
    var map = {}, conflicts = [];
    (_roster || []).forEach(function (m) {
      if (m.role === 'manager' && !parseDepts(m.departements).length) return; // manager sans secteur : ignoré
      parseDepts(m.departements).forEach(function (d) {
        if (map[d] && map[d].email !== m.email && conflicts.indexOf(d) < 0) conflicts.push(d);
        map[d] = m;
      });
    });
    return { map: map, conflicts: conflicts };
  }
  function emailToUid(email) {
    if (!email) return null;
    var lc = email.toLowerCase();
    if (CU() && (CU().email || '').toLowerCase() === lc) return CU().uid;
    var m = (_roster || []).find(function (x) { return (x.email || '').toLowerCase() === lc; });
    return (m && m.uid) ? m.uid : null;
  }

  async function attribute(dryRun, logEl) {
    logEl.style.display = 'block'; logEl.innerHTML = '';
    function alog(m, c) { logEl.innerHTML += (c ? ('<span style="color:' + c + '">' + m + '</span>') : m) + '\n'; logEl.scrollTop = logEl.scrollHeight; }
    if (!CU()) { alog('Connecte-toi d\'abord.', '#f88'); return; }
    await load(); // référentiel à jour
    var dm = buildDeptMap();
    if (!Object.keys(dm.map).length) { alog('Aucun département renseigné dans le référentiel. Remplis les départements des commerciaux puis enregistre.', '#f88'); return; }
    if (dm.conflicts.length) alog('⚠ Départements attribués à plusieurs commerciaux (le dernier gagne) : ' + dm.conflicts.join(', '), '#fd8');
    var brand = (typeof CURRENT_BRAND !== 'undefined') ? CURRENT_BRAND : 'mdm';
    var onlyUnowned = !!(document.getElementById('eq-attr-onlyunowned') && document.getElementById('eq-attr-onlyunowned').checked);
    alog((dryRun ? '— SIMULATION — ' : '— APPLICATION — ') + 'marque ' + brand + (onlyUnowned ? ' · clients sans propriétaire uniquement' : ' · TOUS les clients'));

    try {
      var snap = await db.collection('contacts_' + brand).get();
      var counts = {}, unmatched = [], noCp = 0, total = 0, skippedOwned = 0, updates = [];
      snap.forEach(function (doc) {
        total++;
        var c = doc.data();
        if (onlyUnowned && (c.owner || c.ownerEmail)) { skippedOwned++; return; }
        var d = deptOfCp(c.cp);
        if (!d) { noCp++; return; }
        var m = dm.map[d];
        if (!m) { if (unmatched.indexOf(d) < 0) unmatched.push(d); return; }
        counts[m.email] = (counts[m.email] || 0) + 1;
        if (!dryRun) {
          var uid = emailToUid(m.email);
          var upd = { ownerEmail: m.email, secteur: m.region || '' };
          if (uid) upd.owner = uid;
          updates.push({ ref: doc.ref, upd: upd });
        }
      });

      alog('\nClients : ' + total + ' au total');
      if (skippedOwned) alog('  ↳ ' + skippedOwned + ' déjà attribués (ignorés)', '#9cf');
      Object.keys(counts).forEach(function (mail) {
        var m = (_roster || []).find(function (x) { return (x.email || '').toLowerCase() === mail.toLowerCase(); });
        alog('  • ' + (m ? m.nom : mail) + ' : ' + counts[mail] + (emailToUid(mail) ? '' : ' (compte pas encore créé → rattaché par e-mail)'));
      });
      if (noCp) alog('  ⚠ ' + noCp + ' client(s) sans code postal exploitable', '#fd8');
      if (unmatched.length) alog('  ⚠ départements non couverts : ' + unmatched.sort().join(', '), '#fd8');

      if (dryRun) { alog('\nSimulation seule — rien n\'a été écrit. Vérifie, puis « Appliquer ».', '#9cf'); return; }

      for (var i = 0; i < updates.length; i += 400) {
        var batch = db.batch();
        updates.slice(i, i + 400).forEach(function (u) { batch.set(u.ref, u.upd, { merge: true }); });
        await batch.commit();
        alog('  … ' + Math.min(i + 400, updates.length) + '/' + updates.length + ' écrits');
      }
      alog('\n✅ Attribution appliquée — ' + updates.length + ' clients mis à jour.', '#9f9');
    } catch (e) {
      alog('\n❌ Erreur : ' + (e.code || e.message), '#f88');
    }
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

      // Registre des managers pour les règles de sécurité Firestore (étape 4).
      // On y met les e-mails des membres 'manager' + toujours l'e-mail admin
      // (garde-fou : l'admin ne peut jamais se verrouiller dehors).
      try {
        var mgrEmails = members.filter(function (m) { return m.role === 'manager' && m.email; })
                               .map(function (m) { return m.email.toLowerCase(); });
        if (mgrEmails.indexOf('loacdev@outlook.fr') < 0) mgrEmails.push('loacdev@outlook.fr');
        await db.collection('roles').doc('managers').set({
          emails: mgrEmails,
          majAt: (window.firebase && firebase.firestore) ? firebase.firestore.FieldValue.serverTimestamp() : Date.now()
        }, { merge: true });
      } catch (e) { console.warn('[Equipe] registre managers', e && e.message); }

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

  // ── 4c-1 : réconciliation à la connexion ──
  // Inscrit l'uid définitif du commercial connecté sur les clients qui lui
  // étaient rattachés par e-mail (ownerEmail) mais sans owner. Rend `owner`
  // autoritaire → prérequis pour les lectures ciblées de la 4c-2.
  // Bac à sable (modèle B) uniquement. Idempotent (ne retouche rien après coup).
  async function reconcile() {
    try {
      if (typeof __USE_TEST === 'undefined' || !__USE_TEST) return;
      if (!CU()) return;
      var uid = CU().uid, mail = (CU().email || '').toLowerCase();
      if (!mail) return;
      var brands = ['mdm', 'naturaline'];
      var total = 0;
      for (var b = 0; b < brands.length; b++) {
        var snap;
        try { snap = await db.collection('contacts_' + brands[b]).where('ownerEmail', '==', mail).get(); }
        catch (e) { continue; }
        if (snap.empty) continue;
        var batch = db.batch(), ops = 0;
        snap.forEach(function (doc) {
          var d = doc.data();
          // Aligne le propriétaire sur l'e-mail de rattachement, même si un
          // ancien owner (posé à la migration) est déjà présent.
          if (d.owner !== uid) { batch.set(doc.ref, { owner: uid }, { merge: true }); ops++; total++; }
        });
        if (ops > 0) await batch.commit();
      }
      // Best-effort : poser member.uid dans le référentiel (peut échouer pour un
      // commercial si les règles réservent l'écriture equipe au manager — sans gravité).
      try {
        await load();
        var me = (_roster || []).find(function (x) { return (x.email || '').toLowerCase() === mail; });
        if (me && !me.uid && me._id) await db.collection('equipe').doc(me._id).set({ uid: uid }, { merge: true });
      } catch (e) {}
      if (total) console.log('[Equipe] réconciliation : ' + total + ' client(s) rattaché(s) à ' + mail);
    } catch (e) { console.warn('[Equipe] reconcile', e && e.message); }
  }

  // ── Comptes & accès (chemin A : gestion depuis l'app) ──
  function renderAccounts(host) {
    var wrap = host.querySelector('.eq-wrap'); if (!wrap) return;
    var box = document.createElement('div');
    box.style.cssText = 'margin-top:26px';
    var rows = (_roster || []).map(function (m) {
      var actif = (m.actif !== false);
      var created = !!m.accountCreated;
      var bid = 'acc-st-' + slugMail(m.email);
      return '<div class="eq-acc" data-email="' + esc(m.email) + '">'
        + '<div class="eq-acc-main"><div class="eq-acc-nom">' + esc(m.nom || m.email) + '</div>'
        +   '<div class="eq-acc-mail">' + esc(m.email) + '</div></div>'
        + '<div><span id="' + bid + '" class="eq-badge ' + (created ? 'eq-badge-ok' : 'eq-badge-none') + '">' + (created ? 'compte créé' : 'pas de compte') + '</span>'
        +   (actif ? '' : ' <span class="eq-badge eq-badge-off">désactivé</span>') + '</div>'
        + '<div class="eq-acc-actions">'
        +   '<button class="eq-mini" data-act="create">Créer le compte</button>'
        +   '<button class="eq-mini" data-act="reset">Renvoyer mdp</button>'
        +   '<button class="eq-mini" data-act="toggle">' + (actif ? 'Désactiver' : 'Réactiver') + '</button>'
        +   '<button class="eq-mini eq-mini-danger" data-act="delete">Retirer</button>'
        + '</div></div>';
    }).join('');
    box.innerHTML = '<div class="eq-h" style="margin-top:10px"><h2 style="font:600 17px/1.1 \'Fraunces\',Georgia,serif">Comptes &amp; accès</h2>'
      + '<p>Crée les comptes de connexion, renvoie un e-mail de mot de passe, active/désactive ou retire un accès. Tu restes connecté pendant la création.</p></div>'
      + (rows || '<div class="eq-empty">Enregistre d\'abord l\'équipe pour gérer les comptes.</div>');
    wrap.appendChild(box);

    // Le statut vient du référentiel (accountCreated, posé à la création via l'app).
    // On tente une vérification Firebase qui ne peut que CONFIRMER un compte
    // (jamais l'infirmer) — sans effet si la protection anti-énumération est active.
    (_roster || []).forEach(function (m) {
      if (m.accountCreated) return;
      var el = document.getElementById('acc-st-' + slugMail(m.email));
      if (!el) return;
      try {
        firebase.auth().fetchSignInMethodsForEmail(m.email).then(function (methods) {
          if (methods && methods.length) { el.className = 'eq-badge eq-badge-ok'; el.textContent = 'compte créé'; }
        }).catch(function () {});
      } catch (e) {}
    });

    box.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('button[data-act]'); if (!btn) return;
      var rowEl = btn.closest('.eq-acc'); if (!rowEl) return;
      var email = rowEl.getAttribute('data-email');
      var m = (_roster || []).find(function (x) { return (x.email || '') === email; });
      if (!m) return;
      var act = btn.getAttribute('data-act');
      if (act === 'create') accCreate(m, host);
      else if (act === 'reset') accReset(m);
      else if (act === 'toggle') accToggle(m, host);
      else if (act === 'delete') accDelete(m, host);
    });
  }

  // Crée le compte via une instance Firebase SECONDAIRE → l'admin reste connecté.
  async function accCreate(m, host) {
    if (!m || !m.email) return;
    var cfg = (typeof ACTIVE_FIREBASE_CONFIG !== 'undefined') ? ACTIVE_FIREBASE_CONFIG : null;
    if (!cfg || !window.firebase) { if (typeof toast === 'function') toast('Configuration Firebase indisponible', 'err'); return; }
    var secApp = null;
    try {
      secApp = firebase.initializeApp(cfg, 'admin-worker-' + Date.now());
      var tmp = 'Tmp!' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6).toUpperCase() + '7';
      await secApp.auth().createUserWithEmailAndPassword(m.email, tmp);
      try { await secApp.auth().signOut(); } catch (e) {}
      // e-mail pour que la personne définisse elle-même son mot de passe
      try { await firebase.auth().sendPasswordResetEmail(m.email); } catch (e) {}
      if (m._id) await db.collection('equipe').doc(m._id).set({ accountCreated: true, actif: true }, { merge: true });
      if (typeof toast === 'function') toast('Compte créé — e-mail envoyé à ' + m.email, 'ok');
    } catch (e) {
      if (e && e.code === 'auth/email-already-in-use') {
        if (typeof toast === 'function') toast('Ce compte existe déjà', 'err');
        if (m._id) { try { await db.collection('equipe').doc(m._id).set({ accountCreated: true }, { merge: true }); } catch (x) {} }
      } else if (typeof toast === 'function') toast('Échec création : ' + (e.code || e.message), 'err');
    } finally {
      try { if (secApp) await secApp.delete(); } catch (e) {}
      render(host);
    }
  }

  async function accReset(m) {
    if (!m || !m.email) return;
    try { await firebase.auth().sendPasswordResetEmail(m.email); if (typeof toast === 'function') toast('E-mail de mot de passe envoyé à ' + m.email, 'ok'); }
    catch (e) { if (typeof toast === 'function') toast('Échec : ' + (e.code || e.message), 'err'); }
  }

  async function accToggle(m, host) {
    if (!m || !m._id) { if (typeof toast === 'function') toast('Enregistre d\'abord ce membre', 'err'); return; }
    var next = (m.actif === false); // inactif → on réactive
    try { await db.collection('equipe').doc(m._id).set({ actif: next }, { merge: true }); if (typeof toast === 'function') toast(next ? 'Accès réactivé' : 'Accès désactivé', 'ok'); render(host); }
    catch (e) { if (typeof toast === 'function') toast('Échec : ' + (e.code || e.message), 'err'); }
  }

  async function accDelete(m, host) {
    if (!m || !m._id) return;
    if (!window.confirm('Retirer ' + (m.nom || m.email) + ' de l\'équipe ? Son accès sera bloqué. (L\'identifiant technique de connexion subsistera jusqu\'à la mise en place du serveur.)')) return;
    try { await db.collection('equipe').doc(m._id).delete(); if (typeof toast === 'function') toast('Membre retiré', 'ok'); render(host); }
    catch (e) { if (typeof toast === 'function') toast('Échec : ' + (e.code || e.message), 'err'); }
  }

  // L'utilisateur connecté est-il actif ? (false seulement si explicitement désactivé)
  function isCurrentActive() {
    try {
      if (!_roster || !CU()) return true;
      var mail = (CU().email || '').toLowerCase();
      var m = (_roster || []).find(function (x) { return (x.email || '').toLowerCase() === mail; });
      return !(m && m.actif === false);
    } catch (e) { return true; }
  }

  window.Equipe = { mount: mount, load: load, roleForCurrent: roleForCurrent, reconcile: reconcile, isCurrentActive: isCurrentActive, SEED: SEED };
})();
