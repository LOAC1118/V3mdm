/* =======================================================================
   bdc-suggest.js  —  Suggestion de commande dans le BDC (MDM V3, point 1)
   -----------------------------------------------------------------------
   Bouton « 🧠 Suggérer » dans la barre du BDC. Ouvre une modale qui, pour
   le client saisi (#bdc-magasin), propose :
     • sa commande habituelle (réfs récurrentes + quantité type, calculée
       sur son historique via CRMData.paniersType)
     • quelques réfs à pousser (CRMData/Assortiment : populaires ailleurs)
   Les réfs en rupture de stock sont signalées. « Ajouter au bon » remplit
   bdcQtys puis reconstruit la table (buildTable + bdcUpdateTotals).
   API : BdcSuggest.open()
   ======================================================================= */
(function () {
  'use strict';

  var euro = function (n) { return (Math.round(n) || 0).toLocaleString('fr-FR') + ' €'; };
  function toast2(m, t) { try { if (typeof toast === 'function') return toast(m, t); } catch (e) {} }

  var CSS = [
    '.bsg-ov{position:fixed;inset:0;z-index:10001;background:rgba(20,25,20,.5);display:flex;',
    '  align-items:flex-end;justify-content:center;opacity:0;transition:.2s}',
    '.bsg-ov.show{opacity:1}@media(min-width:640px){.bsg-ov{align-items:center}}',
    '.bsg{background:#f7f8f5;width:100%;max-width:600px;max-height:92vh;display:flex;flex-direction:column;',
    '  border-radius:20px 20px 0 0;transform:translateY(20px);transition:.25s;overflow:hidden}',
    '@media(min-width:640px){.bsg{border-radius:20px;transform:translateY(10px)}}',
    '.bsg-ov.show .bsg{transform:none}',
    '.bsg-top{background:var(--accent,#266327);color:#fff;padding:15px 17px;display:flex;align-items:flex-start;justify-content:space-between;gap:10px}',
    '.bsg-top h2{font:600 18px/1.15 "Fraunces",Georgia,serif;margin:0}',
    '.bsg-top .sub{font:500 12px/1.3 "Inter",sans-serif;opacity:.85;margin-top:3px}',
    '.bsg-x{appearance:none;border:0;background:rgba(255,255,255,.18);color:#fff;width:30px;height:30px;border-radius:50%;font-size:17px;cursor:pointer;flex:0 0 auto}',
    '.bsg-body{overflow:auto;padding:12px 14px;flex:1}',
    '.bsg-grp{font:600 11px/1 "Inter",sans-serif;letter-spacing:.05em;text-transform:uppercase;color:#8a8f87;margin:8px 2px 8px}',
    '.bsg-row{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #e7e9e5;border-radius:11px;padding:9px 11px;margin-bottom:7px}',
    '.bsg-row.rupt{border-color:#f0c9b0;background:#fff8f3}',
    '.bsg-chk{width:20px;height:20px;flex:0 0 auto;accent-color:var(--accent,#266327)}',
    '.bsg-main{flex:1;min-width:0}',
    '.bsg-lib{font:600 13.5px/1.25 "Inter",sans-serif;color:var(--g900,#1a1a1a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.bsg-meta{font:500 11px/1 "Inter",sans-serif;color:#9aa096;margin-top:2px}',
    '.bsg-flag{display:inline-block;background:#fdece0;color:#c2410c;border-radius:5px;padding:1px 6px;font-size:10px;font-weight:600;margin-left:6px}',
    '.bsg-qty{width:54px;flex:0 0 auto;text-align:center;padding:6px;border:1px solid #d8dcd4;border-radius:8px;font:600 14px "IBM Plex Mono",monospace}',
    '.bsg-empty{padding:26px;text-align:center;color:#9aa096;font:500 13px "Inter",sans-serif}',
    '.bsg-foot{padding:11px 14px;border-top:1px solid #e7e9e5;background:#fff;display:flex;gap:9px}',
    '.bsg-btn{flex:1;appearance:none;border:1px solid var(--accent,#266327);background:var(--accent,#266327);color:#fff;font:600 14px "Inter",sans-serif;padding:12px;border-radius:11px;cursor:pointer}',
    '.bsg-btn.ghost{background:#fff;color:var(--accent,#266327);flex:0 0 auto;padding:12px 16px}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('bsg-style')) return;
    var s = document.createElement('style'); s.id = 'bsg-style'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  function rowHTML(o, checked) {
    var rupt = (o.stock != null && o.stock <= 0);
    return '<div class="bsg-row' + (rupt ? ' rupt' : '') + '">'
      + '<input type="checkbox" class="bsg-chk" data-code="' + o.code + '"' + (checked && !rupt ? ' checked' : '') + '>'
      + '<div class="bsg-main"><div class="bsg-lib">' + o.libelle
      +   (rupt ? '<span class="bsg-flag">rupture</span>' : (o.stock != null && o.stock <= 5 ? '<span class="bsg-flag" style="background:#fef6e0;color:#a16207">stock ' + o.stock + '</span>' : ''))
      + '</div><div class="bsg-meta">Réf ' + o.code + (o.note ? ' · ' + o.note : '') + '</div></div>'
      + '<input type="number" min="0" class="bsg-qty" data-code="' + o.code + '" value="' + o.qte + '">'
      + '</div>';
  }

  async function open() {
    injectCSS();
    var mag = (document.getElementById('bdc-magasin') || {}).value || '';
    if (!mag.trim()) {
      toast2('Renseigne d\'abord le magasin en haut du bon', 'err');
      var f = document.getElementById('bdc-magasin'); if (f) { f.focus(); f.scrollIntoView({ block: 'center' }); }
      return;
    }
    var clientKey = CRMData._slug(mag);

    var ov = document.createElement('div');
    ov.className = 'bsg-ov';
    ov.innerHTML = '<div class="bsg"><div class="bsg-top"><div><h2>Suggestion de commande</h2>'
      + '<div class="sub">' + mag + '</div></div><button class="bsg-x">×</button></div>'
      + '<div class="bsg-body" id="bsg-body"><div class="bsg-empty">Analyse de l\'historique…</div></div></div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('show'); });
    function close() { ov.classList.remove('show'); setTimeout(function () { ov.remove(); }, 220); }
    ov.querySelector('.bsg-x').onclick = close;
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });

    var catMap = CRMData.catalogueMap();
    var pt = await CRMData.paniersType(clientKey);

    // Commande habituelle : réfs récurrentes (freq >= .2 ou vues >= 2)
    var usual = pt.lignes.filter(function (l) { return l.freq >= 0.2 || l.nbFois >= 2; });
    if (usual.length < 5) usual = pt.lignes.slice(0, 12);       // client à faible historique : on montre le haut
    usual = usual.slice(0, 30).map(function (l) {
      var p = catMap[l.code];
      return { code: l.code, libelle: (p && p.libelle) || l.code, qte: l.qte,
               stock: CRMData.stockDispo(l.code),
               note: l.nbFois + '×' + (l.freq >= 0.5 ? ' · habituel' : '') };
    });

    // À proposer en plus : top opportunités d'assortiment absentes de l'habituel
    var dejaHabituel = {}; usual.forEach(function (o) { dejaHabituel[o.code] = 1; });
    var extras = [];
    try {
      var opp = await Assortiment.forClient(clientKey, { limit: 8 });
      extras = opp.filter(function (o) { return !dejaHabituel[o.code]; }).slice(0, 4).map(function (o) {
        return { code: o.code, libelle: o.libelle, qte: 1, stock: CRMData.stockDispo(o.code),
                 note: o.pop + ' clients' };
      });
    } catch (e) {}

    var body = ov.querySelector('#bsg-body');
    if (!usual.length && !extras.length) {
      body.innerHTML = '<div class="bsg-empty">Pas assez d\'historique de commandes pour ce client.<br>'
        + 'Vérifie que le magasin est écrit comme dans ses commandes précédentes.</div>';
    } else {
      body.innerHTML =
        (usual.length ? '<div class="bsg-grp">Sa commande habituelle</div>' + usual.map(function (o) { return rowHTML(o, true); }).join('') : '')
        + (extras.length ? '<div class="bsg-grp">À proposer en plus</div>' + extras.map(function (o) { return rowHTML(o, false); }).join('') : '');
    }

    var foot = document.createElement('div');
    foot.className = 'bsg-foot';
    foot.innerHTML = '<button class="bsg-btn ghost" id="bsg-cancel">Annuler</button>'
      + '<button class="bsg-btn" id="bsg-add">Ajouter au bon</button>';
    ov.querySelector('.bsg').appendChild(foot);
    foot.querySelector('#bsg-cancel').onclick = close;
    foot.querySelector('#bsg-add').onclick = function () {
      var checks = ov.querySelectorAll('.bsg-chk');
      var added = 0;
      checks.forEach(function (chk) {
        if (!chk.checked) return;
        var code = chk.getAttribute('data-code');
        var qInp = ov.querySelector('.bsg-qty[data-code="' + code + '"]');
        var q = Math.max(0, parseInt(qInp && qInp.value, 10) || 0);
        if (!q) return;
        try {
          if (typeof bdcQtys !== 'undefined') { bdcQtys[code] = (parseInt(bdcQtys[code], 10) || 0) + q; added++; }
        } catch (e) {}
      });
      if (!added) { toast2('Aucune ligne cochée', 'err'); return; }
      try { if (typeof buildTable === 'function') buildTable(); } catch (e) {}
      try { if (typeof bdcUpdateTotals === 'function') bdcUpdateTotals(); } catch (e) {}
      toast2(added + ' ligne(s) ajoutée(s) au bon', 'ok');
      close();
    };
  }

  window.BdcSuggest = { open: open };
})();
