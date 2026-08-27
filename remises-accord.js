/* =======================================================================
   remises-accord.js  —  Applique les remises de l'accord du client au BDC
   -----------------------------------------------------------------------
   Relie la section Accords à la base client et au bon de commande.
   Pour le client rattaché au BDC (via son champ « Accord commercial »),
   calcule pour chaque ligne la remise CASCADÉE (multiplicative) :
       promo (sur liste de réfs) × palier (selon total) × remise globale client
   affiche le prix net final, puis pose ces % sur les lignes du BDC
   (bdcRemiseLigne — qui écrase la remise globale du bon, donc pas de
   double déduction). N'applique que si l'accord est en cours de validité.

   Dépend de : accordsCache, bdcQtys, bdcRemiseLigne, buildTable,
   bdcUpdateTotals, CRMData (prix/libellé), toast.
   API : RemisesAccord.setClient(c), RemisesAccord.open()
   ======================================================================= */
(function () {
  'use strict';

  var _client = null;

  function num(v) {
    if (typeof v === 'number') return v;
    if (v == null) return 0;
    var n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }
  function eur(n) { return (n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }
  function normCode(s) { return String(s == null ? '' : s).trim().toUpperCase(); }

  function accordDuClient(c) {
    if (!c || !c.accord || typeof accordsCache === 'undefined') return null;
    return accordsCache.find(function (a) { return a._id === c.accord; }) || null;
  }
  function accordValide(a) {
    if (!a) return false;
    var now = new Date();
    if (a.debut) { var d = new Date(a.debut); if (!isNaN(d) && now < d) return false; }
    if (a.fin)   { var f = new Date(a.fin);   if (!isNaN(f) && now > f) return false; }
    return true;
  }

  // Map code -> remise promo max (sur les promos de l'accord valide)
  function promosParCode(accord) {
    var m = {};
    (accord && accord.promos || []).forEach(function (p) {
      var taux = num(p.remise);
      if (!taux) return;
      String(p.produits || '').split(/[,;\s]+/).forEach(function (code) {
        var c = normCode(code);
        if (c) m[c] = Math.max(m[c] || 0, taux);
      });
    });
    return m;
  }
  // Palier atteint = plus forte remise dont le seuil <= total
  function palierPour(accord, total) {
    var best = 0;
    (accord && accord.paliers || []).forEach(function (p) {
      if (total >= num(p.seuil)) best = Math.max(best, num(p.remise));
    });
    return best;
  }

  // Cascade multiplicative -> % effectif (0..100)
  function cascade(taux) {
    var keep = 1;
    taux.forEach(function (t) { if (t > 0) keep *= (1 - t / 100); });
    return Math.round((1 - keep) * 10000) / 100; // 2 décimales
  }

  // Lignes actuelles du BDC : [{code, qte}]
  function lignesBDC() {
    var out = [];
    if (typeof bdcQtys === 'undefined') return out;
    Object.keys(bdcQtys).forEach(function (code) {
      var q = parseFloat(bdcQtys[code]) || 0;
      if (q > 0) out.push({ code: normCode(code), qte: q });
    });
    return out;
  }

  // Calcule tout : renvoie { accord, valide, global, palier, total, lignes:[{...}] }
  function calcule(client) {
    var catMap = (typeof CRMData !== 'undefined') ? CRMData.catalogueMap() : {};
    var accord = accordDuClient(client);
    var valide = accordValide(accord);
    var global = num(client && client.remise);
    var lignes = lignesBDC().map(function (l) {
      var p = catMap[l.code] || {};
      return { code: l.code, qte: l.qte, libelle: p.libelle || l.code, pu: num(p.prix) };
    });
    var total = lignes.reduce(function (s, l) { return s + l.pu * l.qte; }, 0); // total brut HT
    var palier = valide ? palierPour(accord, total) : 0;
    var promos = valide ? promosParCode(accord) : {};

    lignes.forEach(function (l) {
      var taux = [];
      var promo = promos[l.code] || 0;
      if (promo) taux.push(promo);
      if (palier) taux.push(palier);
      if (global) taux.push(global);
      l.promo = promo; l.palier = palier; l.global = global;
      l.taux = taux;
      l.eff = cascade(taux);              // % cascadé
      l.puNet = l.pu * (1 - l.eff / 100); // prix unitaire net
      l.totNet = l.puNet * l.qte;
    });
    return { accord: accord, valide: valide, global: global, palier: palier,
             total: total, lignes: lignes };
  }

  var CSS = [
    '.rma-ov{position:fixed;inset:0;z-index:10002;background:rgba(20,25,20,.5);display:flex;align-items:flex-end;justify-content:center;opacity:0;transition:.2s}',
    '.rma-ov.show{opacity:1}@media(min-width:640px){.rma-ov{align-items:center}}',
    '.rma{background:#f7f8f5;width:100%;max-width:680px;max-height:92vh;display:flex;flex-direction:column;border-radius:20px 20px 0 0;transform:translateY(20px);transition:.25s;overflow:hidden}',
    '@media(min-width:640px){.rma{border-radius:20px;transform:translateY(10px)}}.rma-ov.show .rma{transform:none}',
    '.rma-top{background:var(--accent,#266327);color:#fff;padding:15px 17px;display:flex;align-items:flex-start;justify-content:space-between;gap:10px}',
    '.rma-top h2{font:600 18px/1.15 "Fraunces",Georgia,serif;margin:0}.rma-top .sub{font:500 12px/1.35 "Inter",sans-serif;opacity:.9;margin-top:3px}',
    '.rma-x{appearance:none;border:0;background:rgba(255,255,255,.18);color:#fff;width:30px;height:30px;border-radius:50%;font-size:17px;cursor:pointer;flex:0 0 auto}',
    '.rma-body{overflow:auto;padding:10px 12px;flex:1}',
    '.rma-info{font:500 12px/1.4 "Inter",sans-serif;color:#6b7280;background:#eef3ee;border-radius:9px;padding:8px 11px;margin:2px 2px 10px}',
    '.rma-info b{color:#266327}',
    '.rma-row{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #e7e9e5;border-radius:11px;padding:9px 11px;margin-bottom:6px}',
    '.rma-main{flex:1;min-width:0}',
    '.rma-lib{font:600 13px/1.25 "Inter",sans-serif;color:#1a1a1a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.rma-cascade{font:500 11px/1.3 "Inter",sans-serif;color:#9aa096;margin-top:2px}',
    '.rma-prix{flex:0 0 auto;text-align:right;font-family:"IBM Plex Mono",monospace}',
    '.rma-brut{font-size:11px;color:#b3b8ac;text-decoration:line-through}',
    '.rma-net{font-size:14px;font-weight:600;color:#266327}',
    '.rma-eff{display:inline-block;background:#eaf5ee;color:#266327;border-radius:5px;padding:1px 6px;font:600 11px/1 "Inter",sans-serif;margin-left:6px}',
    '.rma-empty{padding:26px;text-align:center;color:#9aa096;font:500 13px "Inter",sans-serif}',
    '.rma-foot{padding:11px 14px;border-top:1px solid #e7e9e5;background:#fff}',
    '.rma-tot{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:9px;font:500 13px "Inter",sans-serif;color:#40463c}',
    '.rma-tot b{font:700 18px "IBM Plex Mono",monospace;color:#1a1a1a}',
    '.rma-btns{display:flex;gap:9px}',
    '.rma-btn{flex:1;appearance:none;border:1px solid var(--accent,#266327);background:var(--accent,#266327);color:#fff;font:600 14px "Inter",sans-serif;padding:12px;border-radius:11px;cursor:pointer}',
    '.rma-btn.ghost{background:#fff;color:var(--accent,#266327);flex:0 0 auto;padding:12px 16px}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('rma-style')) return;
    var s = document.createElement('style'); s.id = 'rma-style'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  function cascadeTxt(l) {
    var parts = [];
    if (l.promo) parts.push('promo −' + l.promo + '%');
    if (l.palier) parts.push('palier −' + l.palier + '%');
    if (l.global) parts.push('client −' + l.global + '%');
    if (!parts.length) return 'aucune remise';
    return parts.join(' × ') + ' = −' + l.eff + '%';
  }

  function open() {
    injectCSS();
    var magEl = document.getElementById('bdc-magasin');
    var client = _client;
    if (!client && magEl && magEl.value && typeof cdbContacts !== 'undefined') {
      var slug = function (s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ''); };
      var key = slug(magEl.value);
      client = cdbContacts.find(function (c) { return slug(c.raison || c.nom) === key; }) || null;
    }
    if (!client) { if (typeof toast === 'function') toast('Démarre le BDC depuis une fiche client pour lier son accord', 'err'); return; }

    var r = calcule(client);

    var ov = document.createElement('div');
    ov.className = 'rma-ov';
    var accNom = r.accord ? r.accord.nom : null;
    var sub = accNom
      ? (r.valide ? 'Accord : ' + accNom : 'Accord « ' + accNom +' » hors validité — non appliqué')
      : 'Aucun accord rattaché à ce client';
    ov.innerHTML = '<div class="rma"><div class="rma-top"><div><h2>Remises — ' + (client.raison || client.nom || '') + '</h2>'
      + '<div class="sub">' + sub + '</div></div><button class="rma-x">×</button></div>'
      + '<div class="rma-body" id="rma-body"></div></div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('show'); });
    function close() { ov.classList.remove('show'); setTimeout(function () { ov.remove(); }, 220); }
    ov.querySelector('.rma-x').onclick = close;
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });

    var body = ov.querySelector('#rma-body');
    if (!r.lignes.length) {
      body.innerHTML = '<div class="rma-empty">Ajoute d\'abord des produits au bon, puis rouvre cette fenêtre pour appliquer les remises.</div>';
      return;
    }

    var infoBits = [];
    if (r.global) infoBits.push('Remise client <b>−' + r.global + '%</b>');
    if (r.palier) infoBits.push('Palier atteint <b>−' + r.palier + '%</b> (total ' + eur(r.total) + ')');
    else if (r.valide && r.accord && (r.accord.paliers || []).length) infoBits.push('Aucun palier atteint (total ' + eur(r.total) + ')');
    var info = infoBits.length ? '<div class="rma-info">' + infoBits.join(' · ') + ' · cascade multiplicative</div>' : '';

    body.innerHTML = info + r.lignes.map(function (l) {
      return '<div class="rma-row"><div class="rma-main">'
        + '<div class="rma-lib">' + l.libelle + (l.eff ? '<span class="rma-eff">−' + l.eff + '%</span>' : '') + '</div>'
        + '<div class="rma-cascade">' + l.qte + ' × · ' + cascadeTxt(l) + '</div></div>'
        + '<div class="rma-prix">' + (l.eff ? '<div class="rma-brut">' + eur(l.pu) + '</div>' : '')
        + '<div class="rma-net">' + eur(l.puNet) + '</div></div></div>';
    }).join('');

    var totBrut = r.lignes.reduce(function (s, l) { return s + l.pu * l.qte; }, 0);
    var totNet = r.lignes.reduce(function (s, l) { return s + l.totNet; }, 0);
    var foot = document.createElement('div');
    foot.className = 'rma-foot';
    foot.innerHTML = '<div class="rma-tot"><span>Total net une fois toutes remises déduites</span><b>' + eur(totNet) + '</b></div>'
      + '<div class="rma-tot" style="margin-top:-4px;font-size:11.5px;color:#9aa096"><span>Total brut ' + eur(totBrut) + ' · économie ' + eur(totBrut - totNet) + '</span><span></span></div>'
      + '<div class="rma-btns"><button class="rma-btn ghost" id="rma-cancel">Fermer</button>'
      + '<button class="rma-btn" id="rma-apply">Appliquer au bon</button></div>';
    ov.querySelector('.rma').appendChild(foot);
    foot.querySelector('#rma-cancel').onclick = close;
    foot.querySelector('#rma-apply').onclick = function () {
      r.lignes.forEach(function (l) {
        if (typeof bdcRemiseLigne === 'undefined') return;
        if (l.eff > 0) bdcRemiseLigne[l.code] = l.eff;
        else delete bdcRemiseLigne[l.code];
      });
      try { if (typeof buildTable === 'function') buildTable(); } catch (e) {}
      try { if (typeof bdcUpdateTotals === 'function') bdcUpdateTotals(); } catch (e) {}
      if (typeof toast === 'function') toast('Remises appliquées au bon', 'ok');
      close();
    };
  }

  window.RemisesAccord = {
    setClient: function (c) { _client = c || null; },
    open: open,
    _calcule: calcule
  };
})();
