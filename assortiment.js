/* =======================================================================
   assortiment.js  —  Trous d'assortiment (MDM V3, module 2)
   -----------------------------------------------------------------------
   Pour un client : références qu'il ne commande PAS mais que beaucoup
   d'autres clients commandent (signal de popularité) -> pistes d'upsell.
   (Ton catalogue n'a pas de champ catégorie : le classement se fait sur
   la popularité, ce qui est justement le signal le plus parlant.)

   API :
     Assortiment.mount(el?)
     Assortiment.forClient(clientKey, opts?) -> [{code,libelle,pop,pct,prix}]
   ======================================================================= */
(function () {
  'use strict';

  var euro = function (n) { return (Math.round(n) || 0).toLocaleString('fr-FR') + ' €'; };

  var CSS = [
    '.asr-wrap{max-width:820px;margin:0 auto;padding:4px 2px 90px}',
    '.asr-h{margin:6px 2px 14px}',
    '.asr-h h2{font:600 20px/1.1 "Fraunces",Georgia,serif;margin:0 0 4px;color:var(--g900,#1a1a1a)}',
    '.asr-h p{font:500 13px/1.4 "Inter",sans-serif;color:var(--g600,#8a8f87);margin:0}',
    '.asr-ctrl{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 2px 16px}',
    '.asr-sel{padding:9px 12px;border:1px solid #d8dcd4;border-radius:10px;background:#fff;',
    '  font:500 13px "Inter",sans-serif;min-width:220px;max-width:100%}',
    '.asr-list{display:flex;flex-direction:column;gap:8px}',
    '.asr-item{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #e7e9e5;',
    '  border-radius:13px;padding:12px 14px;box-shadow:0 1px 2px rgba(0,0,0,.03)}',
    '.asr-rank{font:600 14px "IBM Plex Mono",monospace;color:#c3c8bf;width:26px;flex:0 0 auto;text-align:right}',
    '.asr-main{flex:1;min-width:0}',
    '.asr-lib{font:600 14px/1.25 "Inter",sans-serif;color:var(--g900,#1a1a1a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.asr-meta{font:500 11.5px/1 "Inter",sans-serif;color:#9aa096;margin-top:3px}',
    '.asr-pop{flex:0 0 auto;text-align:right}',
    '.asr-popn{font:600 16px/1 "IBM Plex Mono",monospace;color:var(--accent,#266327)}',
    '.asr-popl{font:500 10px/1 "Inter",sans-serif;color:#9aa096;margin-top:3px}',
    '.asr-empty{padding:40px;text-align:center;color:#9aa096;font:500 14px "Inter",sans-serif}',
    '.asr-bar{height:5px;border-radius:3px;background:#eef0ec;margin-top:7px;overflow:hidden}',
    '.asr-bar>i{display:block;height:100%;background:linear-gradient(90deg,var(--accent,#266327),#3ea16a)}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('asr-style')) return;
    var s = document.createElement('style'); s.id = 'asr-style'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  async function forClient(clientKey, opts) {
    opts = opts || {};
    var limit = opts.limit || 12;
    var byClient = await CRMData.codesCommandesParClient();
    var pop = await CRMData.popularite();
    var catMap = CRMData.catalogueMap();
    var nbClients = Object.keys(byClient).length || 1;

    var codesClient = byClient[clientKey] || {};
    var out = [];
    Object.keys(pop).forEach(function (code) {
      if (codesClient[code]) return;              // déjà commandé
      var p = catMap[code];
      out.push({
        code: code,
        libelle: (p && p.libelle) || code,
        prix: (p && p.prix) || 0,
        pop: pop[code],
        pct: Math.round((pop[code] / nbClients) * 100)
      });
    });
    out.sort(function (a, b) { return b.pop - a.pop; });
    return out.slice(0, limit);
  }

  async function topGlobal(limit) {
    var byClient = await CRMData.codesCommandesParClient();
    var pop = await CRMData.popularite();
    var catMap = CRMData.catalogueMap();
    var nb = Object.keys(byClient).length || 1;
    var rows = Object.keys(pop).map(function (code) {
      var p = catMap[code];
      return {
        code: code,
        libelle: (p && p.libelle) || code,
        prix: (p && p.prix) || 0,
        pop: pop[code],
        pct: Math.round((pop[code] / nb) * 100),
        manque: nb - pop[code]
      };
    });
    rows.sort(function (a, b) { return (b.pop * b.manque) - (a.pop * a.manque); });
    return rows.slice(0, limit || 30);
  }

  function itemHTML(o, i, maxPop) {
    var w = maxPop ? Math.round((o.pop / maxPop) * 100) : 0;
    return '<div class="asr-item">'
      + '<div class="asr-rank">' + (i + 1) + '</div>'
      + '<div class="asr-main">'
      +   '<div class="asr-lib">' + o.libelle + '</div>'
      +   '<div class="asr-meta">Réf ' + o.code + (o.prix ? ' · ' + euro(o.prix) : '') + '</div>'
      +   '<div class="asr-bar"><i style="width:' + w + '%"></i></div>'
      + '</div>'
      + '<div class="asr-pop"><div class="asr-popn">' + o.pop + '</div><div class="asr-popl">clients</div></div>'
      + '</div>';
  }

  async function render(host) {
    injectCSS();
    var clients = await CRMData.clients();
    clients.sort(function (a, b) { return a.nom.localeCompare(b.nom); });
    var opts = ['<option value="">— Vue globale (toutes opportunités) —</option>']
      .concat(clients.map(function (c) {
        return '<option value="' + c.key + '">' + c.nom + '</option>';
      })).join('');

    host.innerHTML =
      '<div class="asr-wrap">'
      + '<div class="asr-h"><h2>Trous d\'assortiment</h2>'
      +   '<p>Références populaires chez tes autres clients, absentes de leurs commandes.</p></div>'
      + '<div class="asr-ctrl"><select class="asr-sel" id="asr-client">' + opts + '</select></div>'
      + '<div class="asr-list" id="asr-list"></div>'
      + '</div>';

    var sel = host.querySelector('#asr-client');
    var list = host.querySelector('#asr-list');

    async function refresh() {
      list.innerHTML = '<div class="asr-empty">Analyse…</div>';
      var rows = sel.value ? await forClient(sel.value, { limit: 20 }) : await topGlobal(30);
      if (!rows.length) { list.innerHTML = '<div class="asr-empty">Aucune opportunité détectée (données de commandes insuffisantes).</div>'; return; }
      var maxPop = rows.reduce(function (m, r) { return Math.max(m, r.pop); }, 1);
      list.innerHTML = rows.map(function (o, i) { return itemHTML(o, i, maxPop); }).join('');
    }
    sel.onchange = refresh;
    refresh();
  }

  async function mount(target) {
    var host = typeof target === 'string' ? document.querySelector(target)
             : (target || document.getElementById('asr-host') || document.getElementById('sec-assortiment'));
    if (!host) { console.warn('[Assortiment] conteneur introuvable'); return; }
    host.innerHTML = '<div style="padding:40px;text-align:center;color:#9aa096">Chargement…</div>';
    await render(host);
  }

  window.Assortiment = { mount: mount, forClient: forClient, topGlobal: topGlobal };
})();
