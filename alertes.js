/* =======================================================================
   alertes.js  —  Alertes stock (MDM V3, point 3)
   -----------------------------------------------------------------------
   S'appuie sur ce que tes données permettent réellement :
     • Ruptures sur réfs populaires : stock <= 0 chez des produits que
       plusieurs clients commandent -> à ne pas pousser / à relancer MDM.
     • Stock faible : 0 < stock <= seuil sur réfs populaires -> risque de
       rupture imminent.
     • Surstock à DLC courte : uniquement si ta DLC garantie est
       exploitable (durée avec unité, ou date) -> risque de perte à écouler.
       Sinon la carte est masquée (pas d'alerte inventée).
   Source stock = global bdcStockMap (+ stock catalogue). DLC =
   bcol('config').doc('dlc_produits').
   API : Alertes.mount(el?)
   ======================================================================= */
(function () {
  'use strict';

  var SEUIL_FAIBLE = 5;      // stock <= 5 = faible
  var SEUIL_SURSTOCK = 50;   // stock >= 50 = surstock (pour l'alerte DLC)
  var DLC_COURTE_J = 120;    // <= 120 jours de DLC garantie = courte

  var CSS = [
    '.alt-wrap{max-width:840px;margin:0 auto;padding:4px 2px 90px}',
    '.alt-h{margin:6px 2px 14px}',
    '.alt-h h2{font:600 20px/1.1 "Fraunces",Georgia,serif;margin:0 0 4px;color:var(--g900,#1a1a1a)}',
    '.alt-h p{font:500 13px/1.4 "Inter",sans-serif;color:var(--g600,#8a8f87);margin:0}',
    '.alt-card{background:#fff;border:1px solid #e7e9e5;border-radius:15px;padding:14px 15px;margin-bottom:14px;box-shadow:0 1px 2px rgba(0,0,0,.03)}',
    '.alt-t{display:flex;align-items:center;gap:8px;font:600 14px/1 "Inter",sans-serif;color:var(--g900,#1a1a1a);margin:0 0 4px}',
    '.alt-badge{font:600 12px/1 "IBM Plex Mono",monospace;color:#fff;border-radius:999px;padding:3px 9px}',
    '.alt-sub{font:500 11.5px/1.3 "Inter",sans-serif;color:#9aa096;margin:0 0 10px}',
    '.alt-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid #f0f1ee}',
    '.alt-row:first-of-type{border-top:0}',
    '.alt-row .lib{flex:1;min-width:0;font:600 13px/1.25 "Inter",sans-serif;color:var(--g900,#1a1a1a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.alt-row .lib small{display:block;color:#9aa096;font-weight:500;font-size:11px}',
    '.alt-row .val{flex:0 0 auto;text-align:right;font:600 13px "IBM Plex Mono",monospace}',
    '.alt-empty{color:#9aa096;font:500 12.5px "Inter",sans-serif;padding:4px 0}',
    '.alt-note{font:500 12px/1.4 "Inter",sans-serif;color:#b3b8ac;font-style:italic}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('alt-style')) return;
    var s = document.createElement('style'); s.id = 'alt-style'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  // Parse DLC garantie -> nb de jours, uniquement si l'unité est explicite ou si c'est une date.
  function dlcJours(v) {
    if (v == null) return null;
    var s = String(v).trim().toLowerCase();
    if (!s) return null;
    var iso = s.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
    if (iso) {
      var d = new Date(iso[1] + '-' + iso[2] + '-' + (iso[3] || '15'));
      if (!isNaN(d)) return Math.round((d - new Date()) / 86400000);
    }
    var m = s.match(/(\d+(?:[.,]\d+)?)\s*(mois|m\b|semaine|sem|s\b|jour|jours|j\b)/);
    if (!m) return null; // pas d'unité claire -> on n'invente pas
    var n = parseFloat(m[1].replace(',', '.'));
    var u = m[2];
    if (u.indexOf('mois') === 0 || u === 'm') return Math.round(n * 30);
    if (u.indexOf('sem') === 0 || u === 's') return Math.round(n * 7);
    return Math.round(n); // jours
  }

  async function loadDlc() {
    try {
      var doc = await bcol('config').doc('dlc_produits').get();
      if (!doc.exists) return {};
      var data = doc.data() || {};
      return data.map || data.dlc || data; // tolère plusieurs enveloppes
    } catch (e) { return {}; }
  }

  function rowHTML(o, valHtml) {
    return '<div class="alt-row"><div class="lib">' + o.libelle
      + '<small>Réf ' + o.code + (o.pop ? ' · ' + o.pop + ' clients' : '') + '</small></div>'
      + '<div class="val">' + valHtml + '</div></div>';
  }

  async function render(host) {
    injectCSS();
    var pop = await CRMData.popularite();
    var catMap = CRMData.catalogueMap();
    var dlcRaw = await loadDlc();

    var ruptures = [], faibles = [], surstock = [];
    var codes = Object.keys(catMap);
    codes.forEach(function (code) {
      var p = catMap[code];
      var stock = CRMData.stockDispo(code);
      var nbCli = pop[code] || 0;
      if (stock != null && stock <= 0 && nbCli > 0) {
        ruptures.push({ code: code, libelle: p.libelle || code, pop: nbCli, stock: stock });
      } else if (stock != null && stock > 0 && stock <= SEUIL_FAIBLE && nbCli > 0) {
        faibles.push({ code: code, libelle: p.libelle || code, pop: nbCli, stock: stock });
      }
      if (stock != null && stock >= SEUIL_SURSTOCK) {
        var dj = dlcJours(dlcRaw[code]);
        if (dj != null && dj <= DLC_COURTE_J) {
          surstock.push({ code: code, libelle: p.libelle || code, pop: nbCli, stock: stock, dlcJ: dj });
        }
      }
    });
    ruptures.sort(function (a, b) { return b.pop - a.pop; });
    faibles.sort(function (a, b) { return b.pop - a.pop; });
    surstock.sort(function (a, b) { return a.dlcJ - b.dlcJ || b.stock - a.stock; });

    var dlcParsable = Object.keys(dlcRaw).some(function (k) { return dlcJours(dlcRaw[k]) != null; });

    function card(title, color, sub, rows, valFn, empty) {
      return '<div class="alt-card">'
        + '<div class="alt-t">' + title + ' <span class="alt-badge" style="background:' + color + '">' + rows.length + '</span></div>'
        + '<p class="alt-sub">' + sub + '</p>'
        + (rows.length ? rows.slice(0, 40).map(function (o) { return rowHTML(o, valFn(o)); }).join('')
                       : '<div class="alt-empty">' + empty + '</div>')
        + '</div>';
    }

    host.innerHTML =
      '<div class="alt-wrap">'
      + '<div class="alt-h"><h2>Alertes stock</h2><p>Priorisé sur les références que tes clients commandent.</p></div>'
      + card('🚫 Ruptures sur réfs populaires', '#c2410c',
             'Stock épuisé sur des produits demandés — à ne pas proposer, à relancer.',
             ruptures, function (o) { return '<span style="color:#c2410c">rupture</span>'; },
             'Aucune rupture sur tes réfs populaires. 👍')
      + card('⚠️ Stock faible', '#a16207',
             'Bientôt en rupture (≤ ' + SEUIL_FAIBLE + ') sur des réfs demandées.',
             faibles, function (o) { return '<span style="color:#a16207">' + o.stock + '</span>'; },
             'Rien en stock faible pour l\'instant.')
      + (dlcParsable
          ? card('⏳ Surstock à DLC courte', '#2563eb',
                 'Fort stock (≥ ' + SEUIL_SURSTOCK + ') et DLC garantie ≤ ' + DLC_COURTE_J + ' j — à écouler en priorité.',
                 surstock, function (o) { return o.dlcJ + ' j · ' + o.stock; },
                 'Aucun surstock à DLC courte détecté.')
          : '<div class="alt-card"><div class="alt-t">⏳ Surstock à DLC courte</div>'
            + '<p class="alt-note">Alerte indisponible : tes DLC ne sont pas dans un format exploitable '
            + '(il faut une durée avec unité — « 6 mois », « 90 j » — ou une date). '
            + 'Renseigne-les ainsi dans la Recherche produit pour activer cette carte.</p></div>')
      + '</div>';
  }

  async function mount(target) {
    var host = typeof target === 'string' ? document.querySelector(target)
             : (target || document.getElementById('alt-host') || document.getElementById('sec-alertes'));
    if (!host) { console.warn('[Alertes] conteneur introuvable'); return; }
    host.innerHTML = '<div style="padding:40px;text-align:center;color:#9aa096">Chargement…</div>';
    await render(host);
  }

  window.Alertes = { mount: mount };
})();
