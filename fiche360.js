/* =======================================================================
   fiche360.js  —  Fiche de préparation de visite (MDM V3, module 1)
   -----------------------------------------------------------------------
   Un écran à ouvrir avant d'entrer chez un client :
     • rythme d'achat (calculé sur ses commandes)
     • dernière commande (montant + lignes)
     • produits à pousser (Assortiment.forClient)
     • accords en cours (db.collection('accords_global'), best-effort)
     • dernière visite (module Visites) si présent
   API :
     Fiche360.open(clientId)            -> ouvre la modale
     Fiche360.button(clientId, label?)  -> <button> prêt à poser
   ======================================================================= */
(function () {
  'use strict';

  var euro = function (n) { return (Math.round(n) || 0).toLocaleString('fr-FR') + ' €'; };
  var toDate = function (v) { return CRMData._date(v); };
  function jours(a, b) { return Math.round((b - a) / 86400000); }
  function fmtDate(d) { return d ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }

  var CSS = [
    '.f36-ov{position:fixed;inset:0;z-index:10000;background:rgba(20,25,20,.5);',
    '  display:flex;align-items:flex-end;justify-content:center;opacity:0;transition:.2s}',
    '.f36-ov.show{opacity:1}',
    '@media(min-width:640px){.f36-ov{align-items:center}}',
    '.f36{background:#f7f8f5;width:100%;max-width:640px;max-height:92vh;overflow:auto;',
    '  border-radius:20px 20px 0 0;transform:translateY(20px);transition:.25s;',
    '  padding-bottom:calc(env(safe-area-inset-bottom,0) + 20px)}',
    '@media(min-width:640px){.f36{border-radius:20px;transform:translateY(10px)}}',
    '.f36-ov.show .f36{transform:none}',
    '.f36-top{position:sticky;top:0;background:var(--accent,#266327);color:#fff;padding:16px 18px;',
    '  display:flex;align-items:flex-start;justify-content:space-between;gap:12px;z-index:2}',
    '.f36-top h2{font:600 19px/1.15 "Fraunces",Georgia,serif;margin:0}',
    '.f36-top .sub{font:500 12.5px/1.3 "Inter",sans-serif;opacity:.85;margin-top:3px}',
    '.f36-x{appearance:none;border:0;background:rgba(255,255,255,.18);color:#fff;width:32px;height:32px;',
    '  border-radius:50%;font-size:18px;cursor:pointer;flex:0 0 auto;line-height:1}',
    '.f36-body{padding:14px}',
    '.f36-card{background:#fff;border:1px solid #e7e9e5;border-radius:14px;padding:14px 15px;margin-bottom:11px}',
    '.f36-lbl{font:600 11px/1 "Inter",sans-serif;letter-spacing:.05em;text-transform:uppercase;color:#8a8f87;margin:0 0 10px}',
    '.f36-kpi{display:flex;gap:14px;flex-wrap:wrap}.f36-kpi>div{flex:1 1 90px}',
    '.f36-kn{font:600 22px/1 "IBM Plex Mono",monospace;color:var(--g900,#1a1a1a)}',
    '.f36-kn.warn{color:#c2410c}.f36-kn.ok{color:var(--accent,#266327)}',
    '.f36-kl{font:500 11px/1.2 "Inter",sans-serif;color:#9aa096;margin-top:4px}',
    '.f36-tag{display:inline-block;padding:4px 10px;border-radius:999px;font:600 12px/1 "Inter",sans-serif}',
    '.f36-tag.retard{background:#fef1e7;color:#c2410c}.f36-tag.ok{background:#eaf5ee;color:var(--accent,#266327)}',
    '.f36-line{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid #f0f1ee;font:500 13px/1.3 "Inter",sans-serif}',
    '.f36-line:first-child{border-top:0}',
    '.f36-line .q{color:#9aa096;font-family:"IBM Plex Mono",monospace;flex:0 0 auto}',
    '.f36-line .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.f36-push{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid #f0f1ee}',
    '.f36-push:first-child{border-top:0}',
    '.f36-push .lib{flex:1;font:600 13px/1.25 "Inter",sans-serif;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.f36-push .lib small{display:block;color:#9aa096;font-weight:500;font-size:11px}',
    '.f36-push .pop{font:600 13px "IBM Plex Mono",monospace;color:var(--accent,#266327);flex:0 0 auto}',
    '.f36-accord{padding:9px 0;border-top:1px solid #f0f1ee;font:500 13px/1.35 "Inter",sans-serif}',
    '.f36-accord:first-child{border-top:0}.f36-accord b{color:var(--g900,#1a1a1a)}',
    '.f36-accord.match{background:#f4faf6;margin:0 -15px;padding:9px 15px;border-radius:8px}',
    '.f36-note{font:500 13px/1.5 "Inter",sans-serif;color:#40463c;white-space:pre-wrap}',
    '.f36-empty{font:500 12.5px/1.3 "Inter",sans-serif;color:#b3b8ac}',
    '.f36-actions{display:flex;gap:9px;padding:2px 14px 4px}',
    '.f36-btn{flex:1;appearance:none;border:1px solid var(--accent,#266327);background:#fff;color:var(--accent,#266327);',
    '  font:600 13px "Inter",sans-serif;padding:11px;border-radius:11px;cursor:pointer}',
    '.f36-open{appearance:none;border:1px solid var(--accent,#266327);background:#fff;color:var(--accent,#266327);',
    '  font:600 12.5px "Inter",sans-serif;padding:7px 12px;border-radius:9px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}',
    '@media print{.f36-ov{position:static;background:#fff}.f36{max-height:none;box-shadow:none}.f36-top{color:#000;background:#fff;border-bottom:2px solid #000}.f36-x,.f36-actions{display:none}}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('f36-style')) return;
    var s = document.createElement('style'); s.id = 'f36-style'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  function rythme(cmds) {
    var dates = cmds.map(function (c) { return toDate(c.date); }).filter(Boolean).sort(function (a, b) { return a - b; });
    if (!dates.length) return { nb: 0 };
    var last = dates[dates.length - 1];
    var depuis = jours(last, new Date());
    var interv = null;
    if (dates.length >= 2) {
      var tot = 0;
      for (var i = 1; i < dates.length; i++) tot += jours(dates[i - 1], dates[i]);
      interv = Math.round(tot / (dates.length - 1));
    }
    var retard = interv ? depuis > interv * 1.3 : depuis > 60;
    return { nb: dates.length, last: last, depuis: depuis, interv: interv, retard: retard };
  }

  async function loadAccords() {
    // Les accords vivent dans db.collection('accords_global') (hors bcol).
    var tries = [];
    if (typeof db !== 'undefined' && db) tries.push(function () { return db.collection('accords_global').get(); });
    if (typeof firebase !== 'undefined' && firebase.firestore) tries.push(function () { return firebase.firestore().collection('accords_global').get(); });
    for (var i = 0; i < tries.length; i++) {
      try {
        var snap = await tries[i]();
        var out = [];
        snap.forEach(function (d) {
          var a = d.data() || {};
          out.push({ nom: a.nom || d.id, debut: a.debut, fin: a.fin, franco: a.franco });
        });
        return out;
      } catch (e) { /* suivant */ }
    }
    return [];
  }
  function accordActif(a) {
    var now = new Date();
    var d = a.debut ? toDate(a.debut) : null, f = a.fin ? toDate(a.fin) : null;
    if (d && now < d) return false;
    if (f && now > f) return false;
    return true;
  }

  async function derniereVisite(clientId, clientKey, clientNom) {
    if (typeof bcol !== 'function') return null;
    var slug = CRMData._slug;
    try {
      var snap = await bcol('visites').get();
      var best = null;
      snap.forEach(function (d) {
        var v = d.data() || {};
        var vid = v.clientId || v.client || '';
        var vnom = v.clientNom || v.nom || v.raison || '';
        var match = (clientId && String(vid) === String(clientId)) ||
                    (clientKey && vnom && slug(vnom) === clientKey);
        if (!match) return;
        var dt = toDate(v.date || v.createdAt || v.ts) || new Date(0);
        if (!best || dt > best._dt) {
          best = { _dt: dt, date: dt, note: v.note || v.commentaire || v.compteRendu || v.cr || '',
                   photos: (v.photos && v.photos.length) || v.nbPhotos || 0 };
        }
      });
      return best;
    } catch (e) { return null; }
  }

  async function open(clientId) {
    injectCSS();
    var ov = document.createElement('div');
    ov.className = 'f36-ov';
    ov.innerHTML = '<div class="f36"><div class="f36-top"><div><h2>Préparation…</h2></div>'
      + '<button class="f36-x" aria-label="Fermer">×</button></div>'
      + '<div class="f36-body" id="f36-body"><div class="f36-empty" style="padding:30px;text-align:center">Chargement…</div></div></div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('show'); });
    function close() { ov.classList.remove('show'); setTimeout(function () { ov.remove(); }, 220); }
    ov.querySelector('.f36-x').onclick = close;
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });

    var clients = await CRMData.clients();
    var client = clients.filter(function (c) { return String(c.id) === String(clientId); })[0]
              || { id: clientId, key: CRMData._slug(clientId), nom: clientId, ville: '', cp: '' };
    var parClient = await CRMData.commandesParClient();
    var cmds = (parClient[client.key] || []).slice().sort(function (a, b) {
      return (toDate(b.date) || 0) - (toDate(a.date) || 0);
    });
    var r = rythme(cmds);
    var derniere = cmds[0] || null;
    var catMap = CRMData.catalogueMap();
    var accords = await loadAccords();
    var visite = await derniereVisite(client.id, client.key, client.nom);
    var pushes = [];
    try { pushes = await Assortiment.forClient(client.key, { limit: 5 }); } catch (e) {}

    var slug = CRMData._slug;
    var accordsHTML = accords.map(function (a) {
      var actif = accordActif(a);
      var match = client.nom && (slug(client.nom).indexOf(slug(a.nom)) >= 0 || slug(a.nom).indexOf(slug(client.nom)) >= 0);
      if (!actif && !match) return '';
      return '<div class="f36-accord' + (match ? ' match' : '') + '"><b>' + a.nom + '</b>'
        + (match ? ' · applicable ici' : '')
        + (a.franco ? '<br>Franco ' + euro(a.franco) : '')
        + (a.fin ? ' · jusqu\'au ' + fmtDate(toDate(a.fin)) : '') + '</div>';
    }).filter(Boolean).join('');

    var lignesHTML = derniere && derniere.lignes.length
      ? derniere.lignes.slice(0, 6).map(function (l) {
          var p = catMap[l.code];
          return '<div class="f36-line"><span class="q">' + l.qte + '×</span>'
            + '<span class="n">' + ((p && p.libelle) || l.code) + '</span></div>';
        }).join('')
      : '<div class="f36-empty">Aucune ligne détaillée.</div>';

    var pushHTML = pushes.length ? pushes.map(function (o) {
      return '<div class="f36-push"><div class="lib">' + o.libelle
        + '<small>Réf ' + o.code + '</small></div><div class="pop">' + o.pop + ' clients</div></div>';
    }).join('') : '<div class="f36-empty">Pas de suggestion (données de commandes insuffisantes).</div>';

    ov.querySelector('.f36-top').innerHTML =
      '<div><h2>' + client.nom + '</h2><div class="sub">'
      + [client.ville, client.cp].filter(Boolean).join(' ') + '</div></div>'
      + '<button class="f36-x" aria-label="Fermer">×</button>';
    ov.querySelector('.f36-x').onclick = close;

    var body = ov.querySelector('#f36-body');
    body.innerHTML =
      '<div class="f36-card"><p class="f36-lbl">Rythme d\'achat</p><div class="f36-kpi">'
      +  '<div><div class="f36-kn ' + (r.retard ? 'warn' : (r.nb ? 'ok' : '')) + '">' + (r.depuis != null ? r.depuis + 'j' : '—') + '</div><div class="f36-kl">depuis dernière cmd</div></div>'
      +  '<div><div class="f36-kn">' + (r.interv ? '~' + r.interv + 'j' : '—') + '</div><div class="f36-kl">intervalle moyen</div></div>'
      +  '<div><div class="f36-kn">' + (r.nb || 0) + '</div><div class="f36-kl">commandes</div></div></div>'
      +  (r.nb ? '<div style="margin-top:10px"><span class="f36-tag ' + (r.retard ? 'retard' : 'ok') + '">'
            + (r.retard ? '⚠ En retard de commande' : '✓ Dans son rythme') + '</span></div>' : '')
      + '</div>'
      + '<div class="f36-card"><p class="f36-lbl">Dernière commande' + (derniere ? ' · ' + fmtDate(toDate(derniere.date)) : '') + '</p>'
      +  (derniere ? '<div class="f36-kn" style="margin-bottom:8px">' + euro(derniere.montant) + '</div>' : '') + lignesHTML + '</div>'
      + '<div class="f36-card"><p class="f36-lbl">À pousser — populaires ailleurs, absents ici</p>' + pushHTML + '</div>'
      + (accordsHTML ? '<div class="f36-card"><p class="f36-lbl">Accords en cours</p>' + accordsHTML + '</div>' : '')
      + '<div class="f36-card"><p class="f36-lbl">Dernière visite</p>'
      +  (visite ? '<div style="font:600 12.5px Inter,sans-serif;color:#6b7280;margin-bottom:6px">'
            + fmtDate(visite.date) + (visite.photos ? ' · ' + visite.photos + ' photo(s)' : '') + '</div>'
            + (visite.note ? '<div class="f36-note">' + visite.note + '</div>' : '<div class="f36-empty">Pas de commentaire.</div>')
          : '<div class="f36-empty">Aucune visite enregistrée.</div>') + '</div>';

    var act = document.createElement('div');
    act.className = 'f36-actions';
    act.innerHTML = '<button class="f36-btn" id="f36-print">Imprimer / PDF</button>';
    body.parentNode.appendChild(act);
    act.querySelector('#f36-print').onclick = function () { window.print(); };
  }

  function button(clientId, label) {
    var b = document.createElement('button');
    b.className = 'f36-open';
    b.innerHTML = '<span style="font-size:14px">🗂️</span>' + (label || 'Préparer la visite');
    b.onclick = function (e) { e.stopPropagation(); open(clientId); };
    return b;
  }

  window.Fiche360 = { open: open, button: button };
})();
